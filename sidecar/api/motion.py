"""Product video. Ad clips go through Runway Gen-4.5; local Wan/SVD are not the ad path."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import asyncio
import base64
import json
import os
import tempfile
import time
import uuid

from api import generation
from api import h3_local
from api import mlx_ti2v
from api import runway_cloud
from api.video import _ffmpeg_bin, _run_ffmpeg
from video_capability import IMAGE_TO_VIDEO, assert_mode_allowed, resolve_mode

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
    image_base64: Optional[str] = None
    api_secret: Optional[str] = None
    h3_endpoint: Optional[str] = None
    # ai_video | image_animation | t2v — never infer cinematic intent from SVD being installed.
    mode: Optional[str] = None
    num_frames: Optional[int] = None
    shot_index: Optional[int] = None
    shot_total: Optional[int] = None
    seed: Optional[int] = None


def _is_ti2v(model_id: str) -> bool:
    key = (model_id or "").lower()
    return "ti2v" in key or "anes1032" in key


def _is_wan(model_id: str) -> bool:
    key = (model_id or "").lower()
    return "wan" in key and not _is_ti2v(model_id)


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


# Mean absolute pixel difference below this is a freeze-frame, not generated motion.
_LOW_MOTION_MAE = 4.0
# First generated frame vs source still. Heuristic only — not a product-identity solver.
_IDENTITY_MAE = 32.0


def _motion_report(frames, *, fps: int) -> dict:
    """Lightweight frame-change score. Does not equal cinematic quality."""
    images = _frame_list(frames)
    count = len(images)
    if count == 0:
        return {
            "frame_count": 0,
            "fps": fps,
            "duration_sec": 0.0,
            "width": 0,
            "height": 0,
            "motion_mae": 0.0,
            "motion_score": 0.0,
            "low_motion": True,
        }
    import numpy as np

    first = np.asarray(images[0], dtype=np.float32)
    mid = np.asarray(images[count // 2], dtype=np.float32)
    last = np.asarray(images[-1], dtype=np.float32)
    mae = float(max(np.mean(np.abs(first - mid)), np.mean(np.abs(first - last))))
    score = min(1.0, mae / 32.0)
    h, w = int(first.shape[0]), int(first.shape[1])
    print(f"[motion] frames={count} fps={fps} mae={mae:.2f} score={score:.3f}", flush=True)
    return {
        "frame_count": count,
        "fps": fps,
        "duration_sec": round(count / max(1, fps), 3),
        "width": w,
        "height": h,
        "motion_mae": round(mae, 3),
        "motion_score": round(score, 3),
        "low_motion": mae < _LOW_MOTION_MAE or count < 3,
        "identity_mae": None,
        "identity_warning": False,
    }


def _identity_vs_source(source, frames) -> dict:
    """Warn when first/mid/last frames drift far from the source product photo.

    First-frame-only checks miss late collapse and hallucinated objects.
    """
    images = _frame_list(frames)
    if source is None or not images:
        return {"identity_mae": None, "identity_mae_last": None, "identity_warning": False}
    import numpy as np

    first = images[0].convert("RGB")
    src = np.asarray(source.convert("RGB").resize(first.size), dtype=np.float32)

    def mae(img) -> float:
        return float(np.mean(np.abs(
            src - np.asarray(img.convert("RGB"), dtype=np.float32)
        )))

    first_mae = mae(images[0])
    mid_mae = mae(images[len(images) // 2])
    last_mae = mae(images[-1])
    mae_max = max(first_mae, mid_mae, last_mae)
    warning = mae_max >= _IDENTITY_MAE
    print(
        f"[motion] identity first={first_mae:.2f} mid={mid_mae:.2f} last={last_mae:.2f} warning={warning}",
        flush=True,
    )
    return {
        "identity_mae": round(mae_max, 3),
        "identity_mae_first": round(first_mae, 3),
        "identity_mae_last": round(last_mae, 3),
        "identity_warning": warning,
    }


def _frames_are_static(frames) -> bool:
    return bool(_motion_report(frames, fps=7)["low_motion"])


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


def _run_ti2v(request: VideoGenRequest, job_id: str):
    """Local prompt-conditioned I2V. Subprocess so MLX memory dies with the worker."""
    shot_n = request.shot_index
    shot_total = request.shot_total
    if shot_n and shot_total:
        detail = f"Shot {shot_n} of {shot_total}"
    else:
        detail = "Wan 2.2 TI2V"
    frames_n = mlx_ti2v.frames_for_duration(request.duration_sec, request.num_frames)
    generation.set_runtime_job(
        active=True,
        kind="video",
        stage="load",
        percent=4,
        detail=detail,
        model_id=request.model_id,
        started_at=time.time(),
        error=None,
        cancel=False,
        shot_index=shot_n,
        shot_total=shot_total,
    )
    dropped = generation._unload_all_models()
    if dropped:
        print(f"[motion] freed {dropped} pipeline(s) before TI2V", flush=True)
    dest_dir = os.path.expanduser("~/Documents/Canvas/Generated/Video")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, f"{job_id}.mp4")
    generation.set_runtime_job(stage="infer", percent=12, detail=detail)

    def on_log(_line: str, percent: int) -> None:
        generation.set_runtime_job(stage="infer", percent=percent, detail=detail)

    seed = request.seed if request.seed is not None else int(time.time()) % 10_000
    from api.ti2v_prompt import prepare_wan_prompt

    prepared = prepare_wan_prompt(request.prompt, translate=True)
    print(
        f"[motion] TI2V intent={prepared['intent']} source={prepared['source']} "
        f"wan={prepared['wan'][:160]!r}",
        flush=True,
    )
    mlx_ti2v.run_ti2v(
        image_path=request.image_path or "",
        prompt=prepared["wan"],
        dest=dest,
        model_id=request.model_id,
        seed=seed,
        num_frames=frames_n,
        duration_sec=request.duration_sec,
        should_cancel=generation.runtime_should_cancel,
        on_log=on_log,
    )
    generation.set_runtime_job(stage="validate", percent=90, detail="releasing")
    frames = mlx_ti2v.extract_frames(dest)
    quality = _motion_report(frames, fps=mlx_ti2v.FPS)
    still_path = request.image_path or ""
    if still_path and os.path.isfile(still_path):
        from PIL import Image

        quality.update(_identity_vs_source(Image.open(still_path), frames))
    quality["num_frames_requested"] = frames_n
    quality["seed"] = seed
    quality["prompt_wan"] = prepared["wan"]
    quality["prompt_intent"] = prepared["intent"]
    quality["prompt_english"] = prepared["english"]
    del frames
    import gc

    gc.collect()
    generation.set_runtime_job(active=False, stage="released", percent=100, detail="released")
    print(f"[{job_id}] TI2V saved {dest} mae={quality.get('motion_mae')}", flush=True)
    return dest, quality


def _run_wan(request: VideoGenRequest, job_id: str):
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
    quality = _motion_report(frames, fps=16)
    generation._unload_model(cache_key)
    generation.set_runtime_job(active=False, stage="idle", percent=100, detail="done")
    print(f"[{job_id}] motion saved {dest} frames={frames_n}", flush=True)
    return dest, quality


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


def _infer_svd(pipe, image, torch, *, frames_n: int, steps: int, motion: int, noise: float, seed: int):
    kwargs = {
        "image": image,
        "num_frames": frames_n,
        "num_inference_steps": steps,
        "fps": 7,
        "motion_bucket_id": motion,
        "noise_aug_strength": noise,
        "decode_chunk_size": 4 if _on_apple_silicon() else 8,
        "generator": torch.Generator(device="cpu").manual_seed(seed),
    }
    kwargs = generation.attach_step_callback(kwargs, steps)
    try:
        out = pipe(**kwargs)
    except TypeError:
        kwargs.pop("callback_on_step_end", None)
        try:
            out = pipe(**kwargs)
        except TypeError:
            kwargs.pop("fps", None)
            out = pipe(**kwargs)
    return out.frames[0]


def _run_svd(request: VideoGenRequest, job_id: str):
    """Short image animation. Ignores the text prompt. Never Ken Burns."""
    generation.set_runtime_job(
        active=True,
        kind="video",
        stage="load",
        percent=4,
        detail="SVD animation",
        model_id=request.model_id,
        started_at=time.time(),
        error=None,
        cancel=False,
    )
    still_path = request.image_path or ""
    image = _fit_product_image(still_path, request.format)
    generation.set_runtime_job(stage="infer", percent=12, detail="img2vid")
    cache_key = generation._to_cache_key(request.model_id)
    pipe = _get_svd_pipe(request.model_id)
    torch = generation.torch
    apple = _on_apple_silicon()
    # SVD-XT is 25 frames; Mac compact is 14 @ 7 fps (~2s). Do not pad duration.
    frames_n = 14 if apple else 25
    steps = 22 if apple else 25
    dest_dir = os.path.expanduser("~/Documents/Canvas/Generated/Video")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, f"{job_id}.mp4")
    fps = 7

    attempts = (
        {"motion": 80, "noise": 0.08, "seed": int(time.time()) % 10_000},
        {"motion": 127, "noise": 0.18, "seed": 99},
    )
    frames = None
    quality = {"low_motion": True, "frame_count": 0, "fps": fps, "duration_sec": 0.0}
    last_err: Exception | None = None
    for i, attempt in enumerate(attempts):
        try:
            generation.set_runtime_job(
                stage="infer",
                percent=12 + i * 30,
                detail=f"img2vid {i + 1}/{len(attempts)}",
            )
            frames = _infer_svd(
                pipe, image, torch,
                frames_n=frames_n, steps=steps,
                motion=attempt["motion"], noise=attempt["noise"], seed=attempt["seed"],
            )
            quality = _motion_report(frames, fps=fps)
            quality.update(_identity_vs_source(image, frames))
            if not quality["low_motion"]:
                break
            print(f"[{job_id}] SVD low motion attempt {i + 1}", flush=True)
        except Exception as err:
            last_err = err
            if not generation._is_mps_placeholder(err):
                generation._unload_model(cache_key)
                raise
            print(f"[{job_id}] SVD OOM attempt {i + 1}: {err}", flush=True)
            generation._unload_model(cache_key)
            pipe = _get_svd_pipe(request.model_id, force=True)
            frames_n = 14
            steps = 18

    if frames is None:
        generation._unload_model(cache_key)
        raise last_err or RuntimeError("SVD produced no frames")

    generation.set_runtime_job(stage="encode", percent=92, detail="ffmpeg")
    _encode_frames(frames, fps, dest)
    generation._unload_model(cache_key)
    status = "low_motion" if quality["low_motion"] else "completed"
    generation.set_runtime_job(active=False, stage="idle", percent=100, detail=status)
    print(f"[{job_id}] SVD {status} {dest} frames={quality.get('frame_count')}", flush=True)
    if status == "low_motion":
        raise RuntimeError(
            "LOW_MOTION: SVD animated the still but frames are nearly identical "
            f"(mae={quality.get('motion_mae')}, {quality.get('duration_sec')}s @ {fps} fps). "
            "This is not AI video generation. Try Runway / H3 for a prompt-driven clip, "
            "or a different still."
        )
    return dest, quality


def _still_from_request(request: VideoGenRequest) -> str:
    path = (request.image_path or "").strip()
    if path and os.path.isfile(path):
        return path
    raw = (request.image_base64 or "").strip()
    if not raw:
        return ""
    if "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        data = base64.b64decode(raw)
    except Exception as err:  # noqa: BLE001
        raise RuntimeError("IMAGE_REQUIRED: Could not read the attached still.") from err
    dest_dir = os.path.expanduser("~/Documents/Canvas/Generated")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, f"still_{uuid.uuid4().hex[:10]}.png")
    with open(dest, "wb") as handle:
        handle.write(data)
    return dest


def _write_clip_sidecar(path: str, *, request: VideoGenRequest, spec: dict, quality: dict, status: str) -> None:
    if not path:
        return
    side = os.path.splitext(path)[0] + ".json"
    payload = {
        "prompt": request.prompt,
        "capability": spec.get("capability"),
        "prompt_consumed": bool(spec.get("prompt_consumed")),
        "status": status,
        "quality": quality,
        "provider_id": spec.get("id"),
    }
    try:
        with open(side, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
    except OSError as err:
        print(f"[motion] sidecar json skipped: {err}", flush=True)


def _clip_payload(*, job_id: str, path: str, spec: dict, quality: dict, status: str = "completed") -> dict:
    return {
        "job_id": job_id,
        "file_path": path,
        "status": status,
        "capability": spec["capability"],
        "provider_id": spec["id"],
        "prompt_consumed": bool(spec.get("prompt_consumed")),
        "quality": quality,
    }


@router.post("/generate/video")
async def generate_video(request: VideoGenRequest):
    job_id = f"vid_{uuid.uuid4().hex[:12]}"
    mode = resolve_mode(request.mode, prompt=request.prompt, model_id=request.model_id)
    try:
        spec = assert_mode_allowed(mode, request.model_id)
    except RuntimeError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    still = _still_from_request(request)
    if still:
        request.image_path = still
    if spec["supports_image_conditioning"] and not still:
        raise HTTPException(
            status_code=400,
            detail="IMAGE_REQUIRED: Attach a photo for this video provider.",
        )

    if _is_ti2v(request.model_id):
        def runner():
            return _run_ti2v(request, job_id)
    elif _is_wan(request.model_id):
        def runner():
            path, quality = _run_wan(request, job_id)
            return path, quality
    elif _is_svd(request.model_id):
        def runner():
            return _run_svd(request, job_id)
    else:
        use_h3 = "minimax" in (request.model_id or "").lower() or "h3" in (request.model_id or "").lower()
        if "runway" in (request.model_id or "").lower():
            use_h3 = False
        if use_h3:
            def runner():
                path = h3_local.run_h3(
                    image_path=request.image_path or "",
                    prompt=request.prompt,
                    fmt=request.format,
                    duration_sec=request.duration_sec,
                    endpoint=request.h3_endpoint or "",
                    job_id=job_id,
                )
                return path, {
                    "frame_count": 0,
                    "fps": 24,
                    "duration_sec": float(request.duration_sec or 5),
                    "motion_score": None,
                    "low_motion": False,
                    "prompt_consumed": True,
                }
        else:
            if not (request.api_secret or "").strip():
                raise HTTPException(
                    status_code=400,
                    detail="VIDEO_CAPABILITY_UNSUPPORTED: Runway API key is missing. Set it in Settings.",
                )
            def runner():
                path = runway_cloud.run_runway(
                    image_path=request.image_path or "",
                    prompt=request.prompt,
                    fmt=request.format,
                    duration_sec=request.duration_sec,
                    api_key=request.api_secret or "",
                    job_id=job_id,
                )
                return path, {
                    "frame_count": 0,
                    "fps": 24,
                    "duration_sec": float(max(5, min(10, request.duration_sec or 5))),
                    "motion_score": None,
                    "low_motion": False,
                    "prompt_consumed": True,
                }

    async with generation._generation_lock:
        generation.cancel_idle_release()
        try:
            path, quality = await asyncio.to_thread(runner)
        except RuntimeError as err:
            generation.clear_runtime_job(error=str(err)[:240])
            generation.schedule_idle_release()
            msg = str(err)
            if msg.startswith((
                "H3_", "RUNWAY_", "IMAGE_REQUIRED", "CANCELLED",
                "VIDEO_MODEL_MISSING", "VIDEO_CAPABILITY", "LOW_MOTION",
                "TI2V_FAILED",
            )):
                raise HTTPException(status_code=400, detail=msg) from err
            raise HTTPException(status_code=500, detail=msg) from err
        except Exception as err:
            generation.clear_runtime_job(error=str(err)[:240])
            generation.schedule_idle_release()
            raise HTTPException(status_code=500, detail=str(err)) from err
        generation.schedule_idle_release()
    if quality.get("low_motion") and spec.get("capability") != IMAGE_TO_VIDEO:
        raise HTTPException(
            status_code=400,
            detail=(
                "LOW_MOTION: Frames are nearly identical "
                f"(mae={quality.get('motion_mae')}, "
                f"{quality.get('duration_sec')}s @ {quality.get('fps')} fps). "
                "An MP4 file is not a successful video generation."
            ),
        )
    status = "low_motion" if quality.get("low_motion") else "completed"
    _write_clip_sidecar(path, request=request, spec=spec, quality=quality, status=status)
    return _clip_payload(job_id=job_id, path=path, spec=spec, quality=quality, status=status)
