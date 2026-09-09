from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import base64
import gc
import queue as _queue
import threading
import time
import asyncio
import os
import re
import uuid
from io import BytesIO
from typing import List, Optional

# Load torch/diffusers lazily so /health binds in milliseconds.
# Importing them at module load blocks the port for 20–60s (or crashes).
torch = None
AutoPipelineForText2Image = None


def _patch_mps_sdpa(torch_mod) -> None:
    """MPS scaled_dot_product_attention requests a ~44 GiB workspace on 64 GB Macs."""
    import torch.nn.functional as F

    if getattr(F, "_acw_mps_sdpa_patched", False):
        return
    orig = F.scaled_dot_product_attention

    def _sliced(
        query,
        key,
        value,
        attn_mask=None,
        dropout_p=0.0,
        is_causal=False,
        scale=None,
        enable_gqa=False,
        **kwargs,
    ):
        if getattr(query, "device", None) is None or query.device.type != "mps":
            try:
                return orig(
                    query, key, value,
                    attn_mask=attn_mask, dropout_p=dropout_p, is_causal=is_causal,
                    scale=scale, enable_gqa=enable_gqa, **kwargs,
                )
            except TypeError:
                return orig(
                    query, key, value,
                    attn_mask=attn_mask, dropout_p=dropout_p, is_causal=is_causal, scale=scale,
                )
        if query.ndim != 4:
            return orig(query, key, value, attn_mask=attn_mask, dropout_p=dropout_p, is_causal=is_causal, scale=scale)
        q, k, v = query, key, value
        heads_q, heads_k = q.shape[1], k.shape[1]
        if enable_gqa and heads_q != heads_k and heads_k > 0 and heads_q % heads_k == 0:
            rep = heads_q // heads_k
            k = k.repeat_interleave(rep, dim=1)
            v = v.repeat_interleave(rep, dim=1)
        q_len, dim = q.shape[-2], q.shape[-1]
        scale_value = (dim ** -0.5) if scale is None else float(scale)
        k_t = k.transpose(-2, -1)
        chunks = []
        for start in range(0, q_len, 64):
            qs = q[:, :, start:start + 64, :]
            scores = torch_mod.matmul(qs.float(), k_t.float()) * scale_value
            if attn_mask is not None:
                mask = attn_mask
                if mask.dtype == torch_mod.bool:
                    scores = scores.masked_fill(~mask, torch_mod.finfo(scores.dtype).min)
                else:
                    scores = scores + mask.float()
            if is_causal:
                sl = qs.shape[-2]
                causal = torch_mod.ones(
                    sl, k.shape[-2], device=scores.device, dtype=torch_mod.bool,
                ).triu(diagonal=1 + start)
                scores = scores.masked_fill(causal, torch_mod.finfo(scores.dtype).min)
            probs = torch_mod.softmax(scores, dim=-1).to(dtype=v.dtype)
            chunks.append(torch_mod.matmul(probs, v))
        return torch_mod.cat(chunks, dim=-2).to(dtype=query.dtype)

    F.scaled_dot_product_attention = _sliced
    F._acw_mps_sdpa_patched = True
    print("MPS SDPA patched (sliced; no 44 GiB workspace)", flush=True)


def _ensure_ml():
    global torch, AutoPipelineForText2Image
    if torch is not None:
        return
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
    os.environ["PYTORCH_MPS_HIGH_WATERMARK_RATIO"] = "0.0"
    os.environ["PYTORCH_MPS_LOW_WATERMARK_RATIO"] = "0.0"
    import torch as _torch
    from diffusers import AutoPipelineForText2Image as _Pipe
    torch = _torch
    AutoPipelineForText2Image = _Pipe
    _patch_mps_sdpa(torch)

router = APIRouter()


class GenerationRequest(BaseModel):
    prompt: str
    format: str = "square"
    style: str = "subtle"
    job: str = "title"
    model_id: str = "OFA-Sys/small-stable-diffusion-v0"
    image_base64: Optional[str] = None
    images_base64: Optional[List[str]] = None
    strength: float = 0.72
    # Filled server-side: CLIP is English-only, so RU prompts are translated first.
    english_prompt: Optional[str] = None


# Reuse loaded weights across requests.
pipeline_cache: dict = {}

# Shown in the app-wide engine monitor.
_runtime_job: dict = {
    "active": False,
    "kind": "",
    "stage": "idle",
    "percent": 0,
    "detail": "",
    "model_id": "",
    "started_at": 0.0,
    "error": None,
    "cancel": False,
}

# Drop the image pipeline shortly after the last job so FLUX does not sit
# in unified memory while the user moves to script / TTS / 3D.
IDLE_RELEASE_SEC = 50.0
_idle_release_task: asyncio.Task | None = None

# MPS is not safe for concurrent inference on one pipeline.
_generation_lock = asyncio.Lock()

# Dedicated GPU thread: Metal context created on one thread must not be used
# from another (flaky GPUResizeOps crashes under uvicorn).
_gpu_queue: "_queue.Queue" = _queue.Queue()
_gpu_thread: "threading.Thread | None" = None


def _gpu_worker() -> None:
    while True:
        item = _gpu_queue.get()
        if item is None:  # shutdown sentinel
            break
        fn, args, future, loop = item
        try:
            result = fn(*args)
            loop.call_soon_threadsafe(future.set_result, result)
        except Exception as e:  # noqa: BLE001 — rethrow into the awaiting coroutine
            loop.call_soon_threadsafe(future.set_exception, e)


def _ensure_gpu_thread() -> None:
    global _gpu_thread
    if _gpu_thread is None or not _gpu_thread.is_alive():
        _gpu_thread = threading.Thread(target=_gpu_worker, name="acw-gpu", daemon=True)
        _gpu_thread.start()


def set_runtime_job(**patch) -> None:
    _runtime_job.update(patch)


def clear_runtime_job(*, error: str | None = None) -> None:
    _runtime_job.update({
        "active": False,
        "kind": _runtime_job.get("kind") or "",
        "stage": "error" if error else "idle",
        "percent": 0 if error else 100,
        "detail": error or "",
        "error": error,
        "cancel": False,
    })


def runtime_should_cancel() -> bool:
    return bool(_runtime_job.get("cancel"))


def attach_step_callback(kwargs: dict, total_steps: int) -> dict:
    """Best-effort Diffusers progress. Signature differs across versions."""

    def on_step(step: int, *_rest, **_kw):
        if runtime_should_cancel():
            raise RuntimeError("CANCELLED")
        total = max(1, total_steps)
        pct = 12 + int(80 * (int(step) + 1) / total)
        set_runtime_job(
            active=True,
            stage="infer",
            percent=min(94, pct),
            detail=f"{int(step) + 1}/{total}",
        )
        if _kw:
            return _kw
        return None

    def on_step_end(pipe, i, t, callback_kwargs):  # noqa: ARG001
        on_step(i)
        return callback_kwargs

    kwargs = dict(kwargs)
    kwargs["callback_on_step_end"] = on_step_end
    return kwargs


def _process_rss_bytes() -> int:
    try:
        import subprocess

        out = subprocess.check_output(
            ["ps", "-o", "rss=", "-p", str(os.getpid())],
            text=True,
        )
        return int((out or "0").strip() or 0) * 1024
    except Exception:  # noqa: BLE001
        return 0


def _memory_snapshot() -> dict:
    mps_alloc = 0
    if torch is not None:
        try:
            if torch.backends.mps.is_available():
                mps_alloc = int(torch.mps.current_allocated_memory())
        except Exception:  # noqa: BLE001
            mps_alloc = 0
    ram_total = ram_available = ram_used = 0
    ram_percent = 0.0
    try:
        import psutil

        vm = psutil.virtual_memory()
        ram_total = int(vm.total)
        ram_available = int(vm.available)
        ram_used = int(vm.used)
        ram_percent = float(vm.percent)
    except Exception:  # noqa: BLE001
        pass
    return {
        "sidecar_rss_bytes": _process_rss_bytes(),
        "mps_allocated_bytes": mps_alloc,
        "ram_total": ram_total,
        "ram_available": ram_available,
        "ram_used": ram_used,
        "ram_percent": ram_percent,
    }


def _owned_loaded_keys() -> list[str]:
    """What this process currently owns — not OS RSS."""
    keys = list(pipeline_cache.keys())
    try:
        from api.threed import TRIPOSR_CACHE_KEY, _model_cache

        if TRIPOSR_CACHE_KEY in _model_cache:
            keys.append(TRIPOSR_CACHE_KEY)
    except Exception:  # noqa: BLE001
        pass
    try:
        from api.hunyuan3d import HUNYUAN_CACHE_KEY
        from api.hunyuan3d import hunyuan_loaded

        if hunyuan_loaded() and HUNYUAN_CACHE_KEY not in keys:
            keys.append(HUNYUAN_CACHE_KEY)
    except Exception:  # noqa: BLE001
        pass
    try:
        from ollama_rt import loaded_models

        for name in loaded_models():
            tag = f"ollama:{name}"
            if tag not in keys:
                keys.append(tag)
    except Exception:  # noqa: BLE001
        pass
    return keys


def _video_backend_snapshot() -> dict:
    try:
        from api import mlx_ti2v
    except Exception:  # noqa: BLE001
        return {
            "id": "Anes1032/Wan2.2-TI2V-5B-mlx-q8",
            "state": "ERROR",
            "installed": False,
            "approx_bytes": 0,
        }
    return mlx_ti2v.backend_snapshot(
        job_active=bool(_runtime_job.get("active")),
        job_stage=str(_runtime_job.get("stage") or "idle"),
        job_model_id=str(_runtime_job.get("model_id") or ""),
        job_error=_runtime_job.get("error"),
    )


def runtime_status_payload() -> dict:
    started = float(_runtime_job.get("started_at") or 0)
    elapsed = max(0.0, time.time() - started) if started else 0.0
    memory = _memory_snapshot()
    return {
        "job": {
            "active": bool(_runtime_job.get("active")),
            "kind": _runtime_job.get("kind") or "",
            "stage": _runtime_job.get("stage") or "idle",
            "percent": int(_runtime_job.get("percent") or 0),
            "detail": _runtime_job.get("detail") or "",
            "model_id": _runtime_job.get("model_id") or "",
            "elapsed_sec": round(elapsed, 1),
            "error": _runtime_job.get("error"),
        },
        "loaded": _owned_loaded_keys(),
        "memory": memory,
        "busy": _generation_lock.locked(),
        "ram_total": memory.get("ram_total") or 0,
        "ram_available": memory.get("ram_available") or 0,
        "ram_used": memory.get("ram_used") or 0,
        "ram_percent": memory.get("ram_percent") or 0,
        "video_backend": _video_backend_snapshot(),
    }


async def run_on_gpu(fn, *args):
    """Run a blocking GPU call on the dedicated worker thread."""
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    _ensure_gpu_thread()
    _gpu_queue.put((fn, args, future, loop))
    return await future


def run_on_gpu_blocking(fn, *args, timeout: float = 180.0):
    """GPU call from a sync FastAPI route. Metal stays on the worker thread."""
    box: dict = {}
    done = threading.Event()

    def wrapped():
        try:
            box["r"] = fn(*args)
        except Exception as e:  # noqa: BLE001
            box["e"] = e
        finally:
            done.set()
        return box.get("r")

    class _Loop:
        def call_soon_threadsafe(self, cb, *a):
            try:
                cb(*a)
            except Exception:  # noqa: BLE001
                pass

    dummy = type("F", (), {
        "set_result": lambda self, r: None,
        "set_exception": lambda self, e: None,
    })()
    _ensure_gpu_thread()
    _gpu_queue.put((wrapped, (), dummy, _Loop()))
    if not done.wait(timeout):
        raise TimeoutError("GPU worker timed out")
    if "e" in box:
        raise box["e"]
    return box.get("r")


def cancel_idle_release() -> None:
    global _idle_release_task
    task = _idle_release_task
    _idle_release_task = None
    if task and not task.done():
        task.cancel()


async def _idle_release_after() -> None:
    try:
        await asyncio.sleep(IDLE_RELEASE_SEC)
        if _runtime_job.get("active"):
            return
        if not pipeline_cache:
            set_runtime_job(active=False, stage="released", percent=100, detail="idle")
            return
        set_runtime_job(active=False, kind="image", stage="releasing", percent=0, detail="idle_release")
        async with _generation_lock:
            if _runtime_job.get("active"):
                return
            count = await run_on_gpu(_unload_all_image_pipelines)
        set_runtime_job(
            active=False,
            kind="image",
            stage="released",
            percent=100,
            detail=f"unloaded {count}",
        )
        print(f"[idle-release] dropped {count} image pipeline(s)", flush=True)
    except asyncio.CancelledError:
        raise


def schedule_idle_release() -> None:
    global _idle_release_task
    cancel_idle_release()
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    _idle_release_task = loop.create_task(_idle_release_after())


def release_heavy_for_other_work() -> int:
    """Drop image + 3D so Ollama / TTS can use unified memory. GPU thread or blocking."""
    count = _unload_all_image_pipelines()
    _release_3d_models()
    return count


def _pick_dtype(model_id: str):
    """
    Precision for MPS:
    - SD 1.x — fp32 for stability
    - SDXL / FLUX — bf16 (fp16 is unstable on MPS)
    """
    mid = model_id.lower()
    if "flux" in mid or "sdxl" in mid:
        return torch.bfloat16
    return torch.float32


def _pick_steps(model_id: str) -> int:
    """Denoising steps: Turbo/Schnell 4, FLUX.1-dev 40, SDXL 30, else 24."""
    mid = model_id.lower()
    if "turbo" in mid or "schnell" in mid:
        return 4
    if "flux" in mid:
        return 32
    if "sdxl" in mid:
        return 30
    return 24


def _pick_guidance(model_id: str) -> float:
    """Guidance: Turbo/Schnell 0, FLUX.1-dev 3.5, SDXL 5.0, else 7.5."""
    mid = model_id.lower()
    if "turbo" in mid or "schnell" in mid:
        return 0.0
    if "flux" in mid:
        return 3.5
    if "sdxl" in mid:
        return 5.0
    return 7.5


def _to_cache_key(model_id: str) -> str:
    return model_id.replace("/", "__")


def _is_flux(model_id: str) -> bool:
    return "flux" in model_id.lower()


def _on_apple_silicon() -> bool:
    if torch is None:
        return os.uname().sysname == "Darwin"
    try:
        return bool(torch.backends.mps.is_available() and not torch.cuda.is_available())
    except Exception:  # noqa: BLE001
        return os.uname().sysname == "Darwin"


def _pick_size(model_id: str, request_format: str, compact: bool = False) -> tuple[int, int]:
    """Frame size. FLUX 44 GiB was T5-on-MPS, not width; still cap wide frames for attention."""
    mid = model_id.lower()
    if compact:
        base = 512
    elif "flux" in mid:
        base = 768
    elif "sdxl" in mid:
        base = 1024
    else:
        base = 512
    if request_format == "portrait":
        w, h = (base, (base * 5) // 4) if "flux" in mid else (base, (base * 3) // 2)
    elif request_format == "wide":
        w, h = ((base * 5) // 4, base) if "flux" in mid else ((base * 3) // 2, base)
    else:
        w, h = base, base
    # FLUX packed latents need multiples of 16.
    return max(16, (w // 16) * 16), max(16, (h // 16) * 16)


def _get_pipeline(model_id: str, force: bool = False):
    """Return a cached pipeline or load one. Blocking — GPU worker thread only."""
    _ensure_ml()
    cache_key = _to_cache_key(model_id)
    if force and cache_key in pipeline_cache:
        _unload_model(cache_key)
    if cache_key in pipeline_cache:
        pipe = pipeline_cache[cache_key]
        if _is_flux(model_id) and (
            type(pipe).__name__ == "FluxImg2ImgPipeline"
            or not getattr(pipe, "_acw_flux_mps_v3", False)
        ):
            print("Reloading FLUX with MPS-safe offload (T5 stays on CPU)", flush=True)
            _unload_model(cache_key)
        else:
            print(f"Using cached pipeline for {cache_key}", flush=True)
            return cache_key, pipe

    model_path = model_id
    local_files_only = False
    # Studio downloads land here (legacy folder name — do not rename while models exist).
    local_dir = os.path.expanduser(f"~/Documents/Canvas/Models/{cache_key}")
    if os.path.exists(local_dir):
        model_path = local_dir
        local_files_only = True
        print(f"Using local model at: {model_path}", flush=True)
    else:
        print(f"Local model not found at {local_dir}, using HF id: {model_path}", flush=True)

    dtype = _pick_dtype(model_id)
    print(f"Loading model {model_path} into memory (dtype={dtype})...", flush=True)

    if _is_flux(model_id):
        pipe = _load_flux(model_path, local_files_only, dtype)
    else:
        try:
            pipe = AutoPipelineForText2Image.from_pretrained(
                model_path, dtype=dtype, local_files_only=local_files_only
            )
        except TypeError:
            pipe = AutoPipelineForText2Image.from_pretrained(
                model_path, torch_dtype=dtype, local_files_only=local_files_only
            )
        # SD fp32 pipelines: keep VAE in fp32 (fp16 overflows on MPS).
        # SDXL bf16: keep VAE in bf16 so latent dtype matches.
        if dtype == torch.float32 and getattr(pipe, "vae", None) is not None:
            pipe.vae = pipe.vae.to(torch.float32)
        pipe = pipe.to("mps")

    # Tiny SD's NSFW checker false-positives and replaces the image with black.
    if getattr(pipe, "safety_checker", None) is not None:
        pipe.safety_checker = None
        pipe.feature_extractor = None

    pipeline_cache[cache_key] = pipe
    return cache_key, pipe


_FLUX_ATTN_PATCHED = False


def _sliced_attention_mps(query, key, value, attn_mask=None, dropout_p=0.0, is_causal=False, scale=None, **_kwargs):
    """Attention without MPS scaled_dot_product_attention (that kernel asks for a ~44 GiB workspace)."""
    # query/key/value: [batch, seq, heads, dim] as FluxAttnProcessor emits.
    q = query.transpose(1, 2)
    k = key.transpose(1, 2)
    v = value.transpose(1, 2)
    _batch, q_heads, q_len, dim = q.shape
    k_heads = k.shape[1]
    if q_heads != k_heads:
        if q_heads % k_heads != 0:
            raise RuntimeError(f"attention head mismatch q={q_heads} k={k_heads}")
        repeat = q_heads // k_heads
        k = k.repeat_interleave(repeat, dim=1)
        v = v.repeat_interleave(repeat, dim=1)
    scale_value = (dim ** -0.5) if scale is None else float(scale)
    k_len = k.shape[2]
    slice_size = 128
    chunks = []
    for start in range(0, q_len, slice_size):
        qs = q[:, :, start:start + slice_size, :]
        scores = torch.matmul(qs.float(), k.transpose(-2, -1).float()) * scale_value
        if attn_mask is not None:
            mask = attn_mask
            if mask.dtype == torch.bool:
                if mask.ndim == 2:
                    mask = mask[:, None, None, :]
                scores = scores.masked_fill(~mask, torch.finfo(scores.dtype).min)
            else:
                if mask.ndim == 2:
                    mask = mask[:, None, None, :]
                scores = scores + mask.float()
        if is_causal:
            sl = qs.shape[2]
            causal = torch.ones(sl, k_len, device=scores.device, dtype=torch.bool).triu(diagonal=1 + start)
            scores = scores.masked_fill(causal, torch.finfo(scores.dtype).min)
        probs = torch.softmax(scores, dim=-1).to(dtype=v.dtype)
        chunks.append(torch.matmul(probs, v))
        del scores, probs
    out = torch.cat(chunks, dim=2)
    return out.transpose(1, 2).to(dtype=query.dtype)


def _install_flux_sliced_attention() -> None:
    """FluxAttnProcessor imports dispatch_attention_fn by name — patch that module binding."""
    global _FLUX_ATTN_PATCHED
    if _FLUX_ATTN_PATCHED:
        return
    import diffusers.models.transformers.transformer_flux as flux_tf

    orig = flux_tf.dispatch_attention_fn

    def _dispatch(query, key, value, attn_mask=None, dropout_p=0.0, is_causal=False, scale=None, **kwargs):
        if getattr(query, "device", None) is not None and query.device.type == "mps":
            return _sliced_attention_mps(
                query, key, value,
                attn_mask=attn_mask, dropout_p=dropout_p, is_causal=is_causal, scale=scale,
            )
        return orig(
            query, key, value,
            attn_mask=attn_mask, dropout_p=dropout_p, is_causal=is_causal, scale=scale,
            **kwargs,
        )

    flux_tf.dispatch_attention_fn = _dispatch
    _FLUX_ATTN_PATCHED = True
    print("FLUX attention: sliced matmul on MPS (no SDPA 44 GiB workspace)", flush=True)


def _flux_encoder_dtype(pipe):
    dtype = torch.bfloat16
    try:
        tr = getattr(pipe, "transformer", None)
        if tr is not None:
            dtype = next(tr.parameters()).dtype
    except Exception:  # noqa: BLE001
        pass
    return dtype


def _pin_flux_encoders_cpu(pipe) -> None:
    """CLIP + T5-XXL must stay on CPU. A single .to(mps) of T5 is the 44 GiB Metal error."""
    if torch is None:
        return
    dtype = _flux_encoder_dtype(pipe)
    try:
        from accelerate.hooks import remove_hook_from_module
    except Exception:  # noqa: BLE001
        remove_hook_from_module = None
    for name in ("text_encoder", "text_encoder_2", "image_encoder"):
        enc = getattr(pipe, name, None)
        if enc is None:
            continue
        if remove_hook_from_module is not None:
            try:
                remove_hook_from_module(enc, recurse=True)
            except Exception:  # noqa: BLE001
                pass
        try:
            enc.to(device="cpu", dtype=dtype)
            p = next(enc.parameters())
            if p.device.type != "cpu":
                print(f"FLUX {name} still on {p.device} after pin", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"FLUX {name} pin skipped: {e}", flush=True)


def _apply_flux_mps_offload(pipe) -> None:
    """Hook transformer+VAE only. Stock enable_model_cpu_offload copies T5 onto MPS."""
    from accelerate import cpu_offload_with_hook

    if hasattr(pipe, "remove_all_hooks"):
        try:
            pipe.remove_all_hooks()
        except Exception as e:  # noqa: BLE001
            print(f"FLUX remove_all_hooks: {e}", flush=True)

    _pin_flux_encoders_cpu(pipe)

    device = torch.device("mps")
    pipe._offload_device = device
    pipe._offload_gpu_id = 0
    pipe.model_cpu_offload_seq = "transformer->vae"
    # Do not put encoders in _exclude_from_cpu_offload: stock offload then does model.to(mps).
    pipe._exclude_from_cpu_offload = []

    pipe._all_hooks = []
    hook = None
    for name in ("transformer", "vae"):
        model = getattr(pipe, name, None)
        if model is None:
            continue
        _, hook = cpu_offload_with_hook(model, device, prev_module_hook=hook)
        pipe._all_hooks.append(hook)
    print(f"FLUX offload transformer/VAE → {device}, CLIP+T5 on CPU, hooks={len(pipe._all_hooks)}", flush=True)


def _install_flux_offload_guards(pipe) -> None:
    """maybe_free_model_hooks re-runs enable_model_cpu_offload and would yank T5 to MPS again."""
    import types

    def _blocked_cpu_offload(self, *args, **kwargs):  # noqa: ARG001
        print("FLUX: enable_model_cpu_offload blocked (keeps T5 off MPS)", flush=True)
        _apply_flux_mps_offload(self)

    def _maybe_free(self):
        for component in self.components.values():
            if hasattr(component, "_reset_stateful_cache"):
                try:
                    component._reset_stateful_cache()
                except Exception:  # noqa: BLE001
                    pass
        _pin_flux_encoders_cpu(self)

    pipe.enable_model_cpu_offload = types.MethodType(_blocked_cpu_offload, pipe)
    pipe.maybe_free_model_hooks = types.MethodType(_maybe_free, pipe)


def _load_flux(model_path: str, local_files_only: bool, dtype):
    """FLUX on Mac: T5 stays on CPU; only transformer+VAE offload to MPS."""
    from diffusers import FluxPipeline

    load_kw = {"local_files_only": local_files_only}
    try:
        pipe = FluxPipeline.from_pretrained(model_path, dtype=dtype, **load_kw)
    except TypeError:
        pipe = FluxPipeline.from_pretrained(model_path, torch_dtype=dtype, **load_kw)

    try:
        pipe.enable_vae_slicing()
        if getattr(pipe, "vae", None) is not None:
            pipe.vae.enable_tiling()
    except Exception as e:  # noqa: BLE001
        print(f"VAE slice/tile skipped: {e}", flush=True)

    if torch.backends.mps.is_available():
        _install_flux_sliced_attention()
        _apply_flux_mps_offload(pipe)
        _install_flux_offload_guards(pipe)
    else:
        pipe.enable_model_cpu_offload()
        _pin_flux_encoders_cpu(pipe)

    pipe._acw_flux_mps_v3 = True
    print("FLUX ready (transformer/VAE offload, T5+CLIP on CPU, sliced attn)", flush=True)
    return pipe


def _pin_flux_t5(pipe) -> None:
    """T5 on MPS yields NaN embeddings and a 44 GiB Metal alloc. Keep encoders on CPU."""
    _pin_flux_encoders_cpu(pipe)


def _decode_data_url(image_base64: str):
    from PIL import Image

    raw = image_base64.split(",", 1)[1] if "," in image_base64 else image_base64
    return Image.open(BytesIO(base64.b64decode(raw))).convert("RGB")


def _fit_resize(img, width: int, height: int):
    """Keep the whole photo (faces included); letterbox instead of cropping heads."""
    from PIL import Image

    src_w, src_h = img.size
    scale = min(width / src_w, height / src_h)
    new_w = max(1, int(src_w * scale))
    new_h = max(1, int(src_h * scale))
    fitted = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (width, height), (16, 16, 16))
    canvas.paste(fitted, ((width - new_w) // 2, (height - new_h) // 2))
    return canvas


def _collage_init_images(payloads: List[str], size: tuple[int, int]):
    """One photo fills the frame. Several photos are not used as a split-screen canvas."""
    images = [_decode_data_url(p) for p in payloads[:4] if p]
    if not images:
        return None
    if len(images) == 1:
        return _fit_resize(images[0], size[0], size[1])
    return None


def _wants_new_scene(prompt: str) -> bool:
    text = (prompt or "").lower()
    return bool(re.search(
        r"ринг|ring|бокс|boxer|бой\b|fight|versus|друг против|друг с другом|"
        r"создай|create a |сгенерируй|на ринге|полный рост|full body|scene",
        text,
    ))


def _effective_format(request: GenerationRequest) -> str:
    """Action scenes in a square crop heads; prefer wide unless the user picked portrait."""
    if request.format == "portrait":
        return "portrait"
    if request.format == "wide":
        return "wide"
    if _wants_new_scene(request.prompt):
        return "wide"
    return request.format


def _norm_job(job: str) -> str:
    value = (job or "title").strip().lower()
    return value if value in ("title", "frame", "product") else "title"


def _pick_strength(request: GenerationRequest, n_refs: int) -> float:
    """One reference is a starting picture: keep structure, follow the prompt."""
    if n_refs <= 0:
        return 1.0
    if n_refs >= 2:
        return 1.0
    if _wants_new_scene(request.prompt):
        return 0.82
    return 0.7


_STYLE_HINTS = {
    "cinematic": "cinematic lighting",
    "bold": "vivid, sharp",
    "subtle": "",
}

_DRAW_VERB = re.compile(
    r"(?i)^(нарисуй|нарисовать|нарисуйте|сгенерируй|сгенерировать|создай|нарисуй-ка|"
    r"draw|generate|create)\s+",
)

_UI_RX = re.compile(
    r"(?i)титр|title\s*card|\bui\b|шаблон|template|ecommerce|интернет-?магазин|"
    r"админк|dashboard|конструктор|page builder|витрин|storefront|каталог|"
    r"angular|react|next\.?js|website|веб-?сайт|интерфейс|web app|saas",
)

# CLIP is English-only. Russian-only prompts are ignored unless we translate intent.
_GLOSSARY = (
    (re.compile(r"(?i)титр|title\s*card"), "cinematic title card"),
    (re.compile(r"(?i)шаблон|template"), "software website template"),
    (re.compile(r"(?i)админк"), "admin dashboard UI"),
    (re.compile(r"(?i)конструктор|page builder"), "page builder UI"),
    (re.compile(r"(?i)ecommerce|интернет-?магазин"), "ecommerce website"),
    (re.compile(r"(?i)тёмн\w*\s*ui|темн\w*\s*ui|dark\s*ui"), "dark user interface"),
    (re.compile(r"(?i)3d[- ]?товар"), "3D product viewer on a webpage"),
    (re.compile(r"(?i)пекар[ьяюе]?"), "a baker in a bakery, bread, flour, white apron, oven"),
    (re.compile(r"(?i)повар[а-я]*"), "a chef cooking in a kitchen"),
    (re.compile(r"(?i)боксер[а-я]*|boxer"), "a boxer in a boxing ring"),
    (re.compile(r"(?i)кошк[а-я]*|\bкот[аеу]?\b"), "a cat"),
    (re.compile(r"(?i)собак[а-я]*|\bпёс\b|\bпес\b"), "a dog"),
)


def _normalize_prompt(prompt: str) -> str:
    text = (prompt or "").strip()
    text = re.sub(r"(?i)майк[аеуы]?\s+тайсон[а-я]*", "Mike Tyson", text)
    text = _DRAW_VERB.sub("", text).strip(" .,:;")
    return text


def _glossary_en(text: str) -> str:
    hits = [en for rx, en in _GLOSSARY if rx.search(text)]
    return ", ".join(hits)


def _latin_product_names(text: str) -> str:
    names = re.findall(
        r"\b[A-Z][A-Za-z0-9.+#]*(?:[ \-][A-Z0-9][A-Za-z0-9.+#]*)*",
        text or "",
    )
    skip = {"UI", "UX", "API", "3D", "SKU", "GLB", "OBJ", "TTS"}
    cleaned = [name.strip(" —–-") for name in names if name.strip() and name.strip() not in skip]
    return ", ".join(dict.fromkeys(cleaned))


def _english_clip_prompt(text: str, job: str = "title", english: str | None = None) -> str:
    """Short English CLIP subject. CLIP is ~77 tokens and ignores Russian."""
    job = _norm_job(job)
    parts: list[str] = []
    subject = (english or "").strip()
    if subject:
        parts.append(subject)
    names = _latin_product_names(text)
    if names:
        parts.append(names)
    if job == "product":
        if not subject:
            gloss = _glossary_en(text)
            if gloss:
                parts.append(gloss)
        parts.extend([
            "studio catalog product photograph",
            "product on a clean background",
        ])
        return _dedupe_parts(parts)
    if job == "frame":
        parts.append("cinematic video still frame")
        if _UI_RX.search(text):
            parts.append("photorealistic software user interface")
        elif re.search(r"(?i)тёмн|темн|dark", text):
            parts.append("dark cinematic lighting")
        if not subject:
            gloss = _glossary_en(text)
            if gloss:
                parts.append(gloss)
        return _dedupe_parts(parts)
    if re.search(r"(?i)титр|title\s*card", text):
        parts.append("cinematic title card")
    if _UI_RX.search(text):
        parts.extend([
            "dark ecommerce website user interface",
            "admin dashboard and 3D product viewer",
            "photorealistic software UI screenshot",
        ])
    if re.search(r"(?i)тёмн|темн|dark", text):
        parts.append("dark charcoal theme")
    if not subject and not _UI_RX.search(text):
        gloss = _glossary_en(text)
        if gloss:
            parts.append(gloss)
    return _dedupe_parts(parts)


def _dedupe_parts(parts: list[str]) -> str:
    seen: set[str] = set()
    out: list[str] = []
    for part in parts:
        if part and part not in seen:
            seen.add(part)
            out.append(part)
    return ", ".join(out)


def _t5_constraints(text: str, job: str = "title") -> str:
    job = _norm_job(job)
    if job == "product":
        return (
            "Photorealistic product photo matching the prompt. "
            "Not a title card, not a website screenshot."
        )
    if job == "frame":
        return "Cinematic still for a video storyboard. Grounded, not a cute isometric toy."
    if not _UI_RX.search(text):
        return ""
    return (
        "Dark-themed software UI title card of a real website template. "
        "Not a physical shop interior, not pastel, not cute isometric, not a toy store."
    )


def _resolved_english(prompt: str, english: str | None) -> str:
    if english and english.strip():
        return english.strip()
    from prompt_en import to_english
    return to_english(prompt, allow_ollama=False).english


def _flux_prompt_pair(
    prompt: str,
    n_refs: int,
    style: str,
    job: str = "title",
    english: str | None = None,
) -> tuple[str, str]:
    """CLIP prompt (English) + T5 prompt (user language + English subject)."""
    job = _norm_job(job)
    text = _normalize_prompt(prompt)
    en = _resolved_english(text, english)
    steer = _english_clip_prompt(text, job, english=en)
    gloss = _glossary_en(text)
    style_hint = _STYLE_HINTS.get(style, "")
    has_cyrillic = bool(re.search(r"[а-яА-ЯёЁ]", text))
    constraints = _t5_constraints(text, job)
    if has_cyrillic:
        clip = steer or en or gloss or "photorealistic photograph of the described subject"
        t5 = text
        extra = " ".join(p for p in (en, steer, constraints) if p)
        if extra:
            t5 = f"{text}. {extra}"
    else:
        clip = steer or text or "photorealistic photograph"
        t5 = f"{text}. {constraints}".strip(" .") if constraints else text
    if n_refs == 1:
        clip = f"{clip}, same composition and subject as the reference"
        t5 = (
            f"{t5}. Keep the same object, pose, and framing as the reference. "
            "Change only what the prompt asks: color, material, extra details, or look."
        )
    elif n_refs >= 2:
        clip = f"{clip}, two people in one scene, full bodies"
        t5 = f"{t5}. One coherent scene, not a collage."
    if style_hint:
        clip = f"{clip}, {style_hint}"
    return clip.strip(" ,"), t5.strip(" ,")


def _enrich_prompt(
    prompt: str,
    n_refs: int,
    style: str,
    job: str = "title",
    english: str | None = None,
) -> str:
    """Non-FLUX path: keep the user subject first, do not bury it in style tags."""
    clip, t5 = _flux_prompt_pair(prompt, n_refs, style, job, english=english)
    if clip == t5:
        return clip
    return f"{t5}. {clip}"


def _collect_init_payloads(request: GenerationRequest) -> List[str]:
    payloads: List[str] = []
    if request.images_base64:
        payloads.extend(p for p in request.images_base64 if p)
    if request.image_base64:
        payloads.append(request.image_base64)
    # Dedupe identical data URLs while keeping order.
    seen = set()
    unique: List[str] = []
    for p in payloads:
        if p in seen:
            continue
        seen.add(p)
        unique.append(p)
    return unique


def _img2img_pipe(text2img_pipe):
    """SD/SDXL only. Do not clone FLUX — from_pipe on MPS leaves placeholder buffers."""
    cached = getattr(text2img_pipe, "_acw_img2img", None)
    if cached is not None:
        return cached
    from diffusers import AutoPipelineForImage2Image

    img_pipe = AutoPipelineForImage2Image.from_pipe(text2img_pipe)
    text2img_pipe._acw_img2img = img_pipe
    return img_pipe


def _is_dtype_mismatch(err: BaseException) -> bool:
    msg = str(err).lower()
    return "should be the same" in msg and ("bias type" in msg or "input type" in msg)


def _is_mps_placeholder(err: BaseException) -> bool:
    """Metal refused a huge buffer (OOM, placeholder, 40GB+ invalid size)."""
    msg = str(err).lower()
    needles = (
        "placeholder storage",
        "invalid buffer size",
        "mps_oom",
        "out of memory",
        "not enough memory",
        "failed to allocate",
        "insufficient memory",
    )
    if any(s in msg for s in needles):
        return True
    return "mps device" in msg and "allocat" in msg


def _is_device_mismatch(err: BaseException) -> bool:
    msg = str(err).lower()
    return "expected on mps" in msg and "on cpu" in msg


def _flux_exec_device(pipe):
    """Where the transformer actually runs. cpu_offload leaves weights on CPU until the step."""
    try:
        dev = pipe._execution_device
        if dev is not None and getattr(dev, "type", str(dev)) != "cpu":
            return torch.device(dev)
    except Exception:  # noqa: BLE001
        pass
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def _encode_flux_on_cpu(pipe, clip_prompt: str, t5_prompt: str, max_sequence_length: int):
    """CLIP+T5 forward on CPU tensors only — never through Accelerate MPS hooks."""
    tok_len = int(getattr(pipe, "tokenizer_max_length", 77) or 77)
    clip_ids = pipe.tokenizer(
        clip_prompt,
        padding="max_length",
        max_length=tok_len,
        truncation=True,
        return_tensors="pt",
    ).input_ids.to("cpu")
    clip_out = pipe.text_encoder(clip_ids, output_hidden_states=False)
    pooled = clip_out.pooler_output if hasattr(clip_out, "pooler_output") else clip_out[1]
    t5_ids = pipe.tokenizer_2(
        t5_prompt,
        padding="max_length",
        max_length=max_sequence_length,
        truncation=True,
        return_tensors="pt",
    ).input_ids.to("cpu")
    prompt_embeds = pipe.text_encoder_2(t5_ids, output_hidden_states=False)[0]
    return prompt_embeds, pooled


def _encode_flux_prompts(pipe, clip_prompt: str, t5_prompt: str, max_sequence_length: int) -> dict:
    """Encode CLIP+T5 on CPU (T5 on MPS is NaN), then move embeds to the MPS execution device.

    Do not use transformer.parameters().device: with enable_model_cpu_offload that is CPU,
    so embeds stay on CPU while the hooked transformer runs on MPS.
    """
    _pin_flux_encoders_cpu(pipe)
    with torch.inference_mode():
        try:
            encoded = _encode_flux_on_cpu(pipe, clip_prompt, t5_prompt, max_sequence_length)
        except Exception as direct_err:  # noqa: BLE001
            print(f"FLUX direct CPU encode failed ({direct_err}); encode_prompt fallback", flush=True)
            try:
                encoded = pipe.encode_prompt(
                    prompt=clip_prompt,
                    prompt_2=t5_prompt,
                    device=torch.device("cpu"),
                    num_images_per_prompt=1,
                    max_sequence_length=max_sequence_length,
                )
            except TypeError:
                encoded = pipe.encode_prompt(
                    prompt=clip_prompt,
                    device=torch.device("cpu"),
                    num_images_per_prompt=1,
                    max_sequence_length=max_sequence_length,
                )
    prompt_embeds = encoded[0]
    pooled = encoded[1]
    if torch.isnan(prompt_embeds).any() or torch.isinf(prompt_embeds).any():
        raise RuntimeError(
            "FLUX text embeddings are NaN. Unload the model in Studio and generate again."
        )
    dtype = next(pipe.transformer.parameters()).dtype
    device = _flux_exec_device(pipe)
    out = {
        "prompt_embeds": prompt_embeds.to(device=device, dtype=dtype),
        "pooled_prompt_embeds": pooled.to(device=device, dtype=dtype),
    }
    # FluxPipeline.__call__ has no text_ids kwarg; it rebuilds ids on the execution device.
    print(
        f"FLUX prompts clip={clip_prompt!r} t5={t5_prompt!r} embeds={tuple(out['prompt_embeds'].shape)} "
        f"embed_device={out['prompt_embeds'].device} exec={device}",
        flush=True,
    )
    return out


def _run_pipe(pipe, request: GenerationRequest, infer_kwargs: dict, init_image, width: int, height: int, strength: float):

    kwargs = attach_step_callback(dict(infer_kwargs), int(infer_kwargs.get("num_inference_steps") or 20))
    if _is_flux(request.model_id):
        clip = kwargs.pop("prompt")
        t5 = kwargs.pop("prompt_2", clip)
        max_len = kwargs.pop("max_sequence_length", 512)
        kwargs.update(_encode_flux_prompts(pipe, clip, t5, max_len))
        kwargs["width"] = width
        kwargs["height"] = height
        kwargs.pop("image", None)
        kwargs.pop("strength", None)
        if init_image is not None:
            print("FLUX text-to-image: attached photos are not used as a canvas", flush=True)
        return _call_pipe(pipe, kwargs)

    if init_image is not None:
        kwargs["image"] = init_image
        kwargs["strength"] = strength
        kwargs.pop("width", None)
        kwargs.pop("height", None)
        return _call_pipe(_img2img_pipe(pipe), kwargs)

    kwargs["width"] = width
    kwargs["height"] = height
    kwargs.pop("image", None)
    kwargs.pop("strength", None)
    return _call_pipe(pipe, kwargs)


def _call_pipe(pipe, kwargs):
    try:
        return pipe(**kwargs).images[0]
    except TypeError:
        kwargs.pop("callback_on_step_end", None)
        return pipe(**kwargs).images[0]


def _run_inference(pipe, request: GenerationRequest, job_id: str) -> str:
    """Blocking inference + save. GPU worker thread only."""
    payloads = _collect_init_payloads(request)
    fmt = _effective_format(request)
    width, height = _pick_size(request.model_id, fmt)
    steps = _pick_steps(request.model_id)
    guidance = _pick_guidance(request.model_id)
    strength = _pick_strength(request, len(payloads))
    init_image = _collage_init_images(payloads, (width, height)) if payloads else None
    if len(payloads) >= 2:
        init_image = None
        strength = 1.0
    english = (request.english_prompt or "").strip() or None
    prompt = _enrich_prompt(request.prompt, len(payloads), request.style, request.job, english=english)
    clip_prompt, t5_prompt = _flux_prompt_pair(
        request.prompt, len(payloads), request.style, request.job, english=english,
    )
    cache_key = _to_cache_key(request.model_id)
    if _is_flux(request.model_id):
        _pin_flux_t5(pipe)

    set_runtime_job(
        active=True,
        kind="image",
        stage="infer",
        percent=10,
        detail=f"{width}x{height}",
        model_id=request.model_id,
        started_at=time.time(),
        error=None,
        cancel=False,
    )
    print(
        f"[{job_id}] Generating on MPS ({width}x{height}) model={request.model_id} "
        f"steps={steps} guidance={guidance} refs={len(payloads)} strength={strength} "
        f"clip={clip_prompt!r} t5={t5_prompt!r}",
        flush=True,
    )
    generator = torch.Generator(device="cpu").manual_seed(int(time.time()))
    infer_kwargs = {
        "prompt": clip_prompt if _is_flux(request.model_id) else prompt,
        "output_type": "pil",
        "num_inference_steps": steps,
        "guidance_scale": guidance,
        "generator": generator,
    }
    if _is_flux(request.model_id):
        infer_kwargs["prompt_2"] = t5_prompt
        infer_kwargs["max_sequence_length"] = 256 if _on_apple_silicon() or "schnell" in request.model_id.lower() else 512

    try:
        image = _run_pipe(pipe, request, infer_kwargs, init_image, width, height, strength)
    except Exception as err:
        if _is_device_mismatch(err) and _is_flux(request.model_id):
            print(f"[{job_id}] embeds on CPU vs MPS transformer — retrying with exec-device embeds", flush=True)
            _pin_flux_t5(pipe)
            image = _run_pipe(pipe, request, infer_kwargs, init_image, width, height, strength)
        elif _is_dtype_mismatch(err) and _is_flux(request.model_id):
            print(f"[{job_id}] dtype mismatch — aligning T5 with transformer and retrying", flush=True)
            _pin_flux_t5(pipe)
            image = _run_pipe(pipe, request, infer_kwargs, init_image, width, height, strength)
        elif not _is_mps_placeholder(err):
            raise
        else:
            print(f"[{job_id}] MPS OOM ({err}) — unloading poisoned pipeline and retrying 512px", flush=True)
            _unload_model(cache_key)
            _, pipe = _get_pipeline(request.model_id)
            width, height = _pick_size(request.model_id, fmt, compact=True)
            init_image = _collage_init_images(payloads, (width, height)) if payloads and len(payloads) == 1 else None
            infer_kwargs["num_inference_steps"] = min(steps, 20)
            infer_kwargs["max_sequence_length"] = 256
            infer_kwargs["generator"] = torch.Generator(device="cpu").manual_seed(int(time.time()))
            try:
                image = _run_pipe(pipe, request, infer_kwargs, init_image, width, height, strength)
            except Exception as retry_err:
                _unload_model(cache_key)
                if _is_mps_placeholder(retry_err):
                    raise RuntimeError(
                        "MPS_OOM: The Mac GPU could not finish this generation. "
                        "Unload the model in Studio, use Square format, or attach fewer photos."
                    ) from retry_err
                raise

    output_dir = os.path.expanduser("~/Documents/Canvas/Generated")
    os.makedirs(output_dir, exist_ok=True)

    filepath = os.path.join(output_dir, f"{job_id}.png")
    image.save(filepath)
    try:
        image.close()
    except Exception:  # noqa: BLE001
        pass
    del image
    set_runtime_job(active=False, stage="idle", percent=100, detail="done")
    print(f"[{job_id}] DONE! Image saved to {filepath}", flush=True)
    return filepath


@router.post("/generate/image")
async def generate_image(request: GenerationRequest):
    job_id = f"job_{uuid.uuid4().hex[:12]}"
    print(f"[{job_id}] Starting generation for: {request.prompt}", flush=True)

    # Translate before FLUX loads. CLIP ignores Russian; Ollama must not sit next to FLUX.
    from prompt_en import to_english
    set_runtime_job(
        active=True,
        kind="image",
        stage="translate",
        percent=3,
        detail="RU→EN",
        model_id=request.model_id,
        started_at=time.time(),
        error=None,
        cancel=False,
    )
    prepared = await asyncio.to_thread(to_english, request.prompt, True)
    request.english_prompt = prepared.english
    print(
        f"[{job_id}] prompt_en source={prepared.source} leftover={prepared.leftover_cyrillic} "
        f"{prepared.english!r}",
        flush=True,
    )
    from ollama_rt import unload_model as unload_ollama
    await asyncio.to_thread(unload_ollama, prepared.model or "qwen2.5:7b")

    try:
        _ensure_ml()
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="PyTorch/diffusers are not installed in the sidecar environment. "
                   "Run: pip install torch diffusers",
        ) from None

    async with _generation_lock:
        cancel_idle_release()
        try:
            # One heavy MPS model at a time: release any resident 3D mesh model
            # before loading the image pipeline (symmetric with the 3D route).
            await run_on_gpu(_release_3d_models)
            # Load + infer on the GPU thread so FastAPI's loop stays free.
            _, pipe = await run_on_gpu(_get_pipeline, request.model_id)
            file_path = await run_on_gpu(_run_inference, pipe, request, job_id)
        except HTTPException:
            raise
        except Exception as e:
            clear_runtime_job(error=str(e)[:240])
            print(f"[{job_id}] ERROR during generation: {e}", flush=True)
            if _is_mps_placeholder(e):
                try:
                    await run_on_gpu(_unload_model, _to_cache_key(request.model_id))
                except Exception as unload_err:  # noqa: BLE001
                    print(f"[{job_id}] auto-unload after MPS error failed: {unload_err}", flush=True)
            else:
                # Don't leave a poisoned FLUX in RAM after a hard crash.
                try:
                    await run_on_gpu(_unload_model, _to_cache_key(request.model_id))
                except Exception:  # noqa: BLE001
                    pass
            raise HTTPException(status_code=500, detail=str(e))

    schedule_idle_release()
    return {"job_id": job_id, "status": "completed", "file_path": file_path}


def _drop_module(pipe, name: str) -> None:
    mod = getattr(pipe, name, None)
    if mod is None:
        return
    try:
        if hasattr(mod, "to"):
            mod.to("cpu")
    except Exception as e:  # noqa: BLE001
        print(f"[unload] {name}.to(cpu) failed: {e}", flush=True)
    try:
        setattr(pipe, name, None)
    except Exception:  # noqa: BLE001
        pass
    del mod


def _release_pipeline(pipe) -> None:
    clone = getattr(pipe, "_acw_img2img", None)
    if clone is not None and clone is not pipe:
        try:
            pipe._acw_img2img = None
        except Exception:  # noqa: BLE001
            pass
        _release_pipeline(clone)
        del clone
    if hasattr(pipe, "maybe_free_model_hooks"):
        try:
            pipe.maybe_free_model_hooks()
        except Exception as e:  # noqa: BLE001
            print(f"[unload] maybe_free_model_hooks: {e}", flush=True)
    for name in ("transformer", "vae", "text_encoder", "text_encoder_2", "controlnet", "image_encoder"):
        _drop_module(pipe, name)


def _mps_collect() -> None:
    gc.collect()
    if torch is None:
        return
    try:
        torch.mps.synchronize()
    except Exception:  # noqa: BLE001
        pass
    try:
        torch.mps.empty_cache()
    except Exception as e:  # noqa: BLE001
        print(f"[unload] torch.mps.empty_cache failed: {e}", flush=True)
    gc.collect()


def _unload_model(cache_key: str) -> bool:
    """Drop a pipeline from RAM and free MPS buffers. GPU worker thread only."""
    key = (cache_key or "").strip()
    if key.startswith("ollama:"):
        from ollama_rt import unload_model as unload_ollama

        return unload_ollama(key.split(":", 1)[1])
    if "triposr" in key.lower() or "hunyuan" in key.lower():
        _release_3d_models()
        return True
    pipe = pipeline_cache.pop(key, None)
    if pipe is None:
        _mps_collect()
        print(f"[unload] {key} not-cached cache_size={len(pipeline_cache)}", flush=True)
        return False
    try:
        _release_pipeline(pipe)
    except Exception as e:  # noqa: BLE001
        print(f"[unload] release failed: {e}", flush=True)
    del pipe
    _mps_collect()
    print(f"[unload] {key} dropped cache_size={len(pipeline_cache)}", flush=True)
    return True


def _unload_all_image_pipelines() -> int:
    """Drop every cached image pipeline. GPU worker thread only."""
    keys = list(pipeline_cache.keys())
    count = 0
    for key in keys:
        if _unload_model(key):
            count += 1
    return count


def _release_3d_models() -> None:
    """One heavy MPS model at a time: drop any resident 3D mesh model.
    GPU thread only."""
    try:
        from api.threed import _unload_triposr

        _unload_triposr()
    except Exception as e:  # noqa: BLE001
        print(f"[unload] triposr release failed: {e}", flush=True)
    try:
        from api import hunyuan3d as hunyuan3d_api

        hunyuan3d_api.unload_hunyuan()
    except Exception as e:  # noqa: BLE001
        print(f"[unload] hunyuan release failed: {e}", flush=True)


def _unload_ollama_all() -> int:
    try:
        from ollama_rt import loaded_models, unload_model as unload_ollama
    except Exception:  # noqa: BLE001
        return 0
    count = 0
    for name in loaded_models():
        if unload_ollama(name):
            count += 1
    return count


def _unload_all_models() -> int:
    """Drop image + 3D + Ollama. GPU worker thread only for MPS parts."""
    count = _unload_all_image_pipelines()
    _release_3d_models()
    count += _unload_ollama_all()
    return count


class UnloadRequest(BaseModel):
    cache_key: Optional[str] = None
    model_id: Optional[str] = None


@router.get("/runtime/status")
async def runtime_status():
    return runtime_status_payload()


@router.post("/runtime/cancel")
async def runtime_cancel():
    set_runtime_job(cancel=True, detail="cancelling")
    return {"ok": True}


@router.post("/models/unload-all")
async def unload_all_models():
    if _runtime_job.get("active"):
        raise HTTPException(status_code=409, detail="BUSY")
    cancel_idle_release()
    async with _generation_lock:
        count = await run_on_gpu(_unload_all_models)
    set_runtime_job(active=False, stage="released", percent=100, detail=f"unloaded {count}")
    return {"unloaded": count, "loaded": _owned_loaded_keys()}


@router.get("/models/loaded")
async def list_loaded_models():
    """Resources currently owned by the sidecar."""
    return {"loaded": _owned_loaded_keys()}


@router.post("/models/unload")
async def unload_model_body(request: UnloadRequest):
    """Unload from RAM without deleting files. Prefer this over the path route (FLUX ids contain dots)."""
    key = (request.cache_key or "").strip()
    if not key and request.model_id:
        key = _to_cache_key(request.model_id)
    if not key:
        raise HTTPException(status_code=400, detail="cache_key or model_id required")
    cancel_idle_release()
    async with _generation_lock:
        unloaded = await run_on_gpu(_unload_model, key)
    return {"unloaded": unloaded, "cache_size": len(pipeline_cache), "loaded": _owned_loaded_keys()}


@router.post("/models/{cache_key}/unload")
@router.delete("/models/{cache_key}")
async def unload_model(cache_key: str):
    """Unload from RAM without deleting files. DELETE kept for older IPC."""
    cancel_idle_release()
    async with _generation_lock:
        unloaded = await run_on_gpu(_unload_model, cache_key)
    return {"unloaded": unloaded, "cache_size": len(pipeline_cache), "loaded": _owned_loaded_keys()}
