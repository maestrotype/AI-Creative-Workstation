from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import base64
import gc
import queue as _queue
import threading
import time
import asyncio
import os
from io import BytesIO
from typing import Optional

# Load torch/diffusers lazily so /health binds in milliseconds.
# Importing them at module load blocks the port for 20–60s (or crashes).
torch = None
AutoPipelineForText2Image = None


def _ensure_ml():
    global torch, AutoPipelineForText2Image
    if torch is not None:
        return
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
        return 40
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


def _pick_size(model_id: str, request_format: str) -> tuple[int, int]:
    """Frame size. FLUX/SDXL train at 1024; 512 hurts prompt following. Tiny SD stays at 512."""
    base = 1024 if ("flux" in model_id.lower() or "sdxl" in model_id.lower()) else 512
    if request_format == "portrait":
        return base, int(base * 1.5)
    if request_format == "wide":
        return int(base * 1.5), base
    return base, base


def _get_pipeline(model_id: str):
    """Return a cached pipeline or load one. Blocking — GPU worker thread only."""
    _ensure_ml()
    cache_key = _to_cache_key(model_id)
    if cache_key in pipeline_cache:
        print(f"Using cached pipeline for {cache_key}", flush=True)
        return cache_key, pipeline_cache[cache_key]

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
    print(f"Loading model {model_path} into memory (MPS, dtype={dtype})...", flush=True)

    if _is_flux(model_id):
        from diffusers import FluxPipeline

        pipe = FluxPipeline.from_pretrained(
            model_path, torch_dtype=dtype, local_files_only=local_files_only
        )
        # T5 on MPS often yields NaN embeddings (pretty images unrelated to the prompt).
        # Keep CLIP on GPU; encode T5 on CPU.
        if getattr(pipe, "text_encoder", None) is not None:
            pipe.text_encoder.to("mps")
        if getattr(pipe, "text_encoder_2", None) is not None:
            pipe.text_encoder_2.to("cpu")
        pipe.transformer.to("mps")
        pipe.vae.to("mps")
        try:
            pipe.enable_attention_slicing()
        except Exception as e:  # noqa: BLE001
            print(f"enable_attention_slicing skipped: {e}", flush=True)
    else:
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


def _decode_init_image(image_base64: str, size: tuple[int, int]):
    from PIL import Image

    raw = image_base64.split(",", 1)[1] if "," in image_base64 else image_base64
    img = Image.open(BytesIO(base64.b64decode(raw))).convert("RGB")
    return img.resize(size, Image.Resampling.LANCZOS)


def _img2img_pipe(text2img_pipe):
    from diffusers import AutoPipelineForImage2Image

    try:
        return AutoPipelineForImage2Image.from_pipe(text2img_pipe)
    except Exception:
        from diffusers import FluxImg2ImgPipeline

        return FluxImg2ImgPipeline.from_pipe(text2img_pipe)


def _run_inference(pipe, request: GenerationRequest, job_id: str) -> str:
    """Blocking inference + save. GPU worker thread only."""
    width, height = _pick_size(request.model_id, request.format)

    steps = _pick_steps(request.model_id)
    guidance = _pick_guidance(request.model_id)
    init_image = None
    if request.image_base64:
        init_image = _decode_init_image(request.image_base64, (width, height))

    print(
        f"[{job_id}] Generating on MPS ({width}x{height}) model={request.model_id} "
        f"steps={steps} guidance={guidance} img2img={init_image is not None} "
        f"prompt={request.prompt!r}",
        flush=True,
    )
    generator = torch.Generator(device="cpu").manual_seed(int(time.time()))
    infer_kwargs = {
        "prompt": request.prompt,
        "output_type": "pil",
        "num_inference_steps": steps,
        "guidance_scale": guidance,
        "generator": generator,
    }
    if _is_flux(request.model_id):
        infer_kwargs["max_sequence_length"] = 256 if "schnell" in request.model_id.lower() else 512

    if init_image is not None:
        infer_kwargs["image"] = init_image
        infer_kwargs["strength"] = request.strength
        image = _img2img_pipe(pipe)(**infer_kwargs).images[0]
    else:
        infer_kwargs["width"] = width
        infer_kwargs["height"] = height
        image = pipe(**infer_kwargs).images[0]

    output_dir = os.path.expanduser("~/Documents/Canvas/Generated")
    os.makedirs(output_dir, exist_ok=True)

    filepath = os.path.join(output_dir, f"{job_id}.png")
    image.save(filepath)
    print(f"[{job_id}] DONE! Image saved to {filepath}", flush=True)
    return filepath


@router.post("/generate/image")
async def generate_image(request: GenerationRequest):
    job_id = f"job_{int(time.time())}"
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
            raise HTTPException(status_code=500, detail=str(e))

    return {"job_id": job_id, "status": "completed", "file_path": file_path}


def _unload_model(cache_key: str) -> bool:
    """Drop a pipeline from RAM and free MPS buffers. GPU worker thread only."""
    pipe = pipeline_cache.pop(cache_key, None)
    unloaded = pipe is not None
    if pipe is not None:
        try:
            pipe.to("cpu")
        except Exception as e:  # noqa: BLE001
            print(f"[unload] Could not move {cache_key} to cpu: {e}", flush=True)
        del pipe
        gc.collect()
    if torch is not None:
        try:
            torch.mps.empty_cache()
        except Exception as e:  # noqa: BLE001
            print(f"[unload] torch.mps.empty_cache failed: {e}", flush=True)
    print(f"[unload] {cache_key} unloaded={unloaded} cache_size={len(pipeline_cache)}", flush=True)
    return unloaded


@router.get("/models/loaded")
async def list_loaded_models():
    """Pipelines currently held in sidecar RAM."""
    return {"loaded": list(pipeline_cache.keys())}


@router.post("/models/{cache_key}/unload")
@router.delete("/models/{cache_key}")
async def unload_model(cache_key: str):
    """Unload from RAM without deleting files. DELETE kept for older IPC."""
    if cache_key not in pipeline_cache:
        return {"unloaded": False, "reason": "not-cached", "cache_size": len(pipeline_cache)}
    unloaded = await run_on_gpu(_unload_model, cache_key)
    return {"unloaded": unloaded, "cache_size": len(pipeline_cache)}
