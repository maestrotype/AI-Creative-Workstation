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


_INSTRUCTION_START = re.compile(
    r"^(расскажи|покажи|опиши|объясни|напиши|сделай|tell|show|explain|describe|write)\b",
    re.IGNORECASE,
)
_LEAKED_HOOK = re.compile(r"^привет!\s*сегодня\s*[—–-]", re.IGNORECASE)


def _window_words(window_sec: float, wpm: int) -> int:
    return max(3, int(round(max(0.4, window_sec) * max(80, wpm) / 60)))


def _fit_spoken(text: str, window_sec: float, wpm: int) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if not cleaned:
        return cleaned
    words = cleaned.split()
    budget = _window_words(window_sec, wpm)
    if len(words) <= budget:
        return cleaned
    clipped = " ".join(words[:budget]).rstrip(" ,;:—–-")
    if clipped and clipped[-1] not in ".!?":
        clipped += "."
    return clipped


def _brief_as_topic(prompt: str, language: str) -> str:
    """Director notes are not spoken lines."""
    raw = re.sub(r"\s+", " ", (prompt or "").strip())
    fallback = "этот проект" if language.startswith("ru") else "this project"
    if not raw:
        return fallback
    rest = _INSTRUCTION_START.sub("", raw)
    rest = re.sub(
        r"\b(потенциальному клиенту|потенциальных клиентов|клиенту|a potential client|the client)\b",
        "",
        rest,
        flags=re.IGNORECASE,
    )
    rest = rest.strip(" —–-:")
    about = re.search(r"\b(?:о|об|про|about)\s+(.+)", rest, flags=re.IGNORECASE)
    clause = about.group(1) if about else rest
    clause = re.split(r"[.!?\n,(]", clause, maxsplit=1)[0].strip()
    words = [w for w in clause.split() if w]
    if len(words) > 6:
        clause = " ".join(words[:6])
    return clause or fallback


def _looks_like_direction(text: str) -> bool:
    raw = (text or "").strip()
    if not raw:
        return False
    if _INSTRUCTION_START.match(raw) or _LEAKED_HOOK.match(raw):
        return True
    lowered = raw.lower()
    return any(token in lowered for token in (
        "потенциальному клиенту",
        "tell a potential",
        "покажи витрину",
        "затем админку",
    ))


def _default_spoken(
    language: str,
    index: int,
    count: int,
    topic: str,
    window_sec: float,
    wpm: int,
) -> str:
    topic = topic or ("этот проект" if language.startswith("ru") else "this project")
    if language.startswith("ru"):
        if index == 0:
            line = f"Коротко о {topic}." if window_sec < 4 else f"Привет. Сегодня коротко о {topic}."
        elif index == count - 1:
            line = "Спасибо, что посмотрели."
        else:
            line = f"Дальше — {topic}."
    else:
        if index == 0:
            line = f"A look at {topic}." if window_sec < 4 else f"Today, a short look at {topic}."
        elif index == count - 1:
            line = "Thanks for watching."
        else:
            line = f"Next: {topic}."
    return _fit_spoken(line, window_sec, wpm)


def _sanitize_spoken(
    text: str,
    *,
    window_sec: float,
    wpm: int,
    language: str,
    index: int,
    count: int,
    topic: str,
) -> str:
    raw = (text or "").strip()
    if not raw or _looks_like_direction(raw):
        return _default_spoken(language, index, count, topic, window_sec, wpm)
    return _fit_spoken(raw, window_sec, wpm)


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
    target_wpm: int = 130,
) -> list[dict[str, Any]]:
    """Force one script segment per detected scene, reusing LLM text where it overlaps."""
    scenes = _scene_list(video_context)
    duration = float(video_context.get("duration_sec") or 60)
    topic = _brief_as_topic(prompt, language)
    aligned: list[dict[str, Any]] = []

    for i, scene in enumerate(scenes):
        start = float(scene.get("start", 0))
        end = float(scene.get("end", duration))
        window = max(0.4, end - start)
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
            text = str(llm_segments[0]["text"]).strip()
            role = str(llm_segments[0].get("role", "hook"))
        else:
            text = ""
            role = "hook" if i == 0 else ("outro" if i == len(scenes) - 1 else "body")

        text = _sanitize_spoken(
            text,
            window_sec=window,
            wpm=target_wpm,
            language=language,
            index=i,
            count=len(scenes),
            topic=topic,
        )
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
    topic = _brief_as_topic(prompt, language)
    segments: list[dict[str, Any]] = []

    captions = _captions_by_scene(video_context)

    for i, scene in enumerate(scenes):
        start = float(scene.get("start", 0))
        end = float(scene.get("end", duration))
        window = max(0.4, end - start)
        overlap = _transcript_for_scene(transcript_segs, start, end)
        caption = captions.get(int(scene.get("index", i)))
        if overlap and not _looks_like_direction(overlap):
            text = overlap
        elif caption and not _looks_like_direction(caption):
            text = caption
        else:
            text = ""
        text = _sanitize_spoken(
            text,
            window_sec=window,
            wpm=target_wpm,
            language=language,
            index=i,
            count=len(scenes),
            topic=topic,
        )

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
- Hit the per-scene word budget shown above (±15%). For a window under 4 seconds
  write ONE short spoken sentence, never a paragraph.
- The brief and project facts are NOTES for you. Never read them aloud. Never
  write commands like "tell the client", "show the storefront", "расскажи",
  "покажи", "опиши". Write the words a host would actually say on camera.
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
                    segments = _align_segments_to_scenes(
                        video_context, segments, prompt, language, target_wpm
                    )
                else:
                    topic = _brief_as_topic(prompt or project_context, language)
                    cleaned: list[dict[str, Any]] = []
                    for i, seg in enumerate(segments):
                        window = max(0.4, float(seg.get("end_sec", 0)) - float(seg.get("start_sec", 0)))
                        cleaned.append({
                            **seg,
                            "text": _sanitize_spoken(
                                str(seg.get("text", "")),
                                window_sec=window,
                                wpm=target_wpm,
                                language=language,
                                index=i,
                                count=len(segments),
                                topic=topic,
                            ),
                        })
                    segments = cleaned
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
