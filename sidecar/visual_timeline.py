"""Per-frame screen states for narration planning.

An analysis window can hold several screens (a theme switch, a language switch,
a scroll into another section). Each sampled frame is read on its own, so a
change between two frames of one window is not lost.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from typing import Any, Dict, List, Optional

from scene_understand import _ask_vlm_prompt, detect_vision_model
from ollama_rt import unload_model as _unload_ollama_model

STATE_VERSION = 2

_FRAME_ASK = """One frame of a screen recording. Describe only what is visible, in Russian.
Copy on-screen words exactly in seen_text. Do not evaluate (no удобный, быстрый, красивый, лучший).
Return ONLY JSON:
{
  "state": "one concrete sentence: what this screen shows",
  "evidence": ["short visible facts: headings, buttons, sections, an open menu"],
  "popup": "text of an open dropdown or dialog, or empty",
  "seen_text": ["on-screen words copied exactly as written"]
}"""


def frame_times(start: float, end: float, count: int) -> List[float]:
    """Same sampling as scene_understand.extract_window_frames."""
    span = max(0.4, end - start)
    times = [start + min(0.2, span * 0.08)]
    if span >= 2.5:
        times.append(start + span / 2)
    times.append(max(start, end - min(0.25, span * 0.08)))
    if span >= 12:
        times.append(start + span * 0.75)
    uniq: List[float] = []
    for ts in times:
        if not uniq or abs(ts - uniq[-1]) > 0.35:
            uniq.append(ts)
    return uniq[:count]


def _luma(path: str) -> Optional[float]:
    try:
        from PIL import Image, ImageStat
    except ImportError:
        return None
    try:
        with Image.open(path) as img:
            gray = img.convert("L")
            width, height = gray.size
            box = (0, int(height * 0.1), width, int(height * 0.9))
            return float(ImageStat.Stat(gray.crop(box)).mean[0])
    except OSError:
        return None


def _as_list(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def interface_language(words: List[str]) -> str:
    text = " ".join(words)
    cyr = len(re.findall(r"[А-Яа-яЁёІіЇїЄєҐґ]", text))
    lat = len(re.findall(r"[A-Za-z]", text))
    if cyr + lat < 6:
        return ""
    if cyr > lat:
        return "uk" if re.search(r"[ІіЇїЄєҐґ]", text) else "ru"
    return "en"


def _cache_path(frame_path: str) -> str:
    return f"{frame_path}.state.v{STATE_VERSION}.json"


def _read_cache(frame_path: str) -> Optional[Dict[str, Any]]:
    try:
        with open(_cache_path(frame_path), "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _write_cache(frame_path: str, state: Dict[str, Any]) -> None:
    try:
        with open(_cache_path(frame_path), "w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False)
    except OSError:
        pass


def read_frame(model: str, frame_path: str) -> Dict[str, Any]:
    cached = _read_cache(frame_path)
    if cached is not None:
        return cached
    raw = _ask_vlm_prompt(model, [frame_path], _FRAME_ASK) or {}
    seen = _as_list(raw.get("seen_text"))
    state = {
        "state": str(raw.get("state") or "").strip(),
        "evidence": _as_list(raw.get("evidence")),
        "popup": str(raw.get("popup") or "").strip(),
        "seen_text": seen,
        "language": interface_language(seen),
        "luma": _luma(frame_path),
        "read": bool(raw),
    }
    if raw:
        _write_cache(frame_path, state)
    return state


THUMB_W = 64
THUMB_H = 36
THUMB_FPS = 2
# A sample is taken when the picture has moved since the last sample, on a hard cut,
# or at least every few seconds — a language switch barely changes pixels.
MOVE_DIFF = 28.0
HARD_CUT_DIFF = 90.0
MIN_SAMPLE_GAP = 1.6
MAX_SAMPLE_GAP = 3.0


def _thumbs(video_path: str) -> List[bytes]:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg or not os.path.isfile(video_path):
        return []
    try:
        proc = subprocess.run(
            [
                ffmpeg, "-v", "error", "-i", video_path,
                "-vf", f"fps={THUMB_FPS},scale={THUMB_W}:{THUMB_H},format=gray",
                "-f", "rawvideo", "-",
            ],
            check=True,
            capture_output=True,
            timeout=120,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return []
    size = THUMB_W * THUMB_H
    raw = proc.stdout
    return [raw[i * size:(i + 1) * size] for i in range(len(raw) // size)]


def _diff(a: bytes, b: bytes) -> float:
    if not a or not b:
        return 255.0
    return sum(abs(x - y) for x, y in zip(a, b)) / len(a)


def _thumb_luma(thumb: bytes) -> float:
    if not thumb:
        return 0.0
    rows = thumb[THUMB_W * 4: THUMB_W * (THUMB_H - 4)]
    return sum(rows) / max(1, len(rows))


def _grab(video_path: str, time_sec: float, dest: str) -> bool:
    if os.path.isfile(dest):
        return True
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return False
    try:
        subprocess.run(
            [
                ffmpeg, "-y", "-v", "error", "-ss", f"{time_sec:.2f}", "-i", video_path,
                "-frames:v", "1", "-vf", "scale='min(1024,iw)':-2", "-q:v", "4", dest,
            ],
            check=True,
            capture_output=True,
            timeout=60,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return False
    return os.path.isfile(dest)


def _frames_dir(video_context: Dict[str, Any], video_path: str) -> str:
    for row in video_context.get("scene_analysis") or []:
        paths = [path for path in (row.get("frame_paths") or []) if path]
        if paths:
            return os.path.join(os.path.dirname(paths[0]), "dense")
    base = os.path.splitext(os.path.basename(video_path))[0]
    return os.path.join(os.path.dirname(video_path), ".narration-frames", base)


def _sample_plan(thumbs: List[bytes]) -> List[Dict[str, float]]:
    """Times to read, with the moment the picture changed.

    Fast motion is sampled as it crosses a difference from the last sample.
    A quiet stretch is still sampled every few seconds, because a new language
    or a small menu barely moves the pixels.
    """
    fps = THUMB_FPS
    plan = [{"time": 0.4, "change_at": 0.0}]
    anchor = 0
    last = 0.4
    for index in range(1, len(thumbs)):
        time_sec = index / fps
        gap = time_sec - last
        step = _diff(thumbs[index - 1], thumbs[index])
        moved = _diff(thumbs[anchor], thumbs[index]) >= MOVE_DIFF and gap >= MIN_SAMPLE_GAP
        if step >= HARD_CUT_DIFF or moved or gap >= MAX_SAMPLE_GAP:
            plan.append({"time": round(time_sec, 2), "change_at": round(time_sec, 2)})
            anchor = index
            last = time_sec
    return plan


def _view_words(state: Dict[str, Any]) -> set:
    text = " ".join([state.get("state") or "", state.get("popup") or "", " ".join(state.get("evidence") or [])])
    return {word for word in re.findall(r"[a-zа-яё]{4,}", text.lower())}


def _same_view(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    if a.get("language") and b.get("language") and a["language"] != b["language"]:
        return False
    left, right = _view_words(a), _view_words(b)
    if not left or not right:
        return False
    return len(left & right) / max(len(left), len(right)) >= 0.5


def _read_at(model: str, video_path: str, out_dir: str, time_sec: float) -> Optional[Dict[str, Any]]:
    dest = os.path.join(out_dir, f"cut-{time_sec:07.2f}.jpg")
    if not _grab(video_path, time_sec, dest):
        return None
    state = read_frame(model, dest)
    if not state.get("read"):
        return None
    return dict(state)


def build_dense_timeline(video_context: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Screen states at picture changes, plus a read every few quiet seconds.

    When a quiet read differs from the previous one, the midpoint is read once
    so the change point moves closer to the moment the screen actually changed.
    """
    video_path = str(video_context.get("source_path") or "")
    duration = float(video_context.get("duration_sec") or 0)
    thumbs = _thumbs(video_path)
    if not thumbs or duration <= 0:
        return []
    out_dir = _frames_dir(video_context, video_path)
    os.makedirs(out_dir, exist_ok=True)
    plan = [item for item in _sample_plan(thumbs) if item["time"] < duration]
    model = detect_vision_model() or ""
    if not model:
        return []
    states: List[Dict[str, Any]] = []
    for item in plan:
        state = _read_at(model, video_path, out_dir, item["time"])
        if state is None:
            continue
        state["time"] = item["time"]
        state["change_at"] = item["change_at"]
        states.append(state)
    extra: List[Dict[str, Any]] = []
    for index in range(1, len(states)):
        prev, cur = states[index - 1], states[index]
        gap = float(cur["time"]) - float(prev["time"])
        quiet = gap >= MAX_SAMPLE_GAP - 0.05
        if quiet and gap >= 2.0 and not _same_view(prev, cur):
            mid = round((float(prev["time"]) + float(cur["time"])) / 2, 2)
            found = _read_at(model, video_path, out_dir, mid)
            if found is None:
                continue
            if _same_view(found, cur):
                cur["change_at"] = mid
            else:
                found["time"] = mid
                found["change_at"] = mid
                extra.append(found)
    _unload_ollama_model(model)
    return sorted(states + extra, key=lambda item: float(item["time"]))


def build_frame_timeline(video_context: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Every sampled frame in time order with its screen state. Empty if no vision model."""
    rows = [row for row in (video_context.get("scene_analysis") or []) if isinstance(row, dict)]
    frames: List[Dict[str, Any]] = []
    jobs: List[tuple[float, str, Dict[str, Any]]] = []
    for row in rows:
        paths = [path for path in (row.get("frame_paths") or []) if path and os.path.isfile(path)]
        if not paths:
            continue
        start = float(row.get("start", 0))
        end = float(row.get("end", start))
        for time_sec, path in zip(frame_times(start, end, len(paths)), paths):
            jobs.append((time_sec, path, row))
    if not jobs:
        return []
    model = None
    if any(_read_cache(path) is None for _, path, _ in jobs):
        model = detect_vision_model()
        if not model:
            return []
    for time_sec, path, row in jobs:
        state = read_frame(model or "", path) if model else (_read_cache(path) or {})
        if not state.get("read"):
            continue
        frames.append({
            **state,
            "time": round(time_sec, 2),
            "path": path,
            "window_summary": str(row.get("visual_summary") or ""),
            "window_features": list(row.get("product_features") or []),
        })
    if model:
        _unload_ollama_model(model)
    frames.sort(key=lambda item: item["time"])
    return frames
