"""Product video. Ad clips go through Runway Gen-4.5; local Wan/SVD are not the ad path."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import asyncio
import os
import tempfile
import time
import uuid

from api import generation
from api import h3_local
from api import runway_cloud
from api.video import _ffmpeg_bin, _run_ffmpeg

router = APIRouter()

WAN_NEG = (
    "Bright tones, overexposed, static, blurred details, subtitles, worst quality, "
    "low quality, JPEG artifacts, ugly, deformed, still picture, watermark"
)


class VideoGenRequest(BaseModel):
    prompt: str = ""
    format: str = "wide"
    duration_sec: float = 5.0
    model_id: str = "MiniMaxAI/MiniMax-H3"
    image_path: Optional[str] = None
    api_secret: Optional[str] = None
    h3_endpoint: Optional[str] = None


def _is_wan(model_id: str) -> bool:
    return "wan" in model_id.lower()


def _is_svd(model_id: str) -> bool:
    key = model_id.lower()
    return "stable-video-diffusion" in key or "img2vid" in key


def _on_apple_silicon() -> bool:
    generation._ensure_ml()
    torch = generation.torch
    return bool(torch.backends.mps.is_available() and not torch.cuda.is_available())


def _frame_count(duration_sec: float, *, compact: bool = False) -> int:
    """Wan needs num_frames = 4n+1. Keep Mac clips short to avoid Metal OOM."""
    fps = 16
    max_frames = 33 if compact else 49  # ~2s on Mac, ~3s elsewhere
    target = max(17, min(max_frames, int(round(max(1.0, duration_sec) * fps))))
    n = max(4, (target - 1) // 4)
    return n * 4 + 1


def _size(fmt: str, *, compact: bool = False) -> tuple[int, int]:
    if compact:
        if fmt in ("portrait", "shorts"):
            return 272, 480
        return 480, 272
    if fmt in ("portrait", "shorts"):
        return 480, 832
    return 832, 480


def _attach_video_pipe(pipe):
    """Never load the full Wan stack onto MPS — that crashes Python on Mac."""
    generation._ensure_ml()
    torch = generation.torch
    if torch.cuda.is_available():
        return pipe.to("cuda")
    if _on_apple_silicon():
        for hook in (pipe.enable_sequential_cpu_offload, pipe.enable_model_cpu_offload):
            try:
                hook()
                return pipe
            except Exception as err:  # noqa: BLE001
                print(f"[motion] offload hook failed: {err}", flush=True)
        print("[motion] running Wan on CPU (slow but stable)", flush=True)
        return pipe.to("cpu")
    return pipe.to("cpu")


def _get_video_pipe(model_id: str, *, force: bool = False):
    generation._ensure_ml()
    cache_key = generation._to_cache_key(model_id)
    if force and cache_key in generation.pipeline_cache:
        generation._unload_model(cache_key)
    if cache_key in generation.pipeline_cache:
        return generation.pipeline_cache[cache_key]

    # Wan needs several GB — drop image pipelines first.
    dropped = generation._unload_all_models()
    if dropped:
        print(f"[motion] freed {dropped} cached pipeline(s) before Wan load", flush=True)

    local_dir = os.path.expanduser(f"~/Documents/Canvas/Models/{cache_key}")
    if not os.path.isdir(local_dir):
        raise RuntimeError(
            "VIDEO_MODEL_MISSING: Download Wan 2.1 T2V in Studio → Video first."
        )

    from diffusers import AutoencoderKLWan, WanPipeline

    torch = generation.torch
    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
    vae = AutoencoderKLWan.from_pretrained(
        local_dir, subfolder="vae", torch_dtype=torch.float32, local_files_only=True
    )
    try:
        pipe = WanPipeline.from_pretrained(
            local_dir, vae=vae, dtype=dtype, local_files_only=True
        )
    except TypeError:
        pipe = WanPipeline.from_pretrained(
            local_dir, vae=vae, torch_dtype=dtype, local_files_only=True
        )
    pipe = _attach_video_pipe(pipe)
    generation.pipeline_cache[cache_key] = pipe
    print(f"[motion] loaded {model_id} cache_key={cache_key}", flush=True)
    return pipe


def _to_pil(frame):
    if hasattr(frame, "save"):
        return frame
    from PIL import Image
    import numpy as np

    arr = np.asarray(frame)
    if arr.ndim == 4:
        arr = arr[0]
    # CHW → HWC
    if arr.ndim == 3 and arr.shape[0] in (1, 3, 4) and arr.shape[-1] not in (1, 3, 4):
        arr = np.transpose(arr, (1, 2, 0))
    if arr.dtype != np.uint8:
        if arr.dtype.kind == "f":
            peak = float(np.nanmax(arr)) if arr.size else 0.0
            if peak <= 1.5:
                arr = np.clip(arr, 0.0, 1.0) * 255.0
            else:
                arr = np.clip(arr, 0.0, 255.0)
            arr = arr.round().astype(np.uint8)
        else:
            arr = np.clip(arr, 0, 255).astype(np.uint8)
    if arr.ndim == 3 and arr.shape[-1] == 4:
        arr = arr[..., :3]
    return Image.fromarray(arr)


def _frame_list(frames) -> list:
    if frames is None:
        return []
    if hasattr(frames, "save"):
        return [frames]
    try:
        length = len(frames)
    except TypeError:
        return []
    if length == 0:
        return []
    first = frames[0]
    # Wan often returns (T, H, W, C) ndarray — truthiness of that array is invalid.
    if hasattr(first, "ndim") and getattr(first, "ndim", 0) == 3:
        return [_to_pil(item) for item in frames]
    if hasattr(frames, "ndim") and getattr(frames, "ndim", 0) == 4:
        return [_to_pil(frames[i]) for i in range(frames.shape[0])]
    return [_to_pil(item) for item in frames]


def _encode_frames(frames, fps: int, dest: str) -> None:
    images = _frame_list(frames)
    if not images:
        raise RuntimeError("Wan returned no frames")
    ffmpeg = _ffmpeg_bin()
    with tempfile.TemporaryDirectory() as tmp:
        for i, frame in enumerate(images):
            frame.save(os.path.join(tmp, f"{i:05d}.png"))
        _run_ffmpeg(
            [
                ffmpeg, "-y", "-framerate", str(fps),
                "-i", os.path.join(tmp, "%05d.png"),
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", dest,
            ],
            "ffmpeg motion encode failed",
        )


def _infer_wan(pipe, request: VideoGenRequest, *, compact: bool):
    width, height = _size(request.format, compact=compact)
    frames_n = _frame_count(request.duration_sec, compact=compact)
    steps = 20 if compact else 30
    prompt = request.prompt.strip()
    print(
        f"[motion] Wan T2V {width}x{height} frames={frames_n} steps={steps} prompt={prompt[:80]!r}",
        flush=True,
    )
    kwargs = {
        "prompt": prompt,
        "negative_prompt": WAN_NEG,
        "height": height,
        "width": width,
        "num_frames": frames_n,
        "guidance_scale": 5.0,
        "num_inference_steps": steps,
    }
    kwargs = generation.attach_step_callback(kwargs, steps)
    try:
        out = pipe(**kwargs)
    except TypeError:
        kwargs.pop("callback_on_step_end", None)
        out = pipe(**kwargs)
    return out.frames[0], frames_n


def _run_wan(request: VideoGenRequest, job_id: str) -> str:
    generation.set_runtime_job(
        active=True,
        kind="video",
        stage="load",
        percent=4,
        detail="Wan",
        model_id=request.model_id,
        started_at=time.time(),
        error=None,
        cancel=False,
    )
    compact = _on_apple_silicon()
    cache_key = generation._to_cache_key(request.model_id)
    try:
        pipe = _get_video_pipe(request.model_id)
        frames, frames_n = _infer_wan(pipe, request, compact=compact)
    except RuntimeError as err:
        if not generation._is_mps_placeholder(err):
            raise
        print(f"[{job_id}] Wan MPS OOM — retrying smaller clip", flush=True)
        generation._unload_model(cache_key)
        pipe = _get_video_pipe(request.model_id, force=True)
        frames, frames_n = _infer_wan(pipe, request, compact=True)
    except Exception as err:
        if not generation._is_mps_placeholder(err):
            raise
        print(f"[{job_id}] Wan GPU error — retrying smaller clip", flush=True)
        generation._unload_model(cache_key)
        pipe = _get_video_pipe(request.model_id, force=True)
        frames, frames_n = _infer_wan(pipe, request, compact=True)

    dest_dir = os.path.expanduser("~/Documents/Canvas/Generated/Video")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, f"{job_id}.mp4")
    generation.set_runtime_job(stage="encode", percent=92, detail="ffmpeg")
    _encode_frames(frames, 16, dest)
    generation.set_runtime_job(active=False, stage="idle", percent=100, detail="done")
    print(f"[{job_id}] motion saved {dest} frames={frames_n}", flush=True)
    return dest


def _fit_product_image(path: str, fmt: str):
    from PIL import Image, ImageFilter

    if not path or not os.path.isfile(path):
        raise RuntimeError("IMAGE_REQUIRED: Import a product photo into the scene first.")
    image = Image.open(path).convert("RGB")
    # SVD-XT is trained at 1024×576. Keep the whole product in frame (contain),
    # fill empty bands with a blurred cover of the same photo — crop chops bags.
    tw, th = 1024, 576
    _ = fmt
    src_w, src_h = image.size
    cover = max(tw / max(1, src_w), th / max(1, src_h))
    bg = image.resize(
        (max(1, int(src_w * cover)), max(1, int(src_h * cover))),
        Image.Resampling.LANCZOS,
    )
    left = max(0, (bg.width - tw) // 2)
    top = max(0, (bg.height - th) // 2)
    bg = bg.crop((left, top, left + tw, top + th)).filter(ImageFilter.GaussianBlur(28))
    contain = min(tw / max(1, src_w), th / max(1, src_h))
    fg = image.resize(
        (max(1, int(src_w * contain)), max(1, int(src_h * contain))),
        Image.Resampling.LANCZOS,
    )
    canvas = bg.copy()
    canvas.paste(fg, ((tw - fg.width) // 2, (th - fg.height) // 2))
    return canvas


def _get_svd_pipe(model_id: str, *, force: bool = False):
    generation._ensure_ml()
    cache_key = generation._to_cache_key(model_id)
    if force and cache_key in generation.pipeline_cache:
        generation._unload_model(cache_key)
    if cache_key in generation.pipeline_cache:
        return generation.pipeline_cache[cache_key]

    dropped = generation._unload_all_models()
    if dropped:
        print(f"[motion] freed {dropped} pipeline(s) before SVD load", flush=True)

    local_dir = os.path.expanduser(f"~/Documents/Canvas/Models/{cache_key}")
    if not os.path.isdir(local_dir):
        raise RuntimeError(
            "VIDEO_MODEL_MISSING: Download SVD XT (image→video) in Studio → Video."
        )

    from diffusers import StableVideoDiffusionPipeline

    torch = generation.torch
    dtype = torch.float32 if _on_apple_silicon() else torch.float16
    pipe = StableVideoDiffusionPipeline.from_pretrained(
        local_dir, torch_dtype=dtype, local_files_only=True
    )
    if torch.cuda.is_available():
        pipe = pipe.to("cuda")
    elif _on_apple_silicon():
        try:
            pipe.enable_model_cpu_offload()
        except Exception:
            pipe = pipe.to("mps")
    else:
        pipe = pipe.to("cpu")
    generation.pipeline_cache[cache_key] = pipe
    print(f"[motion] loaded SVD {model_id}", flush=True)
    return pipe


def _run_svd(request: VideoGenRequest, job_id: str) -> str:
    generation.set_runtime_job(
        active=True,
        kind="video",
        stage="load",
        percent=4,
        detail="SVD",
        model_id=request.model_id,
        started_at=time.time(),
        error=None,
        cancel=False,
    )
    image = _fit_product_image(request.image_path or "", request.format)
    generation.set_runtime_job(stage="infer", percent=12, detail="img2vid")
    pipe = _get_svd_pipe(request.model_id)
    torch = generation.torch
    frames_n = 14 if _on_apple_silicon() else 25
    steps = 20 if _on_apple_silicon() else 25
    kwargs = {
        "image": image,
        "num_frames": frames_n,
        "num_inference_steps": steps,
        "motion_bucket_id": 40,
        "noise_aug_strength": 0.02,
        "decode_chunk_size": 2,
        "generator": torch.Generator(device="cpu").manual_seed(42),
    }
    kwargs = generation.attach_step_callback(kwargs, steps)
    try:
        out = pipe(**kwargs)
    except TypeError:
        kwargs.pop("callback_on_step_end", None)
        out = pipe(**kwargs)
    frames = out.frames[0]
    dest_dir = os.path.expanduser("~/Documents/Canvas/Generated/Video")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, f"{job_id}.mp4")
    generation.set_runtime_job(stage="encode", percent=92, detail="ffmpeg")
    _encode_frames(frames, 7, dest)
    generation.set_runtime_job(active=False, stage="idle", percent=100, detail="done")
    print(f"[{job_id}] SVD saved {dest} frames={frames_n}", flush=True)
    return dest


@router.post("/generate/video")
async def generate_video(request: VideoGenRequest):
    if not (request.image_path or "").strip():
        raise HTTPException(
            status_code=400,
            detail="IMAGE_REQUIRED: Insert a product photo into the scene, then generate video.",
        )
    job_id = f"vid_{uuid.uuid4().hex[:12]}"
    model = (request.model_id or "").lower()
    use_h3 = "minimax" in model or "h3" in model or not (request.api_secret or "").strip()
    if "runway" in model:
        use_h3 = False
    if use_h3:
        def runner():
            return h3_local.run_h3(
                image_path=request.image_path or "",
                prompt=request.prompt,
                fmt=request.format,
                duration_sec=request.duration_sec,
                endpoint=request.h3_endpoint or "",
                job_id=job_id,
            )
    else:
        if not (request.api_secret or "").strip():
            raise HTTPException(
                status_code=400,
                detail="H3_REQUIRED: Download MiniMax H3 or set an SGLang URL in Settings. Runway is optional and paid.",
            )
        def runner():
            return runway_cloud.run_runway(
                image_path=request.image_path or "",
                prompt=request.prompt,
                fmt=request.format,
                duration_sec=request.duration_sec,
                api_key=request.api_secret or "",
                job_id=job_id,
            )

    async with generation._generation_lock:
        try:
            path = await asyncio.to_thread(runner)
        except RuntimeError as err:
            generation.clear_runtime_job(error=str(err)[:240])
            msg = str(err)
            if msg.startswith(("H3_", "RUNWAY_", "IMAGE_REQUIRED", "CANCELLED")):
                raise HTTPException(status_code=400, detail=msg) from err
            raise HTTPException(status_code=500, detail=msg) from err
        except Exception as err:
            generation.clear_runtime_job(error=str(err)[:240])
            raise HTTPException(status_code=500, detail=str(err)) from err
    return {"job_id": job_id, "status": "completed", "file_path": path}
