"""Voiceover script generation from video analysis context."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Any

OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_OLLAMA_MODEL = "qwen2.5:7b"


def _transcript_for_scene(segments: list[dict[str, Any]], start: float, end: float) -> str:
    parts: list[str] = []
    for seg in segments:
        s = float(seg.get("start", 0))
        e = float(seg.get("end", 0))
        if e <= start or s >= end:
            continue
        text = str(seg.get("text", "")).strip()
        if text:
            parts.append(text)
    return " ".join(parts).strip()


def _extract_json(text: str) -> dict[str, Any] | None:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def _normalize_segments(raw: list[Any], duration_sec: float) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        start = max(0.0, float(item.get("start_sec", item.get("start", 0))))
        end = float(item.get("end_sec", item.get("end", start + 5)))
        if end <= start:
            end = min(duration_sec, start + 5)
        text = str(item.get("text", "")).strip()
        if not text:
            continue
        role = str(item.get("role", "body")).strip() or "body"
        out.append(
            {
                "start_sec": round(start, 2),
                "end_sec": round(min(end, duration_sec), 2),
                "text": text,
                "role": role if role in ("hook", "body", "outro", "cta") else "body",
            }
        )
    return out


def _fallback_script(
    video_context: dict[str, Any],
    prompt: str,
    language: str,
    target_wpm: int,
) -> dict[str, Any]:
    duration = float(video_context.get("duration_sec") or 60)
    scenes = list(video_context.get("scenes") or [])
    if not scenes:
        scenes = [{"index": 0, "start": 0, "end": duration}]
    transcript_segs = list((video_context.get("transcript") or {}).get("segments") or [])
    topic = (prompt or "").strip() or ("озвучка видео" if language.startswith("ru") else "video voiceover")
    segments: list[dict[str, Any]] = []

    for i, scene in enumerate(scenes):
        start = float(scene.get("start", 0))
        end = float(scene.get("end", duration))
        overlap = _transcript_for_scene(transcript_segs, start, end)
        if overlap:
            text = overlap
        elif language.startswith("ru"):
            if i == 0:
                text = f"Сейчас посмотрим: {topic}."
            elif i == len(scenes) - 1:
                text = "На этом всё — спасибо за просмотр."
            else:
                text = f"Дальше по теме «{topic[:80]}» — часть {i + 1}."
        else:
            if i == 0:
                text = f"In this video: {topic}."
            elif i == len(scenes) - 1:
                text = "That's all — thanks for watching."
            else:
                text = f"Continuing with {topic[:80]} — part {i + 1}."

        role = "hook" if i == 0 else ("outro" if i == len(scenes) - 1 else "body")
        segments.append(
            {
                "start_sec": round(start, 2),
                "end_sec": round(end, 2),
                "text": text,
                "role": role,
            }
        )

    return {
        "segments": segments,
        "meta": {
            "tone": "draft",
            "language": language,
            "words_per_min": target_wpm,
            "provider": "fallback",
        },
    }


def _build_llm_prompt(
    video_context: dict[str, Any],
    prompt: str,
    language: str,
    target_wpm: int,
) -> str:
    duration = float(video_context.get("duration_sec") or 0)
    scenes = video_context.get("scenes") or []
    transcript = (video_context.get("transcript") or {}).get("full_text") or ""
    scene_lines = [
        f"- scene {s.get('index', i)}: {s.get('start', 0):.1f}s – {s.get('end', 0):.1f}s"
        for i, s in enumerate(scenes)
    ]
    lang_label = "Russian" if language.startswith("ru") else "English"
    return f"""You write a voiceover script for an existing video.

User brief: {prompt or '(no brief — infer from context)'}

Video duration: {duration:.1f} seconds
Target language: {lang_label}
Target pace: ~{target_wpm} words per minute

Scenes:
{chr(10).join(scene_lines) or '- single continuous shot'}

Transcript (may be empty):
{transcript[:4000] or '(none — describe what likely happens per scene based on the brief)'}

Return ONLY valid JSON:
{{
  "segments": [
    {{ "start_sec": 0, "end_sec": 12, "text": "...", "role": "hook" }}
  ],
  "meta": {{ "tone": "friendly", "language": "{language}", "words_per_min": {target_wpm} }}
}}

Rules:
- One segment per scene (or merge only adjacent short scenes).
- Each segment text must fit its time window at ~{target_wpm} wpm.
- segment start_sec/end_sec must align with scene boundaries.
- roles: hook | body | outro | cta
- No markdown, no commentary outside JSON.
"""


def _try_ollama(system_prompt: str, model: str = DEFAULT_OLLAMA_MODEL) -> dict[str, Any] | None:
    payload = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": system_prompt}],
            "stream": False,
            "format": "json",
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None

    content = (body.get("message") or {}).get("content") or ""
    parsed = _extract_json(content)
    if not parsed:
        return None
    parsed.setdefault("meta", {})
    if isinstance(parsed["meta"], dict):
        parsed["meta"]["provider"] = "ollama"
        parsed["meta"].setdefault("model", model)
    return parsed


def generate_voiceover_script(
    video_context: dict[str, Any],
    prompt: str,
    language: str = "ru",
    target_wpm: int = 130,
    *,
    prefer_ollama: bool = True,
    ollama_model: str = DEFAULT_OLLAMA_MODEL,
) -> dict[str, Any]:
    duration = float(video_context.get("duration_sec") or 60)
    llm_prompt = _build_llm_prompt(video_context, prompt, language, target_wpm)

    if prefer_ollama:
        llm_result = _try_ollama(llm_prompt, model=ollama_model)
        if llm_result and isinstance(llm_result.get("segments"), list):
            segments = _normalize_segments(llm_result["segments"], duration)
            if segments:
                meta = llm_result.get("meta") if isinstance(llm_result.get("meta"), dict) else {}
                return {
                    "segments": segments,
                    "meta": {
                        "tone": str(meta.get("tone", "generated")),
                        "language": str(meta.get("language", language)),
                        "words_per_min": int(meta.get("words_per_min", target_wpm)),
                        "provider": "ollama",
                        "model": ollama_model,
                    },
                }

    return _fallback_script(video_context, prompt, language, target_wpm)
