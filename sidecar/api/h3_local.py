"""MiniMax H3-Base FL2VA: free open-weight first-frame → video+audio.

This is the local analog of Runway I2V. In-process inference needs NVIDIA
(diffusers). A Mac can still use it for free by pointing H3_ENDPOINT at a
SGLang server you run on your own GPUs.
"""
from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request
from io import BytesIO
from typing import Any

from api import generation
from api.runway_cloud import campaign_prompt

H3_MODEL_ID = "MiniMaxAI/MiniMax-H3"


def _duration_sec(sec: float) -> float:
    return float(max(5, min(10, int(round(float(sec) or 5)))))


def _num_frames(sec: float) -> int:
    target = int(round(_duration_sec(sec) * 24))
    n = max(0, round((target - 5) / 17))
    frames = 17 * n + 5
    if frames / 24.0 < 5:
        frames = 17 * 7 + 5
    return frames


def _canvas(fmt: str) -> tuple[int, int]:
    if fmt in ("portrait", "shorts"):
        return 768, 1344
    return 1344, 768


def _image_data_uri(path: str) -> str:
    from PIL import Image

    if not path or not os.path.isfile(path):
        raise RuntimeError("IMAGE_REQUIRED: Import a product photo into the scene first.")
    image = Image.open(path).convert("RGB")
    w, h = image.size
    longest = max(w, h)
    if longest > 1280:
        scale = 1280 / longest
        image = image.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    buf = BytesIO()
    image.save(buf, format="JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _open_image(path: str):
    from PIL import Image

    if not path or not os.path.isfile(path):
        raise RuntimeError("IMAGE_REQUIRED: Import a product photo into the scene first.")
    return Image.open(path).convert("RGB")


def _local_dir() -> str:
    return os.path.expanduser(f"~/Documents/Canvas/Models/{H3_MODEL_ID.replace('/', '__')}")


def _request_json(method: str, url: str, body: dict | None = None, timeout: int = 180) -> Any:
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=payload,
        method=method,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", "replace")[:600]
        raise RuntimeError(f"H3_HTTP_{err.code}: {raw}") from err
    except urllib.error.URLError as err:
        raise RuntimeError(
            "H3_UNREACHABLE: MiniMax H3 server did not answer. "
            "Start SGLang on your NVIDIA box or check the URL in Settings."
        ) from err


def _download_url(url: str, dest: str) -> None:
    req = urllib.request.Request(url, method="GET", headers={"Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=300) as resp, open(dest, "wb") as out:
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            out.write(chunk)


def _run_sglang(*, image_path: str, prompt: str, fmt: str, duration_sec: float, endpoint: str, job_id: str) -> str:
    base = endpoint.rstrip("/")
    aspect = "9:16" if fmt in ("portrait", "shorts") else "16:9"
    seconds = _duration_sec(duration_sec)
    generation.set_runtime_job(
        active=True,
        kind="video",
        stage="queue",
        percent=6,
        detail="MiniMax H3",
        model_id=H3_MODEL_ID,
        started_at=time.time(),
        error=None,
        cancel=False,
    )
    created = _request_json(
        "POST",
        f"{base}/v1/videos",
        {
            "model": H3_MODEL_ID,
            "prompt": campaign_prompt(prompt),
            "seconds": seconds,
            "task": "fl2va",
            "conditions": [{
                "type": "image",
                "uri": _image_data_uri(image_path),
                "role": "keyframe",
                "frame_index": 0,
            }],
            "target": {
                "short_edge": 768,
                "aspect_ratio": aspect,
                "duration_seconds": seconds,
            },
            "num_outputs_per_prompt": 1,
            "num_inference_steps": 50,
            "flow_shift": 12.0,
            "audio_flow_shift": 3.0,
            "seed": 42,
        },
    )
    video_id = created.get("id")
    if not video_id:
        raise RuntimeError("H3_FAILED: SGLang did not return a job id.")

    while True:
        if generation.runtime_should_cancel():
            raise RuntimeError("CANCELLED")
        task = _request_json("GET", f"{base}/v1/videos/{video_id}")
        status = str(task.get("status") or "").lower()
        generation.set_runtime_job(stage="infer", percent=20, detail=f"H3 {status}")
        if status in ("completed", "succeeded", "success"):
            dest_dir = os.path.expanduser("~/Documents/Canvas/Generated/Video")
            os.makedirs(dest_dir, exist_ok=True)
            dest = os.path.join(dest_dir, f"{job_id}.mp4")
            generation.set_runtime_job(stage="download", percent=94, detail="H3")
            _download_url(f"{base}/v1/videos/{video_id}/content", dest)
            if not os.path.isfile(dest) or os.path.getsize(dest) < 1000:
                raise RuntimeError("H3_FAILED: Downloaded file is empty.")
            generation.set_runtime_job(active=False, stage="idle", percent=100, detail="done")
            print(f"[{job_id}] H3 SGLang saved {dest}", flush=True)
            return dest
        if status in ("failed", "error", "cancelled", "canceled"):
            raise RuntimeError(str(task.get("error") or task.get("failure") or "H3_FAILED")[:240])
        time.sleep(2)


def _export_av(videos, audio, sample_rate: int, dest: str) -> None:
    from api.motion import _encode_frames

    fps = 24
    _encode_frames(videos, fps, dest)
    if audio is None:
        return
    try:
        import numpy as np
        from api.video import _ffmpeg_bin, _run_ffmpeg

        wav_path = dest + ".wav"
        arr = np.asarray(audio)
        if arr.ndim == 1:
            arr = np.stack([arr, arr], axis=-1)
        import wave

        pcm = np.clip(arr, -1.0, 1.0)
        pcm = (pcm * 32767).astype(np.int16)
        channels = 1 if pcm.ndim == 1 else pcm.shape[-1]
        with wave.open(wav_path, "wb") as wav:
            wav.setnchannels(channels)
            wav.setsampwidth(2)
            wav.setframerate(int(sample_rate or 32000))
            wav.writeframes(pcm.tobytes())
        muxed = dest + ".mux.mp4"
        _run_ffmpeg(
            [
                _ffmpeg_bin(), "-y",
                "-i", dest, "-i", wav_path,
                "-c:v", "copy", "-c:a", "aac",
                "-shortest", muxed,
            ],
            "ffmpeg H3 mux failed",
        )
        os.replace(muxed, dest)
        try:
            os.remove(wav_path)
        except OSError:
            pass
    except Exception as err:  # noqa: BLE001
        print(f"[h3] audio mux skipped: {err}", flush=True)


def _run_diffusers(*, image_path: str, prompt: str, fmt: str, duration_sec: float, job_id: str) -> str:
    generation._ensure_ml()
    torch = generation.torch
    if not torch.cuda.is_available():
        raise RuntimeError(
            "H3_NEEDS_CUDA: MiniMax H3-Base does not run on a Mac GPU. "
            "Use NVIDIA (offload on one 80GB card, or several GPUs) or put an SGLang URL in Settings."
        )
    local_dir = _local_dir()
    if not os.path.isdir(local_dir):
        raise RuntimeError("H3_MODEL_MISSING: Download MiniMax H3 in Studio → Video.")

    dropped = generation._unload_all_models()
    if dropped:
        print(f"[h3] freed {dropped} pipeline(s) before H3 load", flush=True)

    generation.set_runtime_job(
        active=True,
        kind="video",
        stage="load",
        percent=4,
        detail="MiniMax H3",
        model_id=H3_MODEL_ID,
        started_at=time.time(),
        error=None,
        cancel=False,
    )
    try:
        from diffusers import ComponentsManager, ModularPipeline
    except ImportError as exc:
        raise RuntimeError(
            "H3_DIFFUSERS: Update sidecar diffusers (pip install -U diffusers). "
            "H3 needs ModularPipeline."
        ) from exc

    cache_key = generation._to_cache_key(H3_MODEL_ID)
    pipe = generation.pipeline_cache.get(cache_key)
    if pipe is None:
        manager = ComponentsManager()
        pipe = ModularPipeline.from_pretrained(
            local_dir, workflow="fl2va", components_manager=manager, local_files_only=True
        )
        pipe.load_components(workflow="fl2va", dtype=torch.bfloat16)
        try:
            manager.enable_auto_cpu_offload(device="cuda", memory_reserve_margin="8GB")
        except Exception as err:  # noqa: BLE001
            print(f"[h3] auto offload skipped: {err}", flush=True)
            try:
                pipe.to("cuda")
            except Exception:
                pass
        generation.pipeline_cache[cache_key] = pipe

    width, height = _canvas(fmt)
    frames_n = _num_frames(duration_sec)
    generation.set_runtime_job(stage="infer", percent=12, detail="H3 fl2va")
    image = _open_image(image_path)
    result = pipe(
        prompt=campaign_prompt(prompt),
        image=image,
        height=height,
        width=width,
        num_frames=frames_n,
        generator=torch.Generator(device="cpu").manual_seed(42),
        output=["videos", "audio", "sampling_rate"],
    )
    videos = result["videos"][0]
    audio = (result.get("audio") or [None])[0]
    rate = int(result.get("sampling_rate") or 32000)
    dest_dir = os.path.expanduser("~/Documents/Canvas/Generated/Video")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, f"{job_id}.mp4")
    generation.set_runtime_job(stage="encode", percent=92, detail="H3")
    _export_av(videos, audio, rate, dest)
    generation.set_runtime_job(active=False, stage="idle", percent=100, detail="done")
    print(f"[{job_id}] H3 diffusers saved {dest}", flush=True)
    return dest


def run_h3(
    *,
    image_path: str,
    prompt: str,
    fmt: str,
    duration_sec: float,
    endpoint: str,
    job_id: str,
) -> str:
    url = (endpoint or "").strip()
    if url:
        return _run_sglang(
            image_path=image_path,
            prompt=prompt,
            fmt=fmt,
            duration_sec=duration_sec,
            endpoint=url,
            job_id=job_id,
        )
    return _run_diffusers(
        image_path=image_path,
        prompt=prompt,
        fmt=fmt,
        duration_sec=duration_sec,
        job_id=job_id,
    )
