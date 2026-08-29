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


def _ensure_ml():
    global torch, AutoPipelineForText2Image
    if torch is not None:
        return
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    os.environ.setdefault("PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0.0")
    import torch as _torch
    from diffusers import AutoPipelineForText2Image as _Pipe
    torch = _torch
    AutoPipelineForText2Image = _Pipe

router = APIRouter()


class GenerationRequest(BaseModel):
    prompt: str
    format: str = "square"
    style: str = "subtle"
    model_id: str = "OFA-Sys/small-stable-diffusion-v0"
    image_base64: Optional[str] = None
    images_base64: Optional[List[str]] = None
    strength: float = 0.72


# Reuse loaded weights across requests.
pipeline_cache: dict = {}

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


async def run_on_gpu(fn, *args):
    """Run a blocking GPU call on the dedicated worker thread."""
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    _ensure_gpu_thread()
    _gpu_queue.put((fn, args, future, loop))
    return await future


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


def _pick_size(model_id: str, request_format: str, compact: bool = False) -> tuple[int, int]:
    """Frame size. FLUX on MPS OOMs / hits placeholder bugs at 1024x1536; cap it."""
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
        return base, (base * 3) // 2
    if request_format == "wide":
        return (base * 3) // 2, base
    return base, base


def _get_pipeline(model_id: str, force: bool = False):
    """Return a cached pipeline or load one. Blocking — GPU worker thread only."""
    _ensure_ml()
    cache_key = _to_cache_key(model_id)
    if force and cache_key in pipeline_cache:
        _unload_model(cache_key)
    if cache_key in pipeline_cache:
        pipe = pipeline_cache[cache_key]
        if _is_flux(model_id) and type(pipe).__name__ == "FluxImg2ImgPipeline":
            print("Replacing cached FluxImg2Img with FluxPipeline (prompt following)", flush=True)
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


def _load_flux(model_path: str, local_files_only: bool, dtype):
    """FLUX on Mac: keep T5 on CPU, offload the rest so MPS is not filled with 24GB weights."""
    from diffusers import FluxPipeline

    load_kw = {"local_files_only": local_files_only}
    try:
        pipe = FluxPipeline.from_pretrained(model_path, dtype=dtype, **load_kw)
    except TypeError:
        pipe = FluxPipeline.from_pretrained(model_path, torch_dtype=dtype, **load_kw)

    exclude = list(getattr(pipe, "_exclude_from_cpu_offload", []) or [])
    if "text_encoder_2" not in exclude:
        exclude.append("text_encoder_2")
    pipe._exclude_from_cpu_offload = exclude
    if getattr(pipe, "text_encoder_2", None) is not None:
        pipe.text_encoder_2.to("cpu")

    try:
        pipe.enable_model_cpu_offload(device="mps")
    except TypeError:
        pipe.enable_model_cpu_offload()

    try:
        pipe.enable_vae_slicing()
        if getattr(pipe, "vae", None) is not None:
            pipe.vae.enable_tiling()
    except Exception as e:  # noqa: BLE001
        print(f"VAE slice/tile skipped: {e}", flush=True)

    print("FLUX ready (cpu offload → MPS, T5 on CPU)", flush=True)
    _pin_flux_t5(pipe)
    return pipe


def _pin_flux_t5(pipe) -> None:
    """T5 on MPS yields NaN embeddings. Keep it on CPU in the same dtype as the transformer."""
    te2 = getattr(pipe, "text_encoder_2", None)
    if te2 is None or torch is None:
        return
    dtype = torch.bfloat16
    try:
        tr = getattr(pipe, "transformer", None)
        if tr is not None:
            dtype = next(tr.parameters()).dtype
    except Exception:  # noqa: BLE001
        pass
    try:
        te2.to(device="cpu", dtype=dtype)
        dev = next(te2.parameters()).device
        print(f"T5 device={dev} dtype={next(te2.parameters()).dtype}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"T5 pin skipped: {e}", flush=True)


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


def _pick_strength(request: GenerationRequest, n_refs: int) -> float:
    """Collage+0.72 locks the layout to 'photos side by side'. Scene prompts need high strength."""
    if n_refs <= 0:
        return 1.0
    if n_refs >= 2:
        return 1.0
    if _wants_new_scene(request.prompt):
        return 0.82
    return 0.58


_STYLE_HINTS = {
    "cinematic": "cinematic",
    "bold": "vivid, sharp",
    "subtle": "",
}

_DRAW_VERB = re.compile(
    r"(?i)^(нарисуй|нарисовать|нарисуйте|сгенерируй|сгенерировать|создай|нарисуй-ка|"
    r"draw|generate|create)\s+",
)

# CLIP is English-only. Russian-only prompts are ignored and English style tags win.
_GLOSSARY = (
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


def _flux_prompt_pair(prompt: str, n_refs: int, style: str) -> tuple[str, str]:
    """CLIP prompt (English) + T5 prompt (user language + English subject)."""
    text = _normalize_prompt(prompt)
    gloss = _glossary_en(text)
    style_hint = _STYLE_HINTS.get(style, "")
    has_cyrillic = bool(re.search(r"[а-яА-ЯёЁ]", text))
    if has_cyrillic:
        clip = gloss or "photorealistic photograph of the described subject"
        t5 = text if not gloss else f"{text}, {gloss}"
    else:
        clip = text or "photorealistic photograph"
        t5 = text
    if n_refs >= 2:
        clip = f"{clip}, two people in one scene, full bodies"
        t5 = f"{t5}. One coherent scene, not a collage."
    if style_hint:
        clip = f"{clip}, {style_hint}"
    return clip.strip(" ,"), t5.strip(" ,")


def _enrich_prompt(prompt: str, n_refs: int, style: str) -> str:
    """Non-FLUX path: keep the user subject first, do not bury it in style tags."""
    clip, t5 = _flux_prompt_pair(prompt, n_refs, style)
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
    msg = str(err).lower()
    return "placeholder storage" in msg or ("mps device" in msg and "allocat" in msg) or msg.startswith("mps_oom")


def _encode_flux_prompts(pipe, clip_prompt: str, t5_prompt: str, max_sequence_length: int) -> dict:
    """Encode CLIP+T5 on CPU, then cast to transformer dtype. Detect NaN embeddings."""
    _pin_flux_t5(pipe)
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
    out = {
        "prompt_embeds": prompt_embeds.to(dtype=dtype),
        "pooled_prompt_embeds": pooled.to(dtype=dtype),
    }
    if len(encoded) >= 3 and encoded[2] is not None:
        out["text_ids"] = encoded[2]
    print(
        f"FLUX prompts clip={clip_prompt!r} t5={t5_prompt!r} embeds={tuple(prompt_embeds.shape)}",
        flush=True,
    )
    return out


def _run_pipe(pipe, request: GenerationRequest, infer_kwargs: dict, init_image, width: int, height: int, strength: float):

    kwargs = dict(infer_kwargs)
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
        return pipe(**kwargs).images[0]

    if init_image is not None:
        kwargs["image"] = init_image
        kwargs["strength"] = strength
        kwargs.pop("width", None)
        kwargs.pop("height", None)
        return _img2img_pipe(pipe)(**kwargs).images[0]

    kwargs["width"] = width
    kwargs["height"] = height
    kwargs.pop("image", None)
    kwargs.pop("strength", None)
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
    prompt = _enrich_prompt(request.prompt, len(payloads), request.style)
    clip_prompt, t5_prompt = _flux_prompt_pair(request.prompt, len(payloads), request.style)
    cache_key = _to_cache_key(request.model_id)
    if _is_flux(request.model_id):
        _pin_flux_t5(pipe)

    print(
        f"[{job_id}] Generating on MPS ({width}x{height}) model={request.model_id} "
        f"steps={steps} guidance={guidance} refs={len(payloads)} strength={strength} "
        f"prompt={prompt!r}",
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
        infer_kwargs["max_sequence_length"] = 256 if "schnell" in request.model_id.lower() else 512

    try:
        image = _run_pipe(pipe, request, infer_kwargs, init_image, width, height, strength)
    except RuntimeError as err:
        if _is_dtype_mismatch(err) and _is_flux(request.model_id):
            print(f"[{job_id}] dtype mismatch — aligning T5 with transformer and retrying", flush=True)
            _pin_flux_t5(pipe)
            image = _run_pipe(pipe, request, infer_kwargs, init_image, width, height, strength)
        elif not _is_mps_placeholder(err):
            raise
        else:
            print(f"[{job_id}] MPS placeholder — unloading poisoned pipeline and retrying 512px", flush=True)
            _unload_model(cache_key)
            _, pipe = _get_pipeline(request.model_id)
            width, height = _pick_size(request.model_id, fmt, compact=True)
            init_image = _collage_init_images(payloads, (width, height)) if payloads and len(payloads) == 1 else None
            infer_kwargs["num_inference_steps"] = min(steps, 20)
            infer_kwargs["max_sequence_length"] = 256
            infer_kwargs["generator"] = torch.Generator(device="cpu").manual_seed(int(time.time()))
            try:
                image = _run_pipe(pipe, request, infer_kwargs, init_image, width, height, strength)
            except RuntimeError as retry_err:
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
    print(f"[{job_id}] DONE! Image saved to {filepath}", flush=True)
    return filepath


@router.post("/generate/image")
async def generate_image(request: GenerationRequest):
    job_id = f"job_{uuid.uuid4().hex[:12]}"
    print(f"[{job_id}] Starting generation for: {request.prompt}", flush=True)

    try:
        _ensure_ml()
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="PyTorch/diffusers are not installed in the sidecar environment. "
                   "Run: pip install torch diffusers",
        ) from None

    async with _generation_lock:
        try:
            # Load + infer on the GPU thread so FastAPI's loop stays free.
            _, pipe = await run_on_gpu(_get_pipeline, request.model_id)
            file_path = await run_on_gpu(_run_inference, pipe, request, job_id)
        except HTTPException:
            raise
        except Exception as e:
            print(f"[{job_id}] ERROR during generation: {e}", flush=True)
            if _is_mps_placeholder(e):
                try:
                    await run_on_gpu(_unload_model, _to_cache_key(request.model_id))
                except Exception as unload_err:  # noqa: BLE001
                    print(f"[{job_id}] auto-unload after MPS error failed: {unload_err}", flush=True)
            raise HTTPException(status_code=500, detail=str(e))

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
    pipe = pipeline_cache.pop(cache_key, None)
    if pipe is None:
        _mps_collect()
        print(f"[unload] {cache_key} not-cached cache_size={len(pipeline_cache)}", flush=True)
        return False
    try:
        _release_pipeline(pipe)
    except Exception as e:  # noqa: BLE001
        print(f"[unload] release failed: {e}", flush=True)
    del pipe
    _mps_collect()
    print(f"[unload] {cache_key} dropped cache_size={len(pipeline_cache)}", flush=True)
    return True


class UnloadRequest(BaseModel):
    cache_key: Optional[str] = None
    model_id: Optional[str] = None


@router.get("/models/loaded")
async def list_loaded_models():
    """Pipelines currently held in sidecar RAM."""
    return {"loaded": list(pipeline_cache.keys())}


@router.post("/models/unload")
async def unload_model_body(request: UnloadRequest):
    """Unload from RAM without deleting files. Prefer this over the path route (FLUX ids contain dots)."""
    key = (request.cache_key or "").strip()
    if not key and request.model_id:
        key = _to_cache_key(request.model_id)
    if not key:
        raise HTTPException(status_code=400, detail="cache_key or model_id required")
    async with _generation_lock:
        unloaded = await run_on_gpu(_unload_model, key)
    return {"unloaded": unloaded, "cache_size": len(pipeline_cache), "loaded": list(pipeline_cache.keys())}


@router.post("/models/{cache_key}/unload")
@router.delete("/models/{cache_key}")
async def unload_model(cache_key: str):
    """Unload from RAM without deleting files. DELETE kept for older IPC."""
    async with _generation_lock:
        unloaded = await run_on_gpu(_unload_model, cache_key)
    return {"unloaded": unloaded, "cache_size": len(pipeline_cache), "loaded": list(pipeline_cache.keys())}
