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
    probe = ffprobe_bin()
    result = subprocess.run(
        [probe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())
