"""ffprobe helpers shared by video routes and analysis."""
from __future__ import annotations

import os
import shutil
import subprocess


def ffprobe_bin() -> str:
    path = shutil.which("ffprobe")
    if path:
        return path
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        sibling = os.path.join(os.path.dirname(ffmpeg), "ffprobe")
        if os.path.isfile(sibling):
            return sibling
    raise RuntimeError("ffprobe is not installed. Install ffmpeg (brew install ffmpeg).")


def video_duration_sec(path: str) -> float:
    if not os.path.exists(path):
        return 5.0
    ext = os.path.splitext(path)[1].lower()
    if ext in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"):
        return 5.0

    probe = ffprobe_bin()
    for entry in ("format=duration", "stream=duration"):
        cmd = [probe, "-v", "error", "-show_entries", entry, "-of", "csv=p=0", path]
        try:
            result = subprocess.run(cmd, check=False, capture_output=True, text=True)
            for line in (result.stdout or "").splitlines():
                line = line.strip()
                if line and line != "N/A":
                    val = float(line)
                    if val > 0:
                        return val
        except (ValueError, TypeError, OSError):
            continue
    return 5.0


def audio_duration_sec(path: str) -> float:
    """Duration of an audio file in seconds (same ffprobe path as video)."""
    return video_duration_sec(path)
