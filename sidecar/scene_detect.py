"""Scene boundary detection via ffmpeg showinfo."""
from __future__ import annotations

import re
import shutil
import subprocess
from typing import Any, Dict, List

_PTS_TIME_RE = re.compile(r"pts_time:([0-9.]+)")


def _ffmpeg_bin() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise RuntimeError("ffmpeg is not installed")
    return path


def detect_scene_cuts(video_path: str, threshold: float = 0.3) -> List[float]:
    """Return cut timestamps in seconds (excluding 0 and end)."""
    cmd = [
        _ffmpeg_bin(),
        "-hide_banner",
        "-i",
        video_path,
        "-filter:v",
        f"select='gt(scene,{threshold})',showinfo",
        "-an",
        "-f",
        "null",
        "-",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    except OSError as exc:
        raise RuntimeError(f"ffmpeg scene detect failed: {exc}") from exc

    cuts: List[float] = []
    for line in (proc.stderr or "").splitlines():
        match = _PTS_TIME_RE.search(line)
        if match:
            cuts.append(float(match.group(1)))

    deduped: List[float] = []
    for ts in sorted(cuts):
        if not deduped or ts - deduped[-1] > 0.05:
            deduped.append(ts)
    return deduped


def cuts_to_scenes(
    cuts: List[float],
    duration_sec: float,
    min_scene_sec: float = 2.0,
) -> List[Dict[str, Any]]:
    """Merge nearby cuts and build {index, start, end} scene list."""
    if duration_sec <= 0:
        return []

    merged: List[float] = [0.0]
    for ts in sorted(cuts):
        if ts <= 0 or ts >= duration_sec:
            continue
        if ts - merged[-1] >= min_scene_sec:
            merged.append(ts)
    if merged[-1] < duration_sec - 0.01:
        merged.append(duration_sec)

    scenes: List[Dict[str, Any]] = []
    for index, start in enumerate(merged[:-1]):
        end = merged[index + 1]
        if end - start < 0.25:
            continue
        scenes.append({
            "index": len(scenes),
            "start": round(start, 3),
            "end": round(end, 3),
        })

    if not scenes:
        scenes.append({"index": 0, "start": 0.0, "end": round(duration_sec, 3)})
    return scenes


def detect_scenes(
    video_path: str,
    duration_sec: float,
    threshold: float = 0.3,
    min_scene_sec: float = 2.0,
) -> List[Dict[str, Any]]:
    cuts = detect_scene_cuts(video_path, threshold=threshold)
    return cuts_to_scenes(cuts, duration_sec, min_scene_sec=min_scene_sec)
