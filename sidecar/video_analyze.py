"""Orchestrate video analysis: duration, scenes, transcript."""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from typing import Any, Callable, Dict, List, Optional

from media_probe import video_duration_sec
from scene_detect import detect_scenes
from transcribe import transcribe_video, whisper_available

ANALYSIS_DIR = os.path.expanduser("~/Documents/Canvas/Generated/Video/analysis")

_analyze_lock = threading.Lock()
_analyze_job: Dict[str, Any] = {
    "active": False,
    "stage": "idle",
    "percent": 0,
    "detail": "",
    "started_at": 0.0,
    "error": None,
}


def _set_job(**patch: Any) -> None:
    _analyze_job.update(patch)


def get_analyze_progress() -> Dict[str, Any]:
    elapsed = 0.0
    if _analyze_job.get("started_at"):
        elapsed = max(0.0, time.time() - float(_analyze_job["started_at"]))
    return {
        "active": bool(_analyze_job.get("active")),
        "stage": _analyze_job.get("stage") or "idle",
        "percent": int(_analyze_job.get("percent") or 0),
        "detail": _analyze_job.get("detail") or "",
        "elapsed_sec": round(elapsed, 1),
        "error": _analyze_job.get("error"),
        "whisper_available": whisper_available(),
    }


def _cache_path(video_path: str) -> str:
    os.makedirs(ANALYSIS_DIR, exist_ok=True)
    stat = os.stat(video_path)
    digest = hashlib.sha1(f"{video_path}:{stat.st_mtime_ns}:{stat.st_size}".encode()).hexdigest()[:16]
    base = os.path.splitext(os.path.basename(video_path))[0]
    safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in base)[:40] or "video"
    return os.path.join(ANALYSIS_DIR, f"{safe}-{digest}.json")


def load_cached_analysis(video_path: str) -> Optional[Dict[str, Any]]:
    path = _cache_path(video_path)
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict) and data.get("source_path") == video_path:
            return data
    except (OSError, json.JSONDecodeError, TypeError):
        pass
    return None


def save_cached_analysis(payload: Dict[str, Any]) -> str:
    path = _cache_path(payload["source_path"])
    os.makedirs(ANALYSIS_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    payload["cache_path"] = path
    return path


def _progress_cb(stage: str, percent: int, detail: str) -> None:
    _set_job(active=True, stage=stage, percent=percent, detail=detail)


def analyze_video(
    video_path: str,
    *,
    transcribe: bool = True,
    scene_detect: bool = True,
    language: str = "auto",
    use_cache: bool = True,
    duration_sec: Optional[float] = None,
) -> Dict[str, Any]:
    resolved = os.path.expanduser(video_path)
    if not os.path.isfile(resolved):
        raise FileNotFoundError(f"Video not found: {resolved}")

    if use_cache:
        cached = load_cached_analysis(resolved)
        if cached:
            return {**cached, "from_cache": True}

    with _analyze_lock:
        if _analyze_job.get("active"):
            raise RuntimeError("Another video analysis is already running.")
        _set_job(
            active=True,
            stage="starting",
            percent=3,
            detail="Starting analysis",
            started_at=time.time(),
            error=None,
        )

    warnings: List[str] = []

    try:
        if duration_sec is None:
            _progress_cb("probe", 8, "Reading duration")
            duration_sec = video_duration_sec(resolved)
        else:
            duration_sec = float(duration_sec)

        scenes: List[Dict[str, Any]] = []
        if scene_detect:
            _progress_cb("scenes", 20, "Detecting scene boundaries")
            try:
                scenes = detect_scenes(resolved, duration_sec)
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"SCENE_DETECT_FAILED: {exc}")
                scenes = [{"index": 0, "start": 0.0, "end": round(duration_sec, 3)}]

        transcript: Dict[str, Any] = {
            "segments": [],
            "language": "unknown",
            "full_text": "",
            "warnings": [],
        }
        if transcribe:
            transcript = transcribe_video(
                resolved,
                language=None if language == "auto" else language,
                on_progress=_progress_cb,
            )
            warnings.extend(transcript.get("warnings") or [])

        payload: Dict[str, Any] = {
            "source_path": resolved,
            "duration_sec": round(duration_sec, 3),
            "transcript": {
                "segments": transcript.get("segments") or [],
                "language": transcript.get("language") or "unknown",
                "full_text": transcript.get("full_text") or "",
            },
            "scenes": scenes,
            "visual_notes": [],
            "warnings": warnings,
            "whisper_available": whisper_available(),
            "from_cache": False,
        }

        save_cached_analysis(payload)
        _set_job(active=False, stage="done", percent=100, detail="Analysis complete")
        return payload
    except Exception as exc:
        _set_job(active=False, stage="error", error=str(exc)[:500])
        raise
