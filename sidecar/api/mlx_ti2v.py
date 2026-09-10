"""Wan 2.2 TI2V-5B via the isolated MLX Python 3.11 venv.

The FastAPI sidecar is Python 3.14 + PyTorch. mlx-video is proven on 3.11.
Run generation in a subprocess so MLX memory is released when the worker exits.
"""
from __future__ import annotations

import os
import re
import select
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable
from pathlib import Path

TI2V_ID = "Anes1032/Wan2.2-TI2V-5B-mlx-q8"
# Wan TI2V latents are 4n+1 at 24 fps: 41≈1.71s, 81≈3.38s, 121≈5.04s.
# mlx-video has no 41-frame cap (default in generate.py is 81). 121 is the 5s length.
# Practical Mac limit is measured by run_ti2v_scale.py, not assumed here.
WIDTH = 832
HEIGHT = 480
FRAMES = 41
FRAMES_MID = 81
FRAMES_LONG = 81
FRAMES_FULL = 121
STEPS = 20
FPS = 24
GUIDE = 5.0
SHIFT = 5.0
WORKER_TIMEOUT_SEC = 60 * 60
MAX_FRAMES = 121
MIN_FRAMES = 17
LAST_RUN: dict = {}
# On-disk weights ≈ 5G q8 transformer + 11G T5 + 2.6G VAE.
APPROX_WEIGHT_BYTES = 21 * 1024 ** 3

_LOG_PERCENT = (
    ("Loading T5", 16),
    ("Encoding text", 22),
    ("Encoding input image", 28),
    ("Loading transformer", 34),
    ("Denoising", 42),
    ("Decoding", 86),
)


def _here() -> Path:
    return Path(__file__).resolve().parents[1]


def model_dir(model_id: str | None = None) -> Path:
    key = (model_id or TI2V_ID).replace("/", "__")
    return Path.home() / "Documents/Canvas/Models" / key


def weights_ready(model_id: str | None = None) -> bool:
    root = model_dir(model_id)
    return all(
        (root / name).is_file()
        for name in ("model.safetensors", "t5_encoder.safetensors", "vae.safetensors", "config.json")
    )


def mlx_python() -> str:
    candidates = [
        Path.home() / "Documents/Canvas/PocI2V/.venv/bin/python",
        _here() / ".venv-mlx-video/bin/python",
        _here() / ".venv-mlx-video/bin/python3",
    ]
    for py in candidates:
        if not py.is_file():
            continue
        try:
            proc = subprocess.run(
                [str(py), "-c", "import mlx_video, mlx.core as mx; print(mx.default_device())"],
                check=False,
                capture_output=True,
                text=True,
                timeout=30,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if proc.returncode == 0:
            return str(py)
    raise RuntimeError(
        "VIDEO_CAPABILITY_UNSUPPORTED: MLX video Python is not installed. "
        "Need Python 3.11 venv with mlx-video (see ~/Documents/Canvas/PocI2V/.venv)."
    )


def backend_snapshot(
    *,
    job_active: bool,
    job_stage: str,
    job_model_id: str,
    job_error: str | None,
) -> dict:
    """Lifecycle of the local TI2V weights. Not system-wide RAM."""
    installed = weights_ready()
    key = (job_model_id or "").lower()
    ours = "ti2v" in key or "anes1032" in key
    if job_error and ours:
        state = "ERROR"
    elif job_active and ours:
        if job_stage == "load":
            state = "LOADING"
        elif job_stage in ("validate", "releasing"):
            state = "RELEASING"
        else:
            state = "GENERATING"
    elif ours and job_stage == "released":
        state = "RELEASED"
    elif installed:
        state = "AVAILABLE"
    else:
        state = "NOT_INSTALLED"
    return {
        "id": TI2V_ID,
        "state": state,
        "installed": installed,
        "approx_bytes": APPROX_WEIGHT_BYTES if installed else 0,
    }


def snap_frame_count(num_frames: int) -> int:
    """Nearest Wan latent length (4n+1), clamped to [MIN_FRAMES, MAX_FRAMES]."""
    n = int(num_frames)
    n = max(MIN_FRAMES, min(MAX_FRAMES, n))
    snapped = int(round((n - 1) / 4.0)) * 4 + 1
    return max(MIN_FRAMES, min(MAX_FRAMES, snapped))


def frames_for_duration(duration_sec: float | None, requested: int | None = None) -> int:
    """Map wall-clock seconds to Wan frames at 24 fps.

    Create sends duration_sec=5 → 120 frames → snap 121 (≈5.04s).
    Unspecified duration stays on the short 41-frame default.
    Requests above MAX_FRAMES clamp; we do not loop or Ken-Burns to fake length.
    """
    if requested is not None:
        return snap_frame_count(requested)
    sec = float(duration_sec or 0)
    if sec <= 0:
        return FRAMES
    return snap_frame_count(int(round(sec * FPS)))


def _rss_mb(pid: int) -> float:
    try:
        out = subprocess.check_output(["ps", "-o", "rss=", "-p", str(pid)], text=True)
        return int(out.strip().split()[0]) / 1024.0
    except Exception:
        return 0.0


def _percent_from_log(line: str, current: int) -> int:
    text = line.strip()
    for needle, pct in _LOG_PERCENT:
        if needle in text:
            return max(current, pct)
    match = re.search(r"(\d+)\s*%", text)
    if match and ("Diffusion" in text or "it/" in text):
        step_pct = int(match.group(1))
        return max(current, min(84, 42 + int(step_pct * 0.42)))
    return current


def _stop_worker(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=4)


def run_ti2v(
    *,
    image_path: str,
    prompt: str,
    dest: str,
    model_id: str | None = None,
    negative_prompt: str = "",
    seed: int = 42,
    num_frames: int | None = None,
    duration_sec: float | None = None,
    should_cancel: Callable[[], bool] | None = None,
    on_log: Callable[[str, int], None] | None = None,
) -> str:
    if not image_path or not os.path.isfile(image_path):
        raise RuntimeError("IMAGE_REQUIRED: Attach a product photo for local AI video.")
    if not weights_ready(model_id):
        raise RuntimeError(
            "VIDEO_MODEL_MISSING: Download Wan 2.2 TI2V 5B (MLX q8) in Studio → Video."
        )
    frames_n = frames_for_duration(duration_sec, num_frames)
    py = mlx_python()
    worker = str(_here() / "mlx_ti2v_worker.py")
    cmd = [
        py, "-u", worker,
        "--model-dir", str(model_dir(model_id)),
        "--image", image_path,
        "--prompt", prompt,
        "--negative-prompt", negative_prompt or "",
        "--output", dest,
        "--width", str(WIDTH),
        "--height", str(HEIGHT),
        "--num-frames", str(frames_n),
        "--steps", str(STEPS),
        "--guide-scale", str(GUIDE),
        "--shift", str(SHIFT),
        "--seed", str(seed),
    ]
    print(f"[mlx_ti2v] {' '.join(cmd[:4])} … frames={frames_n}", flush=True)
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
    )
    assert proc.stdout is not None
    collected: list[str] = []
    percent = 12
    peak_rss = 0.0
    peak_mlx_gb = None
    t0 = time.time()
    deadline = t0 + WORKER_TIMEOUT_SEC
    LAST_RUN.clear()
    LAST_RUN.update({"num_frames": frames_n, "pid": proc.pid})
    try:
        while True:
            rss = _rss_mb(proc.pid)
            if rss > peak_rss:
                peak_rss = rss
            if time.time() > deadline:
                _stop_worker(proc)
                raise RuntimeError("TI2V_FAILED: MLX worker timed out.")
            if should_cancel and should_cancel():
                _stop_worker(proc)
                raise RuntimeError("CANCELLED")
            if proc.poll() is not None:
                rest = proc.stdout.read() or ""
                if rest:
                    collected.append(rest)
                    sys.stdout.write(rest[-2000:])
                    sys.stdout.flush()
                break
            ready, _, _ = select.select([proc.stdout], [], [], 0.4)
            if not ready:
                continue
            line = proc.stdout.readline()
            if not line:
                continue
            collected.append(line)
            match = re.search(r"PEAK_MLX_GB\s+([0-9.]+)", line)
            if match:
                peak_mlx_gb = float(match.group(1))
            percent = _percent_from_log(line, percent)
            if on_log:
                on_log(line.rstrip()[:120], percent)
            sys.stdout.write(line)
            sys.stdout.flush()
    except Exception:
        _stop_worker(proc)
        LAST_RUN.update({
            "elapsed_sec": round(time.time() - t0, 1),
            "peak_worker_rss_mb": round(peak_rss, 1),
            "peak_mlx_gb": peak_mlx_gb,
            "returncode": proc.returncode,
        })
        raise
    LAST_RUN.update({
        "elapsed_sec": round(time.time() - t0, 1),
        "peak_worker_rss_mb": round(peak_rss, 1),
        "peak_mlx_gb": peak_mlx_gb,
        "returncode": proc.returncode,
    })
    print(
        f"[mlx_ti2v] PEAK_WORKER_RSS_MB {peak_rss:.1f} PEAK_MLX_GB {peak_mlx_gb}",
        flush=True,
    )
    if proc.returncode != 0:
        tail = "".join(collected)[-800:]
        raise RuntimeError(f"TI2V_FAILED: MLX worker exited {proc.returncode}. {tail}")
    if not os.path.isfile(dest) or os.path.getsize(dest) < 1000:
        raise RuntimeError("TI2V_FAILED: Worker did not write a video file.")
    remux_for_browser(dest)
    return dest


def remux_for_browser(src: str) -> None:
    """Put moov at the start so Electron <video> can play the file."""
    from api.video import _ffmpeg_bin

    ffmpeg = _ffmpeg_bin()
    tmp = f"{src}.web.mp4"
    copy = subprocess.run(
        [ffmpeg, "-y", "-i", src, "-c", "copy", "-movflags", "+faststart", tmp],
        check=False,
        capture_output=True,
        text=True,
    )
    if copy.returncode != 0 or not os.path.isfile(tmp) or os.path.getsize(tmp) < 1000:
        copy = subprocess.run(
            [
                ffmpeg, "-y", "-i", src,
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", "-an", tmp,
            ],
            check=False,
            capture_output=True,
            text=True,
        )
    if copy.returncode != 0 or not os.path.isfile(tmp) or os.path.getsize(tmp) < 1000:
        if os.path.isfile(tmp):
            os.remove(tmp)
        print("[mlx_ti2v] remux skipped; Chromium may not preview this MP4", flush=True)
        return
    os.replace(tmp, src)


def extract_frames(video_path: str) -> list:
    from PIL import Image
    from api.video import _ffmpeg_bin, _run_ffmpeg

    ffmpeg = _ffmpeg_bin()
    frames = []
    with tempfile.TemporaryDirectory() as tmp:
        pattern = os.path.join(tmp, "%05d.png")
        _run_ffmpeg(
            [ffmpeg, "-y", "-i", video_path, pattern],
            "ffmpeg ti2v frame extract failed",
        )
        names = sorted(p for p in os.listdir(tmp) if p.endswith(".png"))
        for name in names:
            frames.append(Image.open(os.path.join(tmp, name)).convert("RGB").copy())
    return frames
