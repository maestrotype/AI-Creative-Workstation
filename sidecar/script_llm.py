"""Voiceover script generation from video analysis context."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Any

from ollama_rt import KEEP_ALIVE_WARM, unload_model as _unload_ollama_model

OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_OLLAMA_MODEL = "qwen2.5:7b"


def _safe_float(val: Any, default: float = 0.0) -> float:
    if val is None or val == "" or val == "N/A":
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def _transcript_for_scene(segments: list[dict[str, Any]], start: float, end: float) -> str:
    parts: list[str] = []
    for seg in segments:
        s = _safe_float(seg.get("start", 0))
        e = _safe_float(seg.get("end", 0))
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
_FORBIDDEN_SPOKEN = re.compile(
    r"\b(тварь|монстр|демон|alien|creature|demon|monster|godzilla)\b",
    re.IGNORECASE,
)
_CJK_RX = re.compile(r"[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uF900-\uFAFF\uFF00-\uFFEF]")


def _strip_cjk(text: str) -> str:
    cleaned = _CJK_RX.sub(" ", text or "")
    return re.sub(r"\s+", " ", cleaned).strip(" ,.;:!?…—–-")


def _spoken_in_language(text: str, language: str) -> str:
    """Drop leaked Chinese (Qwen default) from Russian/English voiceover."""
    raw = (text or "").strip()
    if not raw:
        return ""
    if language.startswith(("ru", "en")):
        raw = _strip_cjk(raw)
    return raw


def _purpose_in_language(text: str, language: str) -> str:
    cleaned = _spoken_in_language(text, language)
    if not cleaned:
        return ""
    # Purpose is a short director note, not a second spoken line.
    words = cleaned.split()
    if len(words) > 18:
        cleaned = " ".join(words[:18]).rstrip(" ,;:—–-")
    return cleaned


def _window_words(window_sec: float, wpm: int) -> int:
    spoken = max(0.8, window_sec) * max(80, wpm) / 60
    floor = 8 if window_sec >= 5 else 4
    return max(floor, int(round(spoken)))


def _too_thin_for_window(text: str, window_sec: float, wpm: int = 130) -> bool:
    words = [w for w in (text or "").split() if w]
    budget = _window_words(window_sec, wpm)
    return len(words) < max(6, int(round(budget * 0.7)))


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


def _looks_like_garbage(text: str, window_sec: float, wpm: int = 130) -> bool:
    raw = (text or "").strip()
    if not raw:
        return True
    if _FORBIDDEN_SPOKEN.search(raw):
        return True
    if _too_thin_for_window(raw, window_sec, wpm):
        return True
    return False


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
    caption: str = "",
) -> str:
    topic = topic or ("этот шаблон" if language.startswith("ru") else "this template")
    cap = re.sub(r"\s+", " ", (caption or "").strip()).rstrip(".")
    ru = language.startswith("ru")
    if ru:
        beats = [
            f"Это ecommerce-шаблон {topic}: настоящая витрина, каталог и карточка товара, а не картинка из генератора.",
            f"На витрине видны 3D-товары и навигация магазина — так покупатель шаблона видит витрину вживую.",
            f"Каталог и фильтры помогают быстро найти SKU и открыть карточку с 3D-моделью.",
            f"В админке загружают GLB, правят товары и заказы — это рабочая панель, не рекламный ролик.",
            f"Конструктор страниц собирает лендинги без выдуманных скриншотов.",
            f"Оплата и настройки магазина замыкают сценарий: шаблон готов к запуску витрины.",
        ]
        closer = "Спасибо, что посмотрели. Все экраны — из записи настоящего шаблона."
    else:
        beats = [
            f"This is the {topic} ecommerce template: a real storefront, catalog, and product page — not a generated still.",
            f"The storefront shows 3D products and shop navigation as a buyer of the theme would see them.",
            f"Catalog and filters help find an SKU and open a product card with a 3D model.",
            f"Admin is where you upload GLB files and manage products and orders.",
            f"The page builder assembles landing pages from real UI, not mock screenshots.",
            f"Payments and shop settings close the walkthrough: the theme is ready to run a store.",
        ]
        closer = "Thanks for watching. Every screen is from a real recording of the template."
    if index == count - 1 and count > 1:
        core = closer
    else:
        core = beats[index % len(beats)]
    if cap:
        lead = f"На экране {cap}. " if ru else f"On screen: {cap}. "
        line = lead + core
    else:
        line = core
    return line


def _walkthrough_lines(language: str, topic: str) -> list[str]:
    topic = topic or ("этот шаблон" if language.startswith("ru") else "this template")
    if language.startswith("ru"):
        return [
            f"Смотрим живой интерфейс {topic}, без сгенерированной картинки вместо сайта.",
            "Курсор ходит по категориям и карточкам — так покупатель шаблона видит витрину.",
            "Каталог, фильтры и 3D-товар открываются как в настоящем магазине.",
            "Админка, конструктор страниц и оплата — это те же экраны, что в поставке темы.",
            "Названия кнопок и пунктов меню читаем с экрана, ничего не выдумываем.",
        ]
    return [
        f"This is the live {topic} UI, not a generated still in place of the site.",
        "The cursor moves across categories and cards the way a theme buyer would.",
        "Catalog, filters, and the 3D product open like a real store.",
        "Admin, page builder, and payments are the same screens that ship with the theme.",
        "We name buttons and menu items from the recording and invent nothing.",
    ]


def _fill_spoken(
    text: str,
    *,
    window_sec: float,
    wpm: int,
    language: str,
    caption: str,
    topic: str,
    index: int,
) -> str:
    parts = [re.sub(r"\s+", " ", (text or "").strip())]
    parts = [part for part in parts if part]
    cap = re.sub(r"\s+", " ", (caption or "").strip()).rstrip(".")
    blob = " ".join(parts).lower()
    ru = language.startswith("ru")
    if cap and cap.lower() not in blob:
        parts.append(f"На экране сейчас: {cap}." if ru else f"On screen now: {cap}.")
    extras = _walkthrough_lines(language, topic)
    target = max(4, int(round(_window_words(window_sec, wpm) * 0.9)))
    n = 0
    while len(" ".join(parts).split()) < target and extras and n < 12:
        extra = extras[(index + n) % len(extras)]
        joined = " ".join(parts).lower()
        if extra.lower() not in joined:
            parts.append(extra)
        n += 1
    return _fit_spoken(" ".join(parts), window_sec, wpm)


def _sanitize_spoken(
    text: str,
    *,
    window_sec: float,
    wpm: int,
    language: str,
    index: int,
    count: int,
    topic: str,
    caption: str = "",
) -> str:
    raw = (text or "").strip()
    if not raw or _looks_like_direction(raw) or _looks_like_garbage(raw, window_sec, wpm):
        raw = _default_spoken(language, index, count, topic, window_sec, wpm, caption)
    return _fill_spoken(
        raw,
        window_sec=window_sec,
        wpm=wpm,
        language=language,
        caption=caption,
        topic=topic,
        index=index,
    )


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
    duration = _safe_float(video_context.get("duration_sec"), 60.0)
    scenes = list(video_context.get("scenes") or [])
    if not scenes:
        scenes = [{"index": 0, "start": 0.0, "end": duration}]
    return split_for_narration(scenes, duration, max_scene_sec=8.0)


def _caption_for_window(video_context: dict[str, Any], start: float, end: float) -> str:
    mid = (start + end) / 2
    best = ""
    best_dist = 10**9
    for note in video_context.get("visual_notes") or []:
        if not isinstance(note, dict):
            continue
        t = _safe_float(note.get("time"), -1.0)
        if t < 0:
            continue
        dist = abs(t - mid)
        if dist < best_dist and note.get("caption"):
            best_dist = dist
            best = str(note["caption"]).strip()
    return best


def _align_segments_to_scenes(
    video_context: dict[str, Any],
    llm_segments: list[dict[str, Any]],
    prompt: str,
    language: str,
    target_wpm: int = 130,
) -> list[dict[str, Any]]:
    """Force one script segment per detected scene, reusing LLM text where it overlaps."""
    scenes = _scene_list(video_context)
    duration = _safe_float(video_context.get("duration_sec"), 60.0)
    topic = _brief_as_topic(prompt, language)
    aligned: list[dict[str, Any]] = []

    for i, scene in enumerate(scenes):
        start = _safe_float(scene.get("start"), 0.0)
        end = _safe_float(scene.get("end"), duration)
        window = max(0.4, end - start)
        text = ""
        role = "hook" if i == 0 else ("outro" if i == len(scenes) - 1 else "body")
        match_by_index = len(llm_segments) == len(scenes)
        if (
            match_by_index
            and i < len(llm_segments)
            and str(llm_segments[i].get("text", "")).strip()
        ):
            text = str(llm_segments[i]["text"]).strip()
            role = str(llm_segments[i].get("role", role))
        else:
            best: dict[str, Any] | None = None
            best_overlap = 0.0
            for seg in llm_segments:
                seg_start = float(seg.get("start_sec", 0))
                seg_end = float(seg.get("end_sec", seg_start))
                overlap = min(end, seg_end) - max(start, seg_start)
                if overlap > best_overlap:
                    best_overlap = overlap
                    best = seg
            if best and best_overlap > 0.4 and str(best.get("text", "")).strip():
                text = str(best["text"]).strip()
                role = str(best.get("role", role))

        caption = _caption_for_window(video_context, start, end)
        text = _sanitize_spoken(
            text,
            window_sec=window,
            wpm=target_wpm,
            language=language,
            index=i,
            count=len(scenes),
            topic=topic,
            caption=caption,
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

    for i, scene in enumerate(scenes):
        start = float(scene.get("start", 0))
        end = float(scene.get("end", duration))
        window = max(0.4, end - start)
        overlap = _transcript_for_scene(transcript_segs, start, end)
        caption = _caption_for_window(video_context, start, end)
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
            caption=caption,
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
    scene_lines = []
    total_words = 0
    for i, s in enumerate(scenes):
        idx = int(s.get("index", i))
        start = float(s.get("start", 0))
        end = float(s.get("end", 0))
        window = max(0.0, end - start)
        # Explicit word budget per scene: without it the model writes one short
        # sentence for a long scene and the track ends up mostly silent.
        words = _window_words(window, target_wpm)
        total_words += words
        line = (
            f"- scene {idx}: {start:.1f}s – {end:.1f}s "
            f"({window:.1f}s → write ~{words} words)"
        )
        caption = _caption_for_window(video_context, start, end)
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
        if any("on screen:" in line for line in scene_lines)
        else "- No visual notes available — stay close to the brief and transcript. Still cover every scene through the full duration."
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
- Narrate the TEMPLATE on screen (storefront, catalog, product, admin, builder, payments).
- Never invent a different product, creature, insult, or feature that is not in the on-screen notes or project facts.
- Do not stop at 4 segments if more scenes are listed — one spoken paragraph per scene, covering the WHOLE duration.
- You MUST return exactly {scene_count} segments — one per scene listed above.
- segment[i].start_sec and end_sec MUST match scene[i] boundaries exactly.
- Hit the per-scene word budget shown above (±10%). Short lines leave dead air — that is a bug. Fill the window by naming what is on THIS screen (labels, cursor, panel).
- For a window under 4 seconds write ONE short spoken sentence, never a paragraph.
- Do not leave a scene silent. If the on-screen note is brief, keep talking about that same UI until the word budget is met.
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


def _list_ollama_models() -> list[str]:
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return []
    names: list[str] = []
    for item in data.get("models") or []:
        name = str(item.get("name") or "").strip()
        if name:
            names.append(name)
    return names


def _resolve_ollama_model(preferred: str) -> str | None:
    names = _list_ollama_models()
    if not names:
        return None
    if preferred and preferred in names:
        return preferred
    vision = ("llava", "vision", "moondream", "vl:", "qwen2.5vl", "qwen2-vl", "qwen3-vl")
    text_models = [name for name in names if not any(token in name.lower() for token in vision)]
    pool = text_models or names
    if preferred:
        pref_root = preferred.split(":")[0]
        pref_tag = preferred.split(":")[1] if ":" in preferred else ""
        for name in pool:
            if pref_tag and pref_root in name and pref_tag in name:
                return name
        for name in pool:
            if name.startswith(pref_root):
                return name
    for name in pool:
        if "14b" in name.lower():
            return name
    for name in pool:
        if "7b" in name.lower():
            return name
    return pool[0]


def _try_ollama(system_prompt: str, model: str = DEFAULT_OLLAMA_MODEL) -> dict[str, Any] | None:
    resolved = _resolve_ollama_model(model) or model
    payload = json.dumps(
        {
            "model": resolved,
            "messages": [{"role": "user", "content": system_prompt}],
            "stream": False,
            "format": "json",
            "keep_alive": KEEP_ALIVE_WARM,
            "options": {
                "temperature": 0.25,
                "num_ctx": 8192,
                "num_predict": 4096,
            },
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
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
        parsed["meta"].setdefault("model", resolved)
    return parsed


SPEAK_WINDOW_RATIO = 0.72
# How full a beat should be before we stop adding what the frames actually show.
BEAT_FILL = 0.85
BEAT_SEC = 16.0
MAX_BEATS_PER_CHAPTER = 6
MAX_BEATS = 40


def _analysis_rows(video_context: dict[str, Any]) -> list[dict[str, Any]]:
    rows = [row for row in (video_context.get("scene_analysis") or []) if isinstance(row, dict)]
    if rows:
        return rows
    duration = float(video_context.get("duration_sec") or 60)
    scenes = list(video_context.get("scenes") or [])
    notes = list(video_context.get("visual_notes") or [])
    if not scenes:
        scenes = [{"index": 0, "start": 0.0, "end": duration}]
    out: list[dict[str, Any]] = []
    for i, scene in enumerate(scenes):
        start = float(scene.get("start", 0.0))
        end = float(scene.get("end", duration))
        caption = ""
        frame_path = None
        for note in notes:
            if not isinstance(note, dict):
                continue
            try:
                t = float(note.get("time", -1))
            except (TypeError, ValueError):
                continue
            if start - 0.2 <= t <= end + 0.2:
                caption = str(note.get("caption") or "").strip()
                frame_path = note.get("frame_path")
                break
        out.append({
            "index": i,
            "start": start,
            "end": end,
            "duration": max(0.0, end - start),
            "visual_summary": caption,
            "user_doing": "",
            "product_features": [],
            "importance": "medium" if caption else "low",
            "narration_recommended": bool(caption) or (end - start) >= 3,
            "narration_goal": "",
            "pause_ok": not caption,
            "frame_path": frame_path,
        })
    return out


def _max_words_for_window(window_sec: float, wpm: int) -> int:
    return max(4, int(round(max(0.8, window_sec) * SPEAK_WINDOW_RATIO * max(80, wpm) / 60)))


def _estimated_sec(text: str, wpm: int) -> float:
    words = len([w for w in (text or "").split() if w])
    return round(words / max(80, wpm) * 60, 2)


def _clip_to_budget(text: str, window_sec: float, wpm: int) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if not cleaned:
        return cleaned
    budget = _max_words_for_window(window_sec, wpm)
    words = cleaned.split()
    if len(words) <= budget:
        return cleaned
    clipped = " ".join(words[:budget]).rstrip(" ,;:—–-")
    if clipped and clipped[-1] not in ".!?":
        clipped += "."
    return clipped


def _chapter_rows(video_context: dict[str, Any]) -> list[dict[str, Any]]:
    rows = [row for row in (video_context.get("chapters") or []) if isinstance(row, dict)]
    out: list[dict[str, Any]] = []
    for row in rows:
        try:
            start = float(row.get("start", 0))
            end = float(row.get("end", start))
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue
        out.append(row)
    return out


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?…])\s+", re.sub(r"\s+", " ", (text or "").strip()))
    return [part.strip() for part in parts if part.strip()]


def _said_in_window(video_context: dict[str, Any], start: float, end: float) -> str:
    parts: list[str] = []
    for seg in (video_context.get("transcript") or {}).get("segments") or []:
        if not isinstance(seg, dict):
            continue
        try:
            seg_start = float(seg.get("start", 0))
            seg_end = float(seg.get("end", seg_start))
        except (TypeError, ValueError):
            continue
        if min(end, seg_end) - max(start, seg_start) <= 0.2:
            continue
        text = str(seg.get("text") or "").strip()
        if text:
            parts.append(text)
    return " ".join(parts).strip()


def _split_span(start: float, end: float, parts: int) -> list[tuple[float, float]]:
    span = max(0.4, end - start)
    count = max(1, parts)
    if count == 1:
        return [(start, end)]
    step = span / count
    out: list[tuple[float, float]] = []
    for index in range(count):
        left = start + index * step
        right = end if index == count - 1 else start + (index + 1) * step
        out.append((left, right))
    return out


_NAV_NOISE = (
    "головна", "главная", "магазин", "best sellers", "featured categor",
    "контакти", "контакты", "адмін", "админ", "повернутися", "вернуться",
)


def _ocr_labels(lines: list[dict[str, Any]]) -> list[str]:
    labels: list[str] = []
    for line in lines:
        text = re.sub(r"\s+", " ", str(line.get("text") or "")).strip(" .•·?+")
        if len(text) < 2 or not re.search(r"[A-Za-zА-Яа-яІіЇїЄєҐґ0-9]", text):
            continue
        if text.lower() in {item.lower() for item in labels}:
            continue
        labels.append(text)
    return labels


def _screen_summary(lines: list[dict[str, Any]]) -> str:
    """Turn the words actually painted on a frame into a spoken beat."""
    labels = _ocr_labels(lines)
    if not labels:
        return ""

    def noise(text: str) -> bool:
        low = text.lower()
        return any(token in low for token in _NAV_NOISE)

    priced = [text for text in labels if re.search(r"(?:\$|€|₴)\s?\d|\d+[.,]\d{2}", text)]
    actions = [text for text in labels if re.search(r"кошик|корзин|cart|купит|buy|додати|добавить", text, re.I)]
    tabs = [text for text in labels if re.search(r"товар|характер|відгук|отзыв|схож|похож|review|detail", text, re.I)]
    stock = next((text for text in labels if re.search(r"наявност|налич|in stock", text, re.I)), "")
    title = ""
    for line in sorted(lines, key=lambda item: float(item.get("y") or 0), reverse=True):
        text = re.sub(r"\s+", " ", str(line.get("text") or "")).strip(" .•·?+")
        if float(line.get("y") or 0) > 0.78:
            continue
        if len(text) < 3 or noise(text) or "/" in text or re.fullmatch(r"[\d\W]+", text):
            continue
        if re.fullmatch(r"@?\s*[A-Za-z]{2}", text):
            continue
        if re.search(r"кошик|корзин|характер|відгук|отзыв|схож|похож|наявност|налич|код товар", text, re.I):
            continue
        if re.search(r"(?:\$|€|₴)\s?\d", text):
            continue
        title = text
        break
    if not title:
        title = next((text for text in labels if not noise(text)), labels[0])
    price = priced[0] if priced else ""
    can_orbit = any(re.search(r"orbit|покрут|rotate|3d", text, re.I) for text in labels)
    can_cart = any(re.search(r"cart|кошик|корзин|buy|купит", text, re.I) for text in labels)
    head = f"Открыта карточка «{title}»" + (f" за {price}" if price else "")
    moves: list[str] = []
    if can_orbit:
        moves.append("модель можно покрутить")
    if can_cart:
        moves.append("и добавить в корзину" if moves else "её можно добавить в корзину")
    elif tabs:
        moves.append("ниже есть подробности о товаре")
    sentence = head + (": " + " ".join(moves) if moves else "") + "."
    if stock and re.search(r"наяв|налич|stock", stock, re.I):
        sentence += " Товар в наличии."
    return sentence


def _with_frame_captions(video_context: dict[str, Any]) -> dict[str, Any]:
    rows = [row for row in (video_context.get("scene_analysis") or []) if isinstance(row, dict)]
    if not rows or any(str(row.get("visual_summary") or "").strip() for row in rows):
        return video_context
    from frame_ocr import read_frames

    found = read_frames([str(row.get("frame_path") or "") for row in rows])
    if not found:
        return video_context
    next_rows: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        summary = _screen_summary(found.get(str(row.get("frame_path") or ""), []))
        if summary:
            item["visual_summary"] = summary
            item["caption"] = summary
            item["source"] = "ocr"
            item["narration_recommended"] = True
        next_rows.append(item)
    ctx = dict(video_context)
    ctx["scene_analysis"] = next_rows
    ctx["visual_notes"] = [
        {
            "time": (float(row.get("start", 0)) + float(row.get("end", 0))) / 2,
            "caption": row.get("visual_summary") or "",
            "frame_path": row.get("frame_path"),
            "source": row.get("source") or "keyframe",
        }
        for row in next_rows
    ]
    warnings = list(ctx.get("warnings") or [])
    if "FRAME_TEXT_READ" not in warnings:
        warnings.append("FRAME_TEXT_READ")
    ctx["warnings"] = warnings
    return ctx


def _beats_from_analysis(video_context: dict[str, Any], rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One spoken line per picture. The same screen is not said twice."""
    beats: list[dict[str, Any]] = []
    for row in rows:
        start = float(row.get("start", 0))
        end = float(row.get("end", start))
        if end <= start:
            continue
        summary = str(row.get("visual_summary") or "").strip()
        said = _said_in_window(video_context, start, end)
        if beats and summary and beats[-1]["visuals"] == [summary]:
            beats[-1]["end"] = round(end, 2)
            if said and said not in beats[-1]["said"]:
                beats[-1]["said"] = f"{beats[-1]['said']} {said}".strip()
            continue
        beats.append({
            "start": round(start, 2),
            "end": round(end, 2),
            "chapter_index": int(row.get("index", 0)),
            "chapter_title": "",
            "intent": summary,
            "draft_slice": "",
            "visuals": [summary] if summary else [],
            "user": str(row.get("user_doing") or "").strip(),
            "ui": list(row.get("ui_elements") or [])[:6],
            "actions": list(row.get("actions") or [])[:6],
            "said": said,
        })
    return beats


def _speech_beats(video_context: dict[str, Any]) -> list[dict[str, Any]]:
    """Picture slices a host can actually talk through. A minute is several beats."""
    duration = float(video_context.get("duration_sec") or 60)
    chapters = _chapter_rows(video_context)
    spans = chapters or [{
        "start": 0.0,
        "end": duration,
        "title": "",
        "intent": "",
        "draft": "",
        "said": "",
    }]
    rows = _analysis_rows(video_context)
    if any(str(row.get("visual_summary") or "").strip() for row in rows):
        picture = _beats_from_analysis(video_context, rows)
        if len(picture) <= MAX_BEATS:
            return picture
        return picture[:MAX_BEATS]
    beats: list[dict[str, Any]] = []
    for chapter_index, chapter in enumerate(spans):
        start = float(chapter.get("start", 0))
        end = float(chapter.get("end", start))
        if end <= start:
            continue
        span = end - start
        count = 1 if span <= 22 else min(MAX_BEATS_PER_CHAPTER, max(2, int(round(span / BEAT_SEC))))
        slices = _split_span(start, end, count)
        draft_bits = _sentences(str(chapter.get("draft") or ""))
        for slice_index, (left, right) in enumerate(slices):
            visuals: list[str] = []
            users: list[str] = []
            ui: list[str] = []
            actions: list[str] = []
            for row in rows:
                row_start = float(row.get("start", 0))
                row_end = float(row.get("end", row_start))
                midpoint = (row_start + row_end) / 2
                if not (left <= midpoint < right or (slice_index == count - 1 and left <= midpoint <= right)):
                    continue
                summary = str(row.get("visual_summary") or "").strip()
                if summary and summary not in visuals:
                    visuals.append(summary)
                doing = str(row.get("user_doing") or "").strip()
                if doing and doing not in users:
                    users.append(doing)
                for token in list(row.get("ui_elements") or []) + list(row.get("actions") or []):
                    label = str(token).strip()
                    if not label:
                        continue
                    bucket = ui if token in (row.get("ui_elements") or []) else actions
                    if label not in bucket:
                        bucket.append(label)
            draft_slice = ""
            if draft_bits:
                draft_slice = draft_bits[slice_index] if slice_index < len(draft_bits) else ""
            beats.append({
                "start": round(left, 2),
                "end": round(right, 2),
                "chapter_index": chapter_index,
                "chapter_title": str(chapter.get("title") or ""),
                "intent": str(chapter.get("intent") or ""),
                "draft_slice": draft_slice,
                "visuals": visuals[:4],
                "user": "; ".join(users[:3]),
                "ui": ui[:6],
                "actions": actions[:6],
                "said": _said_in_window(video_context, left, right),
            })
    if len(beats) <= MAX_BEATS:
        return beats
    # Long films: keep coverage, but don't ask the model for a beat every few seconds.
    step = max(2, int((len(beats) + MAX_BEATS - 1) / MAX_BEATS))
    merged: list[dict[str, Any]] = []
    index = 0
    while index < len(beats):
        chunk = beats[index:index + step]
        head = dict(chunk[0])
        head["end"] = chunk[-1]["end"]
        for item in chunk[1:]:
            for visual in item["visuals"]:
                if visual not in head["visuals"]:
                    head["visuals"].append(visual)
            if item["said"] and item["said"] not in head["said"]:
                head["said"] = f"{head['said']} {item['said']}".strip()
            if item["draft_slice"] and item["draft_slice"] not in head["draft_slice"]:
                head["draft_slice"] = f"{head['draft_slice']} {item['draft_slice']}".strip()
        head["visuals"] = head["visuals"][:4]
        merged.append(head)
        index += step
    return merged[:MAX_BEATS]


def _beat_block(beats: list[dict[str, Any]], target_wpm: int) -> str:
    if not beats:
        return ""
    lines = [
        "Speech beats — return ONE spoken segment per beat, with the same start_sec and end_sec.",
        "A minute of picture is several beats. Do not cover a whole minute with one slogan.",
        "Write about the target word count: name what is on screen in THAT beat and what changes.",
        "Visible / User / Author said are the facts. The selling point is intent, not a line to paste.",
    ]
    for index, beat in enumerate(beats):
        window = max(0.4, float(beat["end"]) - float(beat["start"]))
        budget = _max_words_for_window(window, target_wpm)
        target = max(10, int(round(budget * BEAT_FILL)))
        lines.append(
            f"BEAT {index} {float(beat['start']):.1f}s–{float(beat['end']):.1f}s "
            f"({window:.1f}s, write about {target} words, hard max {budget})\n"
            f"  Chapter: {beat.get('chapter_title') or '—'}\n"
            f"  Show: {beat.get('intent') or '—'}\n"
            f"  Visible: {'; '.join(beat.get('visuals') or []) or '—'}\n"
            f"  User: {beat.get('user') or '—'}\n"
            f"  UI: {', '.join(beat.get('ui') or []) or '—'}\n"
            f"  Actions: {', '.join(beat.get('actions') or []) or '—'}\n"
            f"  Author said: {beat.get('said') or '—'}\n"
            f"  Selling point: {beat.get('draft_slice') or '—'}"
        )
    return "\n".join(lines) + "\n"


def _expand_from_beat(text: str, beat: dict[str, Any], language: str, wpm: int) -> str:
    window = max(0.4, float(beat["end"]) - float(beat["start"]))
    budget = _max_words_for_window(window, wpm)
    target = max(10, int(round(budget * BEAT_FILL)))
    visual = " ".join(str(item).strip() for item in (beat.get("visuals") or []) if str(item).strip())
    if visual:
        # The screen line is the narration. Do not paste it a second time.
        return _clip_to_budget(visual, window, wpm)
    parts = [re.sub(r"\s+", " ", (text or "").strip())]
    parts = [part for part in parts if part]
    ru = language.startswith("ru")

    def words() -> int:
        return len(" ".join(parts).split())

    blob = " ".join(parts).lower()
    extras: list[str] = []
    for visual in beat.get("visuals") or []:
        line = visual if str(visual).rstrip().endswith((".", "!", "?", "…")) else f"{visual}."
        extras.append(line)
    if beat.get("user"):
        extras.append(f"Сейчас {beat['user']}." if ru else f"Right now: {beat['user']}.")
    if beat.get("said"):
        extras.append(str(beat["said"]))
    if beat.get("draft_slice") and not beat.get("visuals"):
        extras.append(str(beat["draft_slice"]))
    for extra in extras:
        if words() >= target:
            break
        cleaned = re.sub(r"\s+", " ", extra).strip()
        if not cleaned or cleaned.lower() in blob:
            continue
        parts.append(cleaned)
        blob = " ".join(parts).lower()
    return _clip_to_budget(" ".join(parts), window, wpm)


def _align_segments_to_beats(
    segments: list[dict[str, Any]],
    beats: list[dict[str, Any]],
    language: str,
    target_wpm: int,
) -> list[dict[str, Any]]:
    if not beats:
        return segments
    owned: list[list[dict[str, Any]]] = [[] for _ in beats]
    for seg in segments:
        try:
            start = float(seg.get("start_sec") or 0)
            end = float(seg.get("end_sec") or start)
        except (TypeError, ValueError):
            continue
        span = max(0.0, end - start)
        owner = None
        best = 0.0
        for index, beat in enumerate(beats):
            overlap = min(end, float(beat["end"])) - max(start, float(beat["start"]))
            if overlap > best:
                best = overlap
                owner = index
        if owner is None:
            continue
        beat_len = float(beats[owner]["end"]) - float(beats[owner]["start"])
        # A single line stretched over the whole chapter is not the script for one slice.
        if span > beat_len * 1.6 and best < span * 0.55:
            continue
        owned[owner].append(seg)
    aligned: list[dict[str, Any]] = []
    for index, beat in enumerate(beats):
        start = float(beat["start"])
        end = float(beat["end"])
        text = " ".join(str(seg.get("text") or "").strip() for seg in owned[index]).strip()
        if not text:
            text = str(beat.get("draft_slice") or "").strip()
        text = _spoken_in_language(text, language)
        text = _expand_from_beat(text, beat, language, target_wpm)
        if not text:
            continue
        role = "hook" if index == 0 else "cta" if index == len(beats) - 1 else "body"
        aligned.append({
            "start_sec": round(start, 2),
            "end_sec": round(end, 2),
            "text": text,
            "role": role,
            "purpose": str(beat.get("chapter_title") or ""),
            "visual_summary": "; ".join(beat.get("visuals") or [])[:240],
            "estimated_sec": _estimated_sec(text, target_wpm),
        })
    return aligned or segments


def _chapter_block(video_context: dict[str, Any], target_wpm: int) -> str:
    rows = _chapter_rows(video_context)
    if not rows:
        return ""
    lines = [
        "Chapter plan — write ONE spoken segment per chapter. "
        "start_sec and end_sec MUST equal that chapter's window. "
        "The draft is the selling intent; rewrite it so it matches the beats inside the window "
        "and fits the length. The author's own words are facts and tone, not a script to copy."
    ]
    for i, row in enumerate(rows):
        start = float(row.get("start", 0))
        end = float(row.get("end", start))
        window = max(0.4, end - start)
        budget = _max_words_for_window(window, target_wpm)
        lines.append(
            f"CHAPTER {i + 1} {start:.1f}s–{end:.1f}s ({window:.1f}s, max ~{budget} words) "
            f"«{row.get('title') or 'chapter'}»\n"
            f"  Show: {row.get('intent') or '—'}\n"
            f"  Draft: {row.get('draft') or '—'}\n"
            f"  Author said: {row.get('said') or '—'}"
        )
    return "\n".join(lines) + "\n"


def _snap_segments_to_chapters(
    segments: list[dict[str, Any]],
    video_context: dict[str, Any],
    target_wpm: int,
) -> list[dict[str, Any]]:
    chapters = _chapter_rows(video_context)
    if not chapters:
        return segments
    snapped: list[dict[str, Any]] = []
    for i, chapter in enumerate(chapters):
        start = float(chapter.get("start", 0))
        end = float(chapter.get("end", start))
        overlapping = [
            seg for seg in segments
            if min(end, float(seg.get("end_sec") or 0)) - max(start, float(seg.get("start_sec") or 0)) > 0.4
        ]
        text = " ".join(str(seg.get("text") or "").strip() for seg in overlapping).strip()
        if not text:
            text = str(chapter.get("draft") or chapter.get("said") or "").strip()
        text = _clip_to_budget(text, max(0.4, end - start), target_wpm)
        if not text:
            continue
        role = "hook" if i == 0 else "cta" if i == len(chapters) - 1 else "body"
        snapped.append({
            "start_sec": round(start, 2),
            "end_sec": round(end, 2),
            "text": text,
            "role": role,
            "purpose": str(chapter.get("title") or ""),
            "visual_summary": str(chapter.get("intent") or ""),
            "estimated_sec": _estimated_sec(text, target_wpm),
        })
    return snapped or segments


def _fallback_from_chapters(
    video_context: dict[str, Any],
    target_wpm: int,
) -> list[dict[str, Any]]:
    return _snap_segments_to_chapters([], video_context, target_wpm)


def _build_director_prompt(
    video_context: dict[str, Any],
    prompt: str,
    language: str,
    target_wpm: int,
    project_context: str,
) -> str:
    duration = float(video_context.get("duration_sec") or 0)
    rows = _analysis_rows(video_context)
    lang_label = "Russian" if language.startswith("ru") else "English"
    blocks = []
    for i, row in enumerate(rows):
        start = float(row.get("start", 0))
        end = float(row.get("end", start))
        window = max(0.4, end - start)
        budget = _max_words_for_window(window, target_wpm)
        speak = "NARRATE" if row.get("narration_recommended") else "NO_NARRATION"
        if row.get("pause_ok") and not row.get("narration_recommended"):
            speak = "PAUSE"
        feats = ", ".join(row.get("product_features") or []) or "—"
        ui = ", ".join(row.get("ui_elements") or []) or "—"
        actions = ", ".join(row.get("actions") or []) or "—"
        blocks.append(
            f"BEAT {i} [{speak}] {start:.1f}s–{end:.1f}s ({window:.1f}s, max ~{budget} words)\n"
            f"  Visible: {row.get('visual_summary') or '(no caption)'}\n"
            f"  User: {row.get('user_doing') or '—'}\n"
            f"  UI: {ui}\n"
            f"  Actions: {actions}\n"
            f"  Features on screen: {feats}\n"
            f"  Change: {row.get('changes_from_previous') or '—'}\n"
            f"  Goal: {row.get('narration_goal') or '—'}\n"
            f"  Importance: {row.get('importance') or 'medium'}"
        )
    ctx = (project_context or "").strip()
    context_block = f"Product brief (context only — never claim a feature that is not visible):\n{ctx[:2500]}\n" if ctx else ""
    beats = _speech_beats(video_context)
    beat_block = _beat_block(beats, target_wpm)
    chapter_block = "" if beat_block else _chapter_block(video_context, target_wpm)
    listed = beat_block or (chr(10).join(blocks) or "(no beats)")
    beat_count = len(beats) or len(blocks)
    return f"""You are a director writing voiceover for a REAL screencast. Watch the beats. Then decide what to say.

User notes: {prompt or '(none)'}
{context_block}{chapter_block}
Video duration: {duration:.1f}s
Language: {lang_label}
Speaking rate target: ~{target_wpm} wpm. A minute of picture needs about a minute of speech, split across the beats — not one sentence.

Speech beats:
{listed}

Return ONLY JSON:
{{
  "segments": [
    {{
      "start_sec": 0,
      "end_sec": 5,
      "text": "spoken words",
      "role": "hook",
      "purpose": "why this line exists",
      "speak": true
    }}
  ]
}}

Rules:
- Return exactly {beat_count} segments when beats are listed — one per beat, same start_sec and end_sec.
- Hit the target word count for each beat. One slogan must not cover a minute of picture.
- Speak only about what Visible / User / Author said show in that beat. Do not invent screens that are not listed.
- The selling point is a fact you may use once. Do not paste it into every beat, and do not copy it instead of describing the frame.
- Neighboring beats must move the story: what changed on screen, what the viewer should notice next.
- Word count per segment MUST stay under that beat's hard max ({SPEAK_WINDOW_RATIO:.0%} of the beat at {target_wpm} wpm).
- roles: hook | body | outro | cta
- Spoken "text" and "purpose" MUST be only in {lang_label}. Never Chinese, never mixed scripts.
- Cover every beat through the end of the recording. Do not stop after the first chapter or the first 5 seconds.
- No stage directions, no "Scene 1", no commands like "покажи" / "tell the client".
"""


def _finalize_segments(
    raw: list[dict[str, Any]],
    video_context: dict[str, Any],
    language: str,
    target_wpm: int,
) -> list[dict[str, Any]]:
    duration = float(video_context.get("duration_sec") or 60)
    rows = _analysis_rows(video_context)
    out: list[dict[str, Any]] = []
    for item in raw:
        if item.get("speak") is False:
            continue
        text = _spoken_in_language(str(item.get("text") or ""), language)
        if not text or _looks_like_direction(text):
            continue
        start = max(0.0, float(item.get("start_sec", item.get("start", 0))))
        end = float(item.get("end_sec", item.get("end", start + 4)))
        if end <= start:
            end = min(duration, start + 4)
        end = min(end, duration)
        window = max(0.4, end - start)
        text = _clip_to_budget(text, window, target_wpm)
        if not text:
            continue
        visual = ""
        for row in rows:
            rs, re_ = float(row.get("start", 0)), float(row.get("end", 0))
            if min(end, re_) - max(start, rs) > 0.3:
                visual = str(row.get("visual_summary") or visual)
        role = str(item.get("role") or "body")
        if role not in ("hook", "body", "outro", "cta"):
            role = "body"
        out.append({
            "start_sec": round(start, 2),
            "end_sec": round(end, 2),
            "text": text,
            "role": role,
            "purpose": _purpose_in_language(str(item.get("purpose") or ""), language),
            "visual_summary": visual,
            "estimated_sec": _estimated_sec(text, target_wpm),
        })
    return out


def _fallback_from_analysis(
    video_context: dict[str, Any],
    language: str,
    target_wpm: int,
) -> list[dict[str, Any]]:
    ru = language.startswith("ru")
    rows = _analysis_rows(video_context)
    spoken: list[dict[str, Any]] = []
    pending: list[dict[str, Any]] = []

    def flush(group: list[dict[str, Any]], role: str) -> None:
        if not group:
            return
        start = float(group[0]["start"])
        end = float(group[-1]["end"])
        summaries = [str(g.get("visual_summary") or "").strip() for g in group]
        summaries = [s for s in summaries if s]
        if ru:
            if not summaries:
                return
            text = summaries[0]
            if len(group) > 1 and summaries[-1] != summaries[0]:
                text = f"{summaries[0]} {summaries[-1]}"
        else:
            if not summaries:
                return
            text = summaries[0]
            if len(group) > 1 and summaries[-1] != summaries[0]:
                text = f"{summaries[0]} {summaries[-1]}"
        window = max(0.4, end - start)
        text = _clip_to_budget(text, window, target_wpm)
        spoken.append({
            "start_sec": round(start, 2),
            "end_sec": round(end, 2),
            "text": text,
            "role": role,
            "purpose": str(group[0].get("narration_goal") or "show what is on screen"),
            "visual_summary": summaries[0] if summaries else "",
            "estimated_sec": _estimated_sec(text, target_wpm),
        })

    for i, row in enumerate(rows):
        if not row.get("narration_recommended"):
            flush(pending, "hook" if not spoken else "body")
            pending = []
            continue
        if pending and str(row.get("narration_goal") or "") != str(pending[-1].get("narration_goal") or ""):
            if str(row.get("changes_from_previous") or "").strip():
                flush(pending, "hook" if not spoken else "body")
                pending = []
        pending.append(row)
        # Don't let a spoken idea run longer than ~14s of picture.
        if pending and float(pending[-1]["end"]) - float(pending[0]["start"]) >= 14:
            flush(pending, "hook" if not spoken else "body")
            pending = []
    flush(pending, "outro" if spoken else "body")
    if spoken:
        spoken[-1]["role"] = "outro" if len(spoken) > 1 else spoken[-1]["role"]
        spoken[0]["role"] = "hook"
    return spoken


def _coverage_ok(segments: list[dict[str, Any]], duration: float) -> bool:
    if duration < 20 or not segments:
        return bool(segments)
    last = max(float(item.get("end_sec") or 0) for item in segments)
    first = min(float(item.get("start_sec") or 0) for item in segments)
    span = max(0.0, last - first)
    return span >= min(duration * 0.4, duration - 3.0) or len(segments) >= 3


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
    video_context = _with_frame_captions(video_context)
    duration = float(video_context.get("duration_sec") or 60)
    rows = _analysis_rows(video_context)
    beats = _speech_beats(video_context)
    llm_prompt = _build_director_prompt(
        video_context, prompt, language, target_wpm, project_context
    )

    if prefer_ollama:
        llm_result = _try_ollama(llm_prompt, model=ollama_model)
        if llm_result and isinstance(llm_result.get("segments"), list):
            segments = _finalize_segments(
                [item for item in llm_result["segments"] if isinstance(item, dict)],
                video_context,
                language,
                target_wpm,
            )
            if beats:
                segments = _align_segments_to_beats(segments, beats, language, target_wpm)
            elif _chapter_rows(video_context):
                segments = _snap_segments_to_chapters(segments, video_context, target_wpm)
            if segments and _coverage_ok(segments, duration):
                meta = llm_result.get("meta") if isinstance(llm_result.get("meta"), dict) else {}
                planner = "chapters" if _chapter_rows(video_context) else "visual_director"
                return {
                    "segments": segments,
                    "meta": {
                        "tone": str(meta.get("tone", "directed")),
                        "language": str(meta.get("language", language)),
                        "words_per_min": int(meta.get("words_per_min", target_wpm)),
                        "provider": "ollama",
                        "model": str(meta.get("model") or ollama_model),
                        "scene_count": len(rows),
                        "planner": planner,
                    },
                }

    chapter_fallback = _align_segments_to_beats([], beats, language, target_wpm) if beats else _fallback_from_chapters(video_context, target_wpm)
    if chapter_fallback:
        return {
            "segments": chapter_fallback,
            "meta": {
                "tone": "draft",
                "language": language,
                "words_per_min": target_wpm,
                "provider": "fallback",
                "scene_count": len(rows),
                "planner": "chapters",
                "duration_sec": duration,
            },
        }

    return {
        "segments": _fallback_from_analysis(video_context, language, target_wpm),
        "meta": {
            "tone": "draft",
            "language": language,
            "words_per_min": target_wpm,
            "provider": "fallback",
            "scene_count": len(rows),
            "planner": "visual_director",
            "duration_sec": duration,
        },
    }


def shorten_spoken(
    text: str,
    *,
    language: str,
    target_sec: float,
    wpm: int = 130,
    visual_summary: str = "",
    purpose: str = "",
) -> str:
    """Rewrite a line to fit a shorter speaking window. Used after measuring TTS."""
    budget = _max_words_for_window(max(1.0, target_sec), wpm)
    lang_label = "Russian" if language.startswith("ru") else "English"
    ask = f"""Rewrite the narration in {lang_label} so it can be spoken in about {target_sec:.1f} seconds (~{budget} words).
Keep the same meaning and the same on-screen facts. Do not add features.
Purpose: {purpose or 'n/a'}
On screen: {visual_summary or 'n/a'}
Original: {text}

Return JSON: {{ "text": "..." }}"""
    parsed = _try_ollama(ask)
    if parsed:
        candidate = str(parsed.get("text") or "").strip()
        if candidate:
            return _clip_to_budget(candidate, target_sec, wpm)
    return _clip_to_budget(text, target_sec, wpm)
