"""Structured visual analysis of screencast scenes (VLM via Ollama).

Visual scenes come from FFmpeg cuts. Long shots are sampled into analysis
windows so the model actually sees UI changes — those windows are for
understanding, not a requirement to speak every N seconds.
"""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Tuple

from ollama_rt import KEEP_ALIVE_WARM, unload_model as _unload_ollama_model

OLLAMA_URL = "http://127.0.0.1:11434"
VISION_MODEL_HINTS = (
    "qwen2.5vl",
    "qwen2.5-vl",
    "qwen2-vl",
    "qwen3-vl",
    "llava",
    "llama3.2-vision",
    "minicpm-v",
    "moondream",
    "granite3.2-vision",
    "bakllava",
)
MAX_WINDOWS = 36
ProgressFn = Optional[Callable[[str, int, str], None]]


def is_vision_model(name: str) -> bool:
    """True only for image-capable Ollama names. Text qwen2.5:14b must not match."""
    low = (name or "").strip().lower()
    if not low:
        return False
    if any(hint in low for hint in VISION_MODEL_HINTS):
        return True
    if "vision" in low:
        return True
    if re.search(r"(?:^|[:\-/])vl(?:[:\-/]|$)", low):
        return True
    return False


def _ffmpeg_bin() -> Optional[str]:
    return shutil.which("ffmpeg")


def detect_vision_model() -> Optional[str]:
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None
    models = [str(item.get("name") or "") for item in data.get("models") or [] if item.get("name")]
    vision = [m for m in models if is_vision_model(m)]
    if not vision:
        return None
    for m in vision:
        if "14b" in m.lower():
            return m
    for m in vision:
        if "7b" in m.lower():
            return m
    return vision[0]


def _extract_json(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[\s\S]*\}", raw)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def analysis_windows(
    scenes: List[Dict[str, Any]],
    duration_sec: float,
    max_windows: int = MAX_WINDOWS,
) -> List[Dict[str, Any]]:
    """Turn visual cuts into windows the VLM can inspect (not speech slots)."""
    windows: List[Dict[str, Any]] = []
    if not scenes:
        scenes = [{"start": 0.0, "end": duration_sec}]
    for scene in scenes:
        start = float(scene.get("start", 0.0))
        end = float(scene.get("end", duration_sec))
        span = max(0.4, end - start)
        if span <= 14:
            windows.append({"start": round(start, 3), "end": round(min(end, duration_sec), 3)})
            continue
        parts = max(2, min(8, int((span + 9.99) // 10)))
        step = span / parts
        for k in range(parts):
            a = start + k * step
            b = end if k == parts - 1 else start + (k + 1) * step
            windows.append({"start": round(a, 3), "end": round(min(b, duration_sec), 3)})

    if len(windows) > max_windows:
        merged: List[Dict[str, Any]] = []
        group = max(2, int((len(windows) + max_windows - 1) // max_windows) + 1)
        i = 0
        while i < len(windows):
            chunk = windows[i:i + group]
            merged.append({"start": chunk[0]["start"], "end": chunk[-1]["end"]})
            i += group
        windows = merged[:max_windows]

    for i, window in enumerate(windows):
        window["index"] = i
    return windows


def _grab_frame(ffmpeg: str, video_path: str, time_sec: float, dest: str) -> bool:
    ext = os.path.splitext(video_path)[1].lower()
    is_image = ext in (".png", ".jpg", ".jpeg", ".webp", ".bmp")
    cmd = [ffmpeg, "-y"]
    if not is_image and time_sec > 0:
        cmd.extend(["-ss", f"{time_sec:.3f}"])
    cmd.extend([
        "-i", video_path,
        "-frames:v", "1",
        "-vf", "scale='min(1024,iw)':-2",
        "-q:v", "4",
        dest,
    ])
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=60)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        if not is_image:
            try:
                cmd_fallback = [
                    ffmpeg, "-y", "-i", video_path,
                    "-frames:v", "1", "-vf", "scale='min(1024,iw)':-2", "-q:v", "4", dest,
                ]
                subprocess.run(cmd_fallback, check=True, capture_output=True, text=True, timeout=30)
            except Exception:
                return False
        else:
            return False
    return os.path.isfile(dest)


def extract_window_frames(
    video_path: str,
    windows: List[Dict[str, Any]],
    out_dir: str,
) -> List[Dict[str, Any]]:
    ffmpeg = _ffmpeg_bin()
    if not ffmpeg:
        return []
    os.makedirs(out_dir, exist_ok=True)
    packed: List[Dict[str, Any]] = []
    for window in windows:
        start = float(window["start"])
        end = float(window["end"])
        span = max(0.4, end - start)
        index = int(window.get("index", len(packed)))
        times = [start + min(0.2, span * 0.08)]
        if span >= 2.5:
            times.append(start + span / 2)
        times.append(max(start, end - min(0.25, span * 0.08)))
        # Extra sample in long windows.
        if span >= 12:
            times.append(start + span * 0.75)
        uniq: List[float] = []
        for ts in times:
            if not uniq or abs(ts - uniq[-1]) > 0.35:
                uniq.append(ts)
        paths: List[str] = []
        for k, ts in enumerate(uniq[:4]):
            dest = os.path.join(out_dir, f"win-{index:03d}-{k}.jpg")
            if _grab_frame(ffmpeg, video_path, ts, dest):
                paths.append(dest)
        if not paths:
            continue
        packed.append({
            "index": index,
            "start": start,
            "end": end,
            "times": uniq[: len(paths)],
            "frame_paths": paths,
            "frame_path": paths[min(1, len(paths) - 1)],
        })
    return packed


def _ask_vlm(
    model: str,
    image_paths: List[str],
    language: str,
    previous_summary: str,
) -> Optional[dict[str, Any]]:
    images: List[str] = []
    for path in image_paths:
        try:
            with open(path, "rb") as handle:
                images.append(base64.b64encode(handle.read()).decode("ascii"))
        except OSError:
            continue
    if not images:
        return None
    ru = language.startswith("ru")
    prev = re.sub(r"\s+", " ", (previous_summary or "").strip())[:160]
    prev = prev or ("(none)" if not ru else "(нет)")
    if ru:
        ask = f"""Кадры ПО ПОРЯДКУ из одного куска скринкаста (начало / середина / конец). Это запись экрана, не статичный постер.
Коротко о предыдущем куске (не копируй этот текст): {prev}

Сравни ТОЛЬКО эти кадры между собой: что открылось, куда кликнули, что прокрутили, крутится ли 3D, сменился ли экран.
Если кадр сменился — narration_recommended=true и pause_ok=false.
pause_ok=true только когда это тот же экран и нового действия нет.
Ссылка «ADMIN» в шапке сама по себе не значит, что открыта админка.

Верни ТОЛЬКО JSON:
{{
  "visual_summary": "2-3 предложения: какой экран и что ИЗМЕНИЛОСЬ / что делает пользователь",
  "screen_type": "home|catalog|product|cart|checkout|admin|other",
  "objects": ["видимые объекты"],
  "visible_product": "товар на кадре или пусто",
  "actions": ["клик / скролл / поворот 3D / переход / смена языка / в корзину"],
  "ui_elements": ["подписи, кнопки, панели, которые реально видны"],
  "product_features": ["только продемонстрированные возможности UI"],
  "user_doing": "что делает курсор или зритель в этом куске",
  "changes_from_previous": "что изменилось с прошлого куска; пусто если тот же кадр",
  "demonstrated_feature": "какую возможность шаблона этот кусок реально показывает, или пусто",
  "importance": "high" | "medium" | "low" | "skip",
  "narration_recommended": true,
  "narration_goal": "зачем говорить, или пусто",
  "pause_ok": false,
  "confidence": 0.0
}}
Не выдумывай экраны и функции. pause_ok=true и narration_recommended=false, если кусок — повтор, логотип или пустой переход."""
    else:
        ask = f"""Frames IN TIME ORDER from one screencast slice (start / middle / end). This is a screen recording, not a poster.
Previous slice (do not copy this text): {prev}

Compare ONLY these frames: what opened, what was clicked, what scrolled, whether 3D moved, whether the page changed.
If the page changed: narration_recommended=true and pause_ok=false.
pause_ok=true only when it is the same screen and nothing new happened.
A header link that says ADMIN does not mean the admin dashboard is open.

Return ONLY JSON:
{{
  "visual_summary": "2-3 sentences: which screen and what CHANGED / what the user did",
  "screen_type": "home|catalog|product|cart|checkout|admin|other",
  "objects": ["visible objects"],
  "visible_product": "product on screen or empty",
  "actions": ["click / scroll / 3D orbit / navigate / language switch / add to cart"],
  "ui_elements": ["labels, buttons, panels actually visible"],
  "product_features": ["only UI capabilities demonstrated here"],
  "user_doing": "what the cursor or viewer does in this slice",
  "changes_from_previous": "what changed vs the previous slice; empty if same shot",
  "demonstrated_feature": "which template ability this slice actually shows, or empty",
  "importance": "high" | "medium" | "low" | "skip",
  "narration_recommended": true,
  "narration_goal": "why speak, or empty",
  "pause_ok": false,
  "confidence": 0.0
}}
Do not invent screens. pause_ok=true and narration_recommended=false for repeats, logos, or empty transitions."""

    payload = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": ask, "images": images}],
            "stream": False,
            "format": "json",
            "keep_alive": KEEP_ALIVE_WARM,
            "options": {"temperature": 0.1, "num_predict": 800},
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
    content = str(((body.get("message") or {}).get("content")) or "")
    return _extract_json(content)


def _as_list(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _normalize_analysis(raw: dict[str, Any] | None, window: Dict[str, Any]) -> Dict[str, Any]:
    data = raw or {}
    importance = str(data.get("importance") or "medium").lower()
    if importance not in ("high", "medium", "low", "skip"):
        importance = "medium"
    summary = str(data.get("visual_summary") or "").strip()
    narrate = data.get("narration_recommended")
    if narrate is None:
        narrate = importance in ("high", "medium") and bool(summary)
    pause_ok = bool(data.get("pause_ok"))
    if importance == "skip":
        narrate = False
        pause_ok = True
    start = float(window["start"])
    end = float(window["end"])
    thumb = (window.get("frame_paths") or [None])[min(1, max(0, len(window.get("frame_paths") or []) - 1))]
    if not thumb:
        thumb = window.get("frame_path")
    user = str(data.get("user_doing") or data.get("cursor_action") or "").strip()
    features = _as_list(data.get("product_features"))
    demonstrated = str(data.get("demonstrated_feature") or "").strip()
    if demonstrated and demonstrated not in features:
        features.append(demonstrated)
    product = str(data.get("visible_product") or "").strip()
    if product.lower() in {"товар на кадре или пусто", "пусто", "empty", "n/a", "none", "-"}:
        product = ""
    objects = _as_list(data.get("objects"))
    if product and product not in objects:
        objects.insert(0, product)
    return {
        "index": int(window.get("index", 0)),
        "start": round(start, 3),
        "end": round(end, 3),
        "duration": round(max(0.0, end - start), 3),
        "visual_summary": summary,
        "screen_type": str(data.get("screen_type") or "").strip(),
        "objects": objects,
        "visible_product": product,
        "actions": _as_list(data.get("actions")),
        "ui_elements": _as_list(data.get("ui_elements")),
        "product_features": features,
        "user_doing": user,
        "changes_from_previous": str(data.get("changes_from_previous") or "").strip(),
        "demonstrated_feature": demonstrated,
        "importance": importance,
        "narration_recommended": bool(narrate),
        "narration_goal": str(data.get("narration_goal") or "").strip(),
        "pause_ok": pause_ok,
        "confidence": float(data.get("confidence") or (0.7 if summary else 0.2)),
        "frame_paths": list(window.get("frame_paths") or []),
        "frame_path": thumb,
        "caption": summary,
        "source": "vlm" if summary else "keyframe",
    }


def analyze_visual_scenes(
    video_path: str,
    scenes: List[Dict[str, Any]],
    out_dir: str,
    *,
    duration_sec: float,
    language: str = "ru",
    on_progress: ProgressFn = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[str]]:
    """Return (scene_analysis, visual_notes, warnings)."""
    windows = analysis_windows(scenes, duration_sec)
    if on_progress:
        on_progress("visual", 25, "Extracting keyframes")
    packed = extract_window_frames(video_path, windows, out_dir)
    if not packed:
        return [], [], ["KEYFRAME_EXTRACT_FAILED"]

    model = detect_vision_model()
    warnings: List[str] = []
    if not model:
        warnings.append("VISION_MODEL_MISSING")

    analyses: List[Dict[str, Any]] = []
    prev_summary = ""
    total = len(packed)
    for n, window in enumerate(packed):
        parsed = None
        if model:
            if on_progress:
                percent = 28 + int((n / max(total, 1)) * 22)
                on_progress("visual", percent, f"Reading frames {n + 1}/{total} ({model})")
            parsed = _ask_vlm(model, window["frame_paths"], language, prev_summary)
        elif on_progress:
            percent = 28 + int((n / max(total, 1)) * 22)
            on_progress("visual", percent, f"Keyframe {n + 1}/{total}")
        item = _normalize_analysis(parsed, window)
        item["frames_sent"] = len(window.get("frame_paths") or []) if model else 0
        item["vision_model"] = model or ""
        if not model:
            item["narration_recommended"] = False
            item["pause_ok"] = True
            item["importance"] = "low"
            item["source"] = "keyframe"
        analyses.append(item)
        if item["visual_summary"]:
            prev_summary = item["visual_summary"]

    if model and not any(item.get("visual_summary") for item in analyses):
        warnings.append("VISION_CAPTION_FAILED")

    # Resource lifecycle: the VLM is done the instant this batch finishes. Evict
    # it now so it does not sit resident (~5 min default) alongside the LLM/TTS
    # that run next in the narration flow.
    if model:
        _unload_ollama_model(model)

    notes = [
        {
            "time": round((item["start"] + item["end"]) / 2, 3),
            "scene_index": item["index"],
            "caption": item.get("visual_summary") or "",
            "source": item.get("source") or "keyframe",
            "frame_path": item.get("frame_path"),
        }
        for item in analyses
    ]
    return analyses, notes, warnings
