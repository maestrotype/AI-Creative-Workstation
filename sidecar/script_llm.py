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


def _scene_list(video_context: dict[str, Any]) -> list[dict[str, Any]]:
    duration = float(video_context.get("duration_sec") or 60)
    scenes = list(video_context.get("scenes") or [])
    if not scenes:
        scenes = [{"index": 0, "start": 0.0, "end": duration}]
    return scenes


def _captions_by_scene(video_context: dict[str, Any]) -> dict[int, str]:
    """First VLM caption per scene index, if visual notes are present."""
    out: dict[int, str] = {}
    for note in video_context.get("visual_notes") or []:
        if not isinstance(note, dict):
            continue
        caption = str(note.get("caption") or "").strip()
        if not caption:
            continue
        try:
            idx = int(note.get("scene_index", -1))
        except (TypeError, ValueError):
            continue
        if idx >= 0 and idx not in out:
            out[idx] = caption
    return out


def _align_segments_to_scenes(
    video_context: dict[str, Any],
    llm_segments: list[dict[str, Any]],
    prompt: str,
    language: str,
) -> list[dict[str, Any]]:
    """Force one script segment per detected scene, reusing LLM text where it overlaps."""
    scenes = _scene_list(video_context)
    duration = float(video_context.get("duration_sec") or 60)
    topic = (prompt or "").strip() or ("озвучка видео" if language.startswith("ru") else "video voiceover")
    aligned: list[dict[str, Any]] = []

    for i, scene in enumerate(scenes):
        start = float(scene.get("start", 0))
        end = float(scene.get("end", duration))
        best: dict[str, Any] | None = None
        best_overlap = 0.0
        for seg in llm_segments:
            seg_start = float(seg.get("start_sec", 0))
            seg_end = float(seg.get("end_sec", seg_start))
            overlap = min(end, seg_end) - max(start, seg_start)
            if overlap > best_overlap:
                best_overlap = overlap
                best = seg

        if best and best_overlap > 0 and str(best.get("text", "")).strip():
            text = str(best["text"]).strip()
            role = str(best.get("role", "body"))
        elif len(llm_segments) == 1 and i == 0 and str(llm_segments[0].get("text", "")).strip():
            # LLM returned a single intro block — use only for the first scene.
            text = str(llm_segments[0]["text"]).strip()
            role = str(llm_segments[0].get("role", "hook"))
        elif language.startswith("ru"):
            if i == 0:
                text = f"Привет! Сегодня — {topic}."
                role = "hook"
            elif i == len(scenes) - 1:
                text = "На этом всё. Спасибо, что посмотрели!"
                role = "outro"
            else:
                text = f"Сцена {i + 1}: главное из этой части ролика."
                role = "body"
        else:
            if i == 0:
                text = f"In this video: {topic}."
                role = "hook"
            elif i == len(scenes) - 1:
                text = "That's all — thanks for watching."
                role = "outro"
            else:
                text = f"Scene {i + 1}: key moment in this part."
                role = "body"

        aligned.append(
            {
                "start_sec": round(start, 2),
                "end_sec": round(min(end, duration), 2),
                "text": text,
                "role": role if role in ("hook", "body", "outro", "cta") else "body",
            }
        )
    return aligned


def _fallback_script(
    video_context: dict[str, Any],
    prompt: str,
    language: str,
    target_wpm: int,
) -> dict[str, Any]:
    duration = float(video_context.get("duration_sec") or 60)
    scenes = _scene_list(video_context)
    transcript_segs = list((video_context.get("transcript") or {}).get("segments") or [])
    topic = (prompt or "").strip() or ("озвучка видео" if language.startswith("ru") else "video voiceover")
    segments: list[dict[str, Any]] = []

    captions = _captions_by_scene(video_context)

    for i, scene in enumerate(scenes):
        start = float(scene.get("start", 0))
        end = float(scene.get("end", duration))
        overlap = _transcript_for_scene(transcript_segs, start, end)
        caption = captions.get(int(scene.get("index", i)))
        if overlap:
            text = overlap
        elif caption:
            text = caption
        elif language.startswith("ru"):
            if i == 0:
                text = f"Привет! Сегодня — {topic}."
            elif i == len(scenes) - 1:
                text = "На этом всё. Спасибо, что посмотрели!"
            else:
                text = f"Сцена {i + 1}: главное из этой части ролика."
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
    project_context: str = "",
) -> str:
    duration = float(video_context.get("duration_sec") or 0)
    scenes = _scene_list(video_context)
    scene_count = len(scenes)
    transcript = (video_context.get("transcript") or {}).get("full_text") or ""
    captions = _captions_by_scene(video_context)
    scene_lines = []
    total_words = 0
    for i, s in enumerate(scenes):
        idx = int(s.get("index", i))
        start = float(s.get("start", 0))
        end = float(s.get("end", 0))
        window = max(0.0, end - start)
        # Explicit word budget per scene: without it the model writes one short
        # sentence for a long scene and the track ends up mostly silent.
        words = max(4, int(round(window * target_wpm / 60)))
        total_words += words
        line = (
            f"- scene {idx}: {start:.1f}s – {end:.1f}s "
            f"({window:.1f}s → write ~{words} words)"
        )
        caption = captions.get(idx)
        if caption:
            line += f" — on screen: {caption}"
        scene_lines.append(line)
    lang_label = "Russian" if language.startswith("ru") else "English"

    context_block = ""
    ctx = (project_context or "").strip()
    if ctx:
        context_block = f"""
Project facts (ground truth about the product — rely on these, do not invent features):
{ctx[:2500]}
"""

    visual_rule = (
        "- Narrate what actually happens on screen using the per-scene notes above."
        if captions
        else "- No visual notes available — stay close to the brief and transcript."
    )

    return f"""You write a voiceover script for an existing video.

User brief: {prompt or '(no brief — infer from context)'}
{context_block}
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
- You MUST return exactly {scene_count} segments — one per scene listed above.
- segment[i].start_sec and end_sec MUST match scene[i] boundaries exactly.
- Hit the per-scene word budget shown above (±15%). The narration must cover the
  whole scene: too few words leaves dead silence on the track.
- Total script length: about {total_words} words for the whole video.
- Write flowing continuous narration: each segment must continue the previous
  one, not restart the pitch. No headings, no "Scene 1", no stage directions.
{visual_rule}
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
    project_context: str = "",
) -> dict[str, Any]:
    duration = float(video_context.get("duration_sec") or 60)
    llm_prompt = _build_llm_prompt(video_context, prompt, language, target_wpm, project_context)

    if prefer_ollama:
        llm_result = _try_ollama(llm_prompt, model=ollama_model)
        if llm_result and isinstance(llm_result.get("segments"), list):
            raw_segments = _normalize_segments(llm_result["segments"], duration)
            if raw_segments:
                scenes = _scene_list(video_context)
                segments = raw_segments
                if len(segments) != len(scenes):
                    segments = _align_segments_to_scenes(video_context, segments, prompt, language)
                meta = llm_result.get("meta") if isinstance(llm_result.get("meta"), dict) else {}
                return {
                    "segments": segments,
                    "meta": {
                        "tone": str(meta.get("tone", "generated")),
                        "language": str(meta.get("language", language)),
                        "words_per_min": int(meta.get("words_per_min", target_wpm)),
                        "provider": "ollama",
                        "model": ollama_model,
                        "scene_count": len(scenes),
                    },
                }

    return _fallback_script(video_context, prompt, language, target_wpm)
