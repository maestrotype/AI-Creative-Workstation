"""Per-scene keyframe extraction and visual captions via an Ollama vision model.

The captions become `visual_notes` in the analysis context, so the script LLM
can describe what actually happens on screen instead of inventing filler.
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, List, Optional

OLLAMA_URL = "http://127.0.0.1:11434"

# Model-name fragments that indicate multimodal (vision) support.
VISION_MODEL_HINTS = (
    "qwen2.5vl",
    "qwen2-vl",
    "qwen3-vl",
    "llava",
    "llama3.2-vision",
    "minicpm-v",
    "moondream",
    "gemma3",
    "granite3.2-vision",
    "bakllava",
)

ProgressFn = Optional[Callable[[str, int, str], None]]


def _ffmpeg_bin() -> Optional[str]:
    return shutil.which("ffmpeg")


def detect_vision_model() -> Optional[str]:
    """Return the first installed Ollama model that can read images."""
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None
    for item in data.get("models") or []:
        name = str(item.get("name") or "")
        low = name.lower()
        if any(hint in low for hint in VISION_MODEL_HINTS):
            return name
    return None


def extract_scene_frames(
    video_path: str,
    scenes: List[Dict[str, Any]],
    out_dir: str,
) -> List[Dict[str, Any]]:
    """Grab one mid-scene JPEG per scene (downscaled for the VLM)."""
    ffmpeg = _ffmpeg_bin()
    if not ffmpeg:
        return []
    os.makedirs(out_dir, exist_ok=True)
    frames: List[Dict[str, Any]] = []
    for i, scene in enumerate(scenes):
        start = float(scene.get("start", 0.0))
        end = float(scene.get("end", start))
        mid = max(0.0, start + max(0.0, end - start) / 2)
        index = int(scene.get("index", i))
        dest = os.path.join(out_dir, f"scene-{index:03d}.jpg")
        cmd = [
            ffmpeg, "-y",
            "-ss", f"{mid:.3f}",
            "-i", video_path,
            "-frames:v", "1",
            "-vf", "scale='min(1024,iw)':-2",
            "-q:v", "4",
            dest,
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=60)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            continue
        if os.path.isfile(dest):
            frames.append({"scene_index": index, "time": round(mid, 3), "frame_path": dest})
    return frames


def _caption_one(model: str, image_path: str, language: str) -> Optional[str]:
    try:
        with open(image_path, "rb") as handle:
            image_b64 = base64.b64encode(handle.read()).decode("ascii")
    except OSError:
        return None
    if language.startswith("ru"):
        ask = (
            "Опиши одним-двумя короткими предложениями, что видно на этом кадре из видео: "
            "интерфейс, действия, объекты, заметный текст. Без вступлений и без списков."
        )
    else:
        ask = (
            "Describe in one or two short sentences what is visible in this video frame: "
            "UI, actions, objects, visible text. No preamble, no lists."
        )
    payload = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": ask, "images": [image_b64]}],
            "stream": False,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None
    content = str(((body.get("message") or {}).get("content")) or "").strip()
    return content[:400] or None


def caption_scenes(
    video_path: str,
    scenes: List[Dict[str, Any]],
    out_dir: str,
    *,
    language: str = "ru",
    on_progress: ProgressFn = None,
) -> tuple[List[Dict[str, Any]], List[str]]:
    """Return (visual_notes, warnings) for the given scenes."""
    model = detect_vision_model()
    if not model:
        return [], ["VISION_MODEL_MISSING"]

    if on_progress:
        on_progress("visual", 25, "Extracting keyframes")
    frames = extract_scene_frames(video_path, scenes, out_dir)
    if not frames:
        return [], ["KEYFRAME_EXTRACT_FAILED"]

    notes: List[Dict[str, Any]] = []
    total = len(frames)
    for n, frame in enumerate(frames):
        if on_progress:
            percent = 28 + int((n / max(total, 1)) * 22)
            on_progress("visual", percent, f"Describing frame {n + 1}/{total} ({model})")
        caption = _caption_one(model, frame["frame_path"], language)
        if not caption:
            continue
        notes.append(
            {
                "time": frame["time"],
                "scene_index": frame["scene_index"],
                "caption": caption,
                "source": "vlm",
                "frame_path": frame["frame_path"],
            }
        )
    warnings: List[str] = []
    if not notes:
        warnings.append("VISION_CAPTION_FAILED")
    return notes, warnings
