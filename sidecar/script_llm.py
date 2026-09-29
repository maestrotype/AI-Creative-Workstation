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
    clipped_words = words[:budget]
    while clipped_words and re.fullmatch(
        r"(на|в|и|а|или|не|только|с|со|к|по|для|как|the|a|an|to|of|and|not|only|for|as)",
        clipped_words[-1],
        re.I,
    ):
        clipped_words.pop()
    clipped = " ".join(clipped_words).rstrip(" ,;:—–-")
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


def _try_ollama(
    system_prompt: str,
    model: str = DEFAULT_OLLAMA_MODEL,
    *,
    num_predict: int = 4096,
    temperature: float = 0.25,
) -> dict[str, Any] | None:
    resolved = _resolve_ollama_model(model) or model
    payload = json.dumps(
        {
            "model": resolved,
            "messages": [{"role": "user", "content": system_prompt}],
            "stream": False,
            "format": "json",
            "keep_alive": KEEP_ALIVE_WARM,
            "options": {
                "temperature": temperature,
                "num_ctx": 8192,
                "num_predict": num_predict,
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


SPEAK_WINDOW_RATIO = 0.92
# How full a beat should be before we stop adding what the frames actually show.
BEAT_FILL = 0.92
BEAT_SEC = 8.0
MAX_BEAT_SEC = 10.0
MAX_BEATS_PER_CHAPTER = 8
MAX_BEATS = 48
# One spoken line covers the picture it sits on. Longer than this is a chapter, not a moment.
NARRATION_SLICE_SEC = 6.5
NARRATION_KEEP_SEC = 12.0
_SLOGAN_RX = re.compile(
    r"так (шаблон|покупатель)|блок с брендами|видна цена, новинку|"
    r"that is how the template|brands block",
    re.IGNORECASE,
)


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
    sentences = [part.strip() for part in _sentences(cleaned) if part.strip()]
    if not sentences:
        return ""
    kept: list[str] = []
    for sentence in sentences:
        ended = sentence if sentence[-1] in ".!?" else f"{sentence}."
        trial = " ".join(kept + [ended])
        if len(trial.split()) > budget:
            leftover = budget - len(" ".join(kept).split())
            words = ended.split()[:leftover]
            while words and re.fullmatch(
                r"(на|в|и|а|или|не|только|с|со|к|по|для|как|the|a|an|to|of|and|not|only|for|as)",
                words[-1],
                re.I,
            ):
                words.pop()
            if leftover >= 8 and len(words) >= 6:
                fitted = " ".join(words).rstrip(" ,;:—–-")
                kept.append(fitted if fitted[-1] in ".!?" else f"{fitted}.")
            elif not kept:
                return _fit_spoken(ended, window_sec, wpm)
            break
        kept.append(ended)
    return " ".join(kept)


def _readable_speech(text: str) -> bool:
    raw = re.sub(r"\s+", " ", (text or "").strip())
    if len(raw) < 12 or raw[-1] not in ".!?":
        return False
    if re.search(r"на экране отображается|появляется надпись", raw, re.I):
        return False
    if _SLOGAN_RX.search(raw) and len(raw.split()) < 18:
        return False
    for word in re.findall(r"[A-Za-zА-Яа-яЁё]{8,}", raw):
        letters = word.lower()
        vowels = len(re.findall(r"[aeiouyаеёиоуыэюя]", letters))
        if vowels / max(1, len(letters)) < 0.22:
            return False
    return True


def _classify_screen(blob: str) -> str:
    """Strongest marketplace screen in the note. Brands is last — a logo strip must not win."""
    low = (blob or "").lower()
    checks = (
        ("admin", r"admin|адмін|админ|dashboard|jwt|заказы|замовлен|пользовател"),
        ("cart", r"checkout|оформл|корзин|кошик|stripe|liqpay|paypal|wishlist|избранн"),
        ("product", r"3d|glb|three\.js|orbit|поворот|характер|відгук|отзыв|add to cart|в корзин|код товар|наявн|налич|pdp"),
        ("catalog", r"filter|фільтр|фильтр|\bshop\b|каталог|best seller|сітка|сетка|категор"),
        ("home", r"collection|коллекц|discover|product stage|витрин|hero|главн"),
        ("theme", r"\b(light|dark|glass)\b|тем[аы]|language|мов[аыу]"),
        ("builder", r"section|секц|\bcms\b|конструктор"),
        ("brands", r"brand|бренд|trusted"),
    )
    for name, rx in checks:
        if re.search(rx, low):
            return name
    if re.search(r"\$|€|₴|\d+[.,]\d{2}|цен", low):
        return "catalog"
    return "store"


def _capability_lines(screen: str, language: str) -> list[str]:
    ru = language.startswith("ru")
    bank = {
        "product": (
            [
                "Открыта карточка товара: модель можно крутить и рассматривать с разных сторон, рядом цена и переход в корзину.",
                "В шаблоне 3D на Three.js встроен прямо в страницу товара — покупатель видит вещь как вживую, не только на фото.",
                "Ниже идут характеристики, отзывы и похожие позиции: это уже сценарий маркетплейса, а не пустой лендинг.",
            ]
            if ru else
            [
                "The product page is open: the model can be rotated, with price and add-to-cart beside it.",
                "Three.js 3D sits on the product page itself, so a shopper sees the item in the round, not only in photos.",
                "Specs, reviews, and similar items follow — a marketplace product flow, not an empty landing page.",
            ]
        ),
        "catalog": (
            [
                "На экране каталог: сетка карточек, цена на каждой и вход в товар одним кликом.",
                "Фильтры и категории помогают быстро найти нужный SKU — так устроена витрина шаблона.",
                "Отсюда открывается карточка с 3D-моделью, а не статичная картинка из презентации.",
            ]
            if ru else
            [
                "This is the catalog: a grid of cards, a price on each, and one click into the product.",
                "Filters and categories help find an SKU — that is the template storefront.",
                "From here the 3D product page opens, not a static slide.",
            ]
        ),
        "home": (
            [
                "Главная встречает живой витриной: товар на сцене можно повернуть и рассмотреть.",
                "Это Product Stage шаблона — настоящий магазин в записи, а не сгенерированный кадр.",
                "Отсюда путь в каталог и в карточку такой же, как у покупателя темы после установки.",
            ]
            if ru else
            [
                "Home opens on a live stage: the product can be turned and inspected.",
                "That is the template Product Stage — a real shop in the recording, not a generated still.",
                "From here the path into catalog and product is the same one a theme buyer gets after install.",
            ]
        ),
        "cart": (
            [
                "Товар уже в корзине: видны позиции, сумма и шаг к оформлению заказа.",
                "В шаблоне корзина связана с витриной, а Stripe и способы оплаты настраиваются в админке.",
                "Избранное и checkout не спрятаны — покупатель темы видит весь путь до оплаты.",
            ]
            if ru else
            [
                "The cart is open: line items, total, and the step into checkout.",
                "Cart is wired to the storefront; Stripe and payment methods are set in admin.",
                "Wishlist and checkout stay visible — a theme buyer sees the full path to pay.",
            ]
        ),
        "admin": (
            [
                "Открыта админка: каталог, заказы, пользователи и настройки магазина.",
                "Это рабочая панель на JWT, связанная с API, а не картинка админки в ролике.",
                "Отсюда правят товары, остатки, секции витрины и ключи оплат.",
            ]
            if ru else
            [
                "Admin is open: catalog, orders, users, and shop settings.",
                "This is a live JWT dashboard on the API, not an admin screenshot in a promo.",
                "From here you edit products, stock, storefront sections, and payment keys.",
            ]
        ),
        "theme": (
            [
                "На записи меняется оформление витрины: темы и язык переключаются сразу.",
                "В шаблоне цвета сидят на токенах: Light, Dark и Glass на витрине, без правки каждого компонента.",
                "Языки из коробки — английский, украинский и русский, подписи меняются в шапке.",
            ]
            if ru else
            [
                "The recording switches the storefront look: themes and language change at once.",
                "Colors live on tokens: Light, Dark, and Glass on the shop, without editing every component.",
                "Languages ship in the box — English, Ukrainian, and Russian — and header labels follow.",
            ]
        ),
        "builder": (
            [
                "На экране конструктор секций: блоки витрины включают и выключают без правки ядра.",
                "Герой, Product Stage, сетки и FAQ собираются из CMS — витрину подгоняют под бренд.",
                "SEO и интеграции сидят рядом, ключи в кадре не читаем.",
            ]
            if ru else
            [
                "The section builder is on screen: storefront blocks turn on and off without touching the core.",
                "Hero, Product Stage, grids, and FAQ come from the CMS, so the shop can match a brand.",
                "SEO and integrations sit nearby; we do not read keys aloud.",
            ]
        ),
        "brands": (
            [
                "На витрине виден блок брендов — это доверие к магазину, но не главная сцена.",
                "Дальше шаблон ведёт в каталог и карточку, где товар можно рассмотреть и положить в корзину.",
                "Логотипы на главной только поддерживают витрину; сценарий покупки идёт через каталог и 3D.",
            ]
            if ru else
            [
                "A brands row is on the storefront — trust, not the main scene.",
                "The template still leads into catalog and product, where the item can be inspected and added to cart.",
                "Logos only support the shop; the buying path is catalog and 3D.",
            ]
        ),
        "store": (
            [
                "На записи живой интерфейс магазина: курсор идёт по витрине, а не по статичному макету.",
                "Шаблон закрывает витрину, каталог, карточку с 3D, корзину и админку.",
                "Смотрим, что именно открыто в этом куске, и какую возможность темы это показывает.",
            ]
            if ru else
            [
                "The recording is a live shop UI: the cursor moves through the storefront, not a still mock.",
                "The template covers storefront, catalog, 3D product, cart, and admin.",
                "We name what is open in this beat and which theme capability it shows.",
            ]
        ),
    }
    return list(bank.get(screen) or bank["store"])


def _template_voice(note: str, language: str) -> str:
    """Finished speech for a beat: what this screen shows, then the template ability."""
    screen = _classify_screen(note)
    return " ".join(_capability_lines(screen, language)[:2])


def _action_line(user: str, actions: list[str], language: str) -> str:
    ru = language.startswith("ru")
    doing = re.sub(r"\s+", " ", (user or "").strip())
    acts = [re.sub(r"\s+", " ", str(item).strip()) for item in actions if str(item).strip()]
    if len(doing.split()) >= 5 and _readable_speech(doing if doing[-1:] in ".!?" else f"{doing}."):
        ended = doing if doing[-1:] in ".!?" else f"{doing}."
        return ended[0].upper() + ended[1:]
    blob = " ".join(acts).lower()
    if re.search(r"orbit|поворот|крут|drag|3d", blob):
        return (
            "Курсор крутит модель: товар осматривают со всех сторон, как на живой карточке."
            if ru else
            "The cursor orbits the model so the product can be inspected from every side."
        )
    if re.search(r"scroll|скролл|прокрут", blob):
        return (
            "Страница прокручивается дальше: под основным видом открываются следующие блоки витрины."
            if ru else
            "The page scrolls on: the next storefront blocks come into view under the main stage."
        )
    if re.search(r"click|клик|переход|open", blob):
        return (
            "Клик открывает следующий экран шаблона — так покупатель темы ходит по магазину."
            if ru else
            "A click opens the next template screen — that is how a theme buyer walks the shop."
        )
    return ""


def _ui_line(ui: list[str], language: str) -> str:
    labels = []
    for raw in ui:
        text = re.sub(r"\s+", " ", str(raw).strip())
        if len(text) < 2 or len(text) > 42:
            continue
        if _ocr_junk(text):
            continue
        if text.lower() in {item.lower() for item in labels}:
            continue
        labels.append(text)
        if len(labels) >= 4:
            break
    if not labels:
        return ""
    shown = ", ".join(labels[:4])
    if language.startswith("ru"):
        return f"На этом кадре читаются элементы витрины: {shown}."
    return f"This frame shows storefront controls: {shown}."


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
    "головна", "главная", "best sellers", "featured categor",
    "контакти", "контакты", "повернутися", "вернуться",
)


def _ocr_junk(text: str) -> bool:
    low = (text or "").lower()
    if not low or "/" in low or re.fullmatch(r"[\d\W]+", low):
        return True
    if any(token in low for token in _NAV_NOISE):
        return True
    if re.search(r"\b(drag|uploaded|original|menu|home|search|contact)\b", low):
        return True
    if re.search(r"[bcdfghjklmnpqrstvwxz]{6,}", low, re.I):
        return True
    letters = re.sub(r"[^a-zа-яёіїєґ]", "", low)
    if len(letters) >= 8:
        vowels = len(re.findall(r"[aeiouyаеёиоуыэюяіїє]", letters))
        if vowels / len(letters) < 0.18:
            return True
    return False


def _ocr_labels(lines: list[dict[str, Any]]) -> list[str]:
    labels: list[str] = []
    for line in lines:
        text = re.sub(r"\s+", " ", str(line.get("text") or "")).strip(" .•·?+")
        if len(text) < 2 or not re.search(r"[A-Za-zА-Яа-яІіЇїЄєҐґ0-9]", text):
            continue
        if _ocr_junk(text):
            continue
        if text.lower() in {item.lower() for item in labels}:
            continue
        labels.append(text)
    return labels


def _screen_summary(lines: list[dict[str, Any]], language: str = "ru") -> str:
    """Describe the marketplace screen from painted labels, not a one-line slogan."""
    labels = _ocr_labels(lines)
    if not labels:
        return ""
    priced = [text for text in labels if re.search(r"(?:\$|€|₴)\s?\d|\d+[.,]\d{2}", text)]
    useful = [text for text in labels if text not in priced]
    blob = " ".join(useful + priced)
    screen = _classify_screen(blob)
    lead = _capability_lines(screen, language)[0]
    extra = _ui_line(useful[:6], language)
    if extra and extra.lower() not in lead.lower():
        return f"{lead} {extra}"
    return lead


def _summary_needs_ocr(text: str) -> bool:
    raw = (text or "").strip()
    if not raw:
        return True
    low = raw.lower()
    if low.startswith("открыта карточка") and len(raw.split()) < 16:
        return True
    return bool(_SLOGAN_RX.search(raw))


def _with_frame_captions(video_context: dict[str, Any], language: str = "ru") -> dict[str, Any]:
    """Attach OCR labels as evidence. Never invent a VLM summary from painted text."""
    del language
    rows = [row for row in (video_context.get("scene_analysis") or []) if isinstance(row, dict)]
    if not rows:
        return video_context
    from frame_ocr import read_frames

    found = read_frames([str(row.get("frame_path") or "") for row in rows])
    if not found:
        return video_context
    next_rows: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        labels = _ocr_labels(found.get(str(row.get("frame_path") or ""), []))
        if labels:
            item["ocr_labels"] = labels[:16]
            ui = list(item.get("ui_elements") or [])
            for label in labels:
                if label not in ui:
                    ui.append(label)
            item["ui_elements"] = ui[:12]
        next_rows.append(item)
    ctx = dict(video_context)
    ctx["scene_analysis"] = next_rows
    warnings = list(ctx.get("warnings") or [])
    if "FRAME_TEXT_READ" not in warnings:
        warnings.append("FRAME_TEXT_READ")
    ctx["warnings"] = warnings
    return ctx


def _chapter_covering(video_context: dict[str, Any], start: float, end: float) -> dict[str, Any] | None:
    mid = (start + end) / 2
    best: dict[str, Any] | None = None
    best_overlap = 0.0
    for chapter in _chapter_rows(video_context):
        left = float(chapter.get("start", 0))
        right = float(chapter.get("end", left))
        overlap = min(end, right) - max(start, left)
        if overlap > best_overlap or (best is None and left <= mid <= right):
            best_overlap = max(overlap, best_overlap)
            best = chapter
    return best if best_overlap > 0.2 or best is not None else None


def _decorate_beat(video_context: dict[str, Any], beat: dict[str, Any]) -> dict[str, Any]:
    chapter = _chapter_covering(video_context, float(beat["start"]), float(beat["end"]))
    if not chapter:
        return beat
    if not beat.get("chapter_title"):
        beat["chapter_title"] = str(chapter.get("title") or "")
    if not beat.get("intent"):
        beat["intent"] = str(chapter.get("intent") or "")
    if not beat.get("draft_slice"):
        beat["draft_slice"] = str(chapter.get("draft") or "")
    return beat


def _split_long_beats(beats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for beat in beats:
        start = float(beat["start"])
        end = float(beat["end"])
        span = end - start
        if span <= MAX_BEAT_SEC + 1.5:
            out.append(beat)
            continue
        count = max(2, int(round(span / MAX_BEAT_SEC)))
        for left, right in _split_span(start, end, count):
            piece = dict(beat)
            piece["start"] = round(left, 2)
            piece["end"] = round(right, 2)
            out.append(piece)
    return out


def _has_vlm_picture(row: dict[str, Any]) -> bool:
    return str(row.get("source") or "") == "vlm" and bool(str(row.get("visual_summary") or "").strip())


def _summary_key(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())[:160]


def _generic_transition(text: str) -> bool:
    low = re.sub(r"\s+", " ", (text or "").strip().lower())
    if not low:
        return True
    if low in {"click", "клик", "переход"}:
        return True
    if re.fullmatch(r"переход( на страницу категорий)?\.?", low):
        return True
    if low.startswith("изменение экрана"):
        return True
    return False


def _has_new_visual_fact(row: dict[str, Any], prev: dict[str, Any]) -> bool:
    change = str(row.get("changes_from_previous") or "")
    user = str(row.get("user_doing") or "")
    if _generic_transition(change) and _generic_transition(user):
        return False
    already = " ".join(
        [
            " ".join(prev.get("visuals") or []),
            str(prev.get("user") or ""),
            str(prev.get("change") or ""),
            str(prev.get("product") or ""),
        ]
    ).lower()
    incoming = " ".join([user, change, str(row.get("visible_product") or "")]).lower()
    new_tokens = set(re.findall(r"[a-zа-яёіїєґ0-9]{4,}", incoming)) - set(
        re.findall(r"[a-zа-яёіїєґ0-9]{4,}", already)
    )
    return len(new_tokens) >= 3


def _labels_in_span(rows: list[dict[str, Any]], start: float, end: float) -> list[str]:
    labels: list[str] = []
    for row in rows:
        left = float(row.get("start", 0))
        right = float(row.get("end", left))
        if min(end, right) - max(start, left) <= 0.2:
            continue
        for label in list(row.get("ocr_labels") or row.get("ui_elements") or []):
            text = str(label).strip()
            if text and text not in labels:
                labels.append(text)
    return labels[:12]


def _visual_quality(video_context: dict[str, Any]) -> str:
    quality = str(video_context.get("visual_quality") or "").strip()
    if quality:
        return quality
    warnings = list(video_context.get("warnings") or [])
    if "VISION_MODEL_MISSING" in warnings or "VISION_CAPTION_FAILED" in warnings:
        return "degraded"
    if any(_has_vlm_picture(row) for row in _analysis_rows(video_context)):
        return "vlm"
    return "unknown"


def _event_signal(row: dict[str, Any]) -> bool:
    """A described screen change is a beat even if the VLM also set pause_ok."""
    summary = str(row.get("visual_summary") or "").strip()
    change = str(row.get("changes_from_previous") or "").strip()
    user = str(row.get("user_doing") or "").strip()
    actions = [str(item).strip() for item in (row.get("actions") or []) if str(item).strip()]
    if str(row.get("importance") or "").lower() == "skip" and not summary:
        return False
    described = bool(summary and (change or user or actions or row.get("narration_recommended")))
    if row.get("pause_ok") and not row.get("narration_recommended") and not described:
        return False
    if not row.get("narration_recommended") and not change and not summary:
        return False
    return bool(summary or user or actions or change)


def _capability_facts(row: dict[str, Any]) -> list[str]:
    """Demonstrated abilities on one window. An action stays ahead of a painted label."""
    facts: list[str] = []
    for item in [row.get("demonstrated_feature"), *(row.get("product_features") or []), *(row.get("actions") or [])]:
        text = str(item or "").strip()
        if text and text not in facts:
            facts.append(text)
    return facts[:6]


def _beats_from_analysis(video_context: dict[str, Any], rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Meaningful visual events, not one spoken line per analysis window."""
    beats: list[dict[str, Any]] = []
    for row in rows:
        start = float(row.get("start", 0))
        end = float(row.get("end", start))
        if end <= start or not _event_signal(row):
            continue
        summary = str(row.get("visual_summary") or "").strip()
        change = str(row.get("changes_from_previous") or "").strip()
        said = _said_in_window(video_context, start, end)
        ui = list(row.get("ocr_labels") or row.get("ui_elements") or [])[:8]
        actions = list(row.get("actions") or [])[:6]
        user = str(row.get("user_doing") or "").strip()
        same_picture = (
            beats
            and summary
            and beats[-1]["visuals"]
            and (end - float(beats[-1]["start"])) <= NARRATION_KEEP_SEC
            and _summary_key(beats[-1]["visuals"][0]) == _summary_key(summary)
            and str(beats[-1].get("screen_type") or "") == str(row.get("screen_type") or "")
            and not _has_new_visual_fact(row, beats[-1])
        )
        if same_picture:
            beats[-1]["end"] = round(end, 2)
            if user and user not in (beats[-1].get("user") or ""):
                beats[-1]["user"] = f"{beats[-1].get('user') or ''} {user}".strip()
            continue
        beats.append(_decorate_beat(video_context, {
            "start": round(start, 2),
            "end": round(end, 2),
            "chapter_index": int(row.get("index", 0)),
            "chapter_title": "",
            "intent": str(row.get("demonstrated_feature") or row.get("narration_goal") or summary),
            "draft_slice": "",
            "visuals": [summary] if summary else [],
            "user": user,
            "ui": ui,
            "actions": actions,
            "said": said,
            "screen_type": str(row.get("screen_type") or ""),
            "change": change,
            "product": str(row.get("visible_product") or ""),
            "features": _capability_facts(row),
        }))
    return beats


def _speech_beats(video_context: dict[str, Any]) -> list[dict[str, Any]]:
    """Visual events a host can talk about. Analysis windows are not speech slots."""
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
    if any(_has_vlm_picture(row) for row in rows):
        picture = _fit_narration_windows(_beats_from_analysis(video_context, rows), rows)
        return picture[:MAX_BEATS]
    beats: list[dict[str, Any]] = []
    for chapter_index, chapter in enumerate(spans):
        start = float(chapter.get("start", 0))
        end = float(chapter.get("end", start))
        if end <= start:
            continue
        beats.append({
            "start": round(start, 2),
            "end": round(end, 2),
            "chapter_index": chapter_index,
            "chapter_title": str(chapter.get("title") or ""),
            "intent": str(chapter.get("intent") or ""),
            "draft_slice": str(chapter.get("draft") or ""),
            "visuals": [],
            "user": "",
            "ui": _labels_in_span(rows, start, end),
            "actions": [],
            "said": _said_in_window(video_context, start, end),
            "degraded": True,
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


def _row_at(rows: list[dict[str, Any]], time_sec: float) -> dict[str, Any] | None:
    for row in rows:
        start = float(row.get("start", 0))
        end = float(row.get("end", start))
        if start - 0.05 <= time_sec <= end + 0.05:
            return row
    return None


def _fit_narration_windows(
    beats: list[dict[str, Any]],
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Keep each spoken line on the few seconds of picture it describes."""
    fitted: list[dict[str, Any]] = []
    for beat in beats:
        start = float(beat["start"])
        end = float(beat["end"])
        span = end - start
        if span <= NARRATION_KEEP_SEC:
            fitted.append(beat)
            continue
        count = max(2, int(round(span / NARRATION_SLICE_SEC)))
        step = span / count
        for index in range(count):
            left = start + index * step
            right = end if index == count - 1 else start + (index + 1) * step
            piece = dict(beat)
            piece["start"] = round(left, 2)
            piece["end"] = round(right, 2)
            row = _row_at(rows, (left + right) / 2)
            if row:
                summary = str(row.get("visual_summary") or "").strip()
                if summary:
                    piece["visuals"] = [summary]
                user = str(row.get("user_doing") or "").strip()
                if user:
                    piece["user"] = user
                piece["change"] = str(row.get("changes_from_previous") or "").strip()
                screen = str(row.get("screen_type") or "").strip()
                if screen:
                    piece["screen_type"] = screen
                product = str(row.get("visible_product") or "").strip()
                if product:
                    piece["product"] = product
                labels = [str(item).strip() for item in (row.get("ocr_labels") or row.get("ui_elements") or []) if str(item).strip()]
                if labels:
                    piece["ui"] = labels[:8]
                actions = [str(item).strip() for item in (row.get("actions") or []) if str(item).strip()]
                if actions:
                    piece["actions"] = actions[:6]
                piece["features"] = _capability_facts(row)
            fitted.append(piece)
    return fitted


def _beat_block(beats: list[dict[str, Any]], target_wpm: int) -> str:
    if not beats:
        return ""
    del target_wpm
    lines = [
        "Evidence in timeline order. This is not a script and not one caption per event.",
        "Read every event before writing. Then tell one continuous explanation of the template.",
        "A spoken line may cover one event or several neighbouring events that show the same new fact.",
        "If an event only repeats a fact already used, set speak to false. Silence is correct.",
        "If one event lists several capabilities, narrate the demonstrated action, not a static label.",
        "Painted text is evidence that a control exists. Do not read the labels aloud as the sentence.",
    ]
    for index, beat in enumerate(beats):
        window = max(0.4, float(beat["end"]) - float(beat["start"]))
        capabilities = list(beat.get("features") or [])
        if not capabilities and beat.get("intent"):
            capabilities = [str(beat.get("intent"))]
        lines.append(
            f"EVENT {index} {float(beat['start']):.1f}s–{float(beat['end']):.1f}s ({window:.1f}s)\n"
            f"  Screen kind: {beat.get('screen_type') or '—'}\n"
            f"  What changed: {beat.get('change') or '—'}\n"
            f"  Capabilities shown (prefer an action over a label): {', '.join(capabilities) or '—'}\n"
            f"  Evidence, do not read aloud: {'; '.join(beat.get('visuals') or []) or '—'}\n"
            f"  On-screen action: {beat.get('user') or '—'}\n"
            f"  Product visible: {beat.get('product') or '—'}\n"
            f"  Painted text: {', '.join(beat.get('ui') or []) or '—'}"
        )
    return "\n".join(lines) + "\n"


def _draft_usable(text: str, language: str) -> str:
    raw = _spoken_in_language(re.sub(r"\s+", " ", (text or "").strip()), language)
    if not raw or _looks_like_direction(raw) or _SLOGAN_RX.search(raw):
        return ""
    if not _readable_speech(raw if raw[-1:] in ".!?" else f"{raw}."):
        return ""
    return raw if raw[-1:] in ".!?" else f"{raw}."


_CAPTION_OPEN_RX = re.compile(
    r"^\s*(?:"
    r"пользователь\b|"
    r"на экране\b|"
    r"здесь\b|"
    r"далее\b|"
    r"на странице\b|"
    r"на этой странице\b|"
    r"открыта страница\b|"
    r"эта страница\b|"
    r"теперь\b|"
    r"вы можете\b|"
    r"этот шаблон демонстрирует\b|"
    r"с помощью этой функции\b|"
    r"переход(?:\s+(?:на|к|со|с))\b|"
    r"прокрутка\b|"
    r"открытие\b|"
    r"продолжение\b|"
    r"the user\b|"
    r"on (?:the )?screen\b|"
    r"here(?: we|'s)\b|"
    r"on this page\b|"
    r"the page shows\b|"
    r"now you can\b"
    r")",
    re.IGNORECASE,
)

_FACT_STOP = {
    "пользователь", "перешел", "перешёл", "переходит", "перейти", "страницу", "странице",
    "страница", "экране", "экран", "здесь", "видно", "видим", "отображается", "отображаются",
    "отображается", "магазина", "магазин", "затем", "далее", "открывает", "открыта", "открыт",
    "можно", "этот", "эта", "это", "для", "что", "как", "уже", "есть", "также", "где",
    "или", "который", "которая", "которые", "этого", "этой", "этом", "только", "через",
    "снова", "также", "просто", "очень", "более", "может", "могут", "будет", "чтобы",
    "the", "user", "page", "screen", "here", "shows", "shown", "then", "next", "opens",
    "with", "that", "this", "from", "into", "when", "where", "there", "just",
}


def _is_screen_caption(sentence: str) -> bool:
    return bool(_CAPTION_OPEN_RX.search(sentence or ""))


def _without_captions(text: str) -> str:
    kept = [part.strip() for part in _sentences(text) if part.strip() and not _is_screen_caption(part)]
    if not kept:
        return ""
    line = " ".join(part if part[-1] in ".!?" else f"{part}." for part in kept)
    return line


def _content_tokens(text: str) -> set[str]:
    return {
        word for word in re.findall(r"[a-zа-яё0-9]{4,}", (text or "").lower())
        if word not in _FACT_STOP
    }


def _stem_word(word: str) -> str:
    """Collapse simple Russian endings so «сумки» and «сумку» are one fact."""
    for suffix in (
        "иями", "ями", "ами", "ого", "ему", "ому", "ыми", "ими",
        "ий", "ый", "ой", "ая", "ое", "ые", "ие", "ую", "юю",
        "ов", "ев", "ам", "ям", "ом", "ем", "ах", "ях",
        "а", "я", "у", "ю", "ы", "и", "е", "о", "й", "ь",
    ):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            word = word[: -len(suffix)]
            break
    return word[:5]


def _stems(text: str) -> set[str]:
    return {_stem_word(word) for word in _content_tokens(text)}


_GENERIC_STEMS = {
    _stem_word(word)
    for word in (
        "товар", "продукт", "элемент", "возможность", "функция", "шаблон", "покупатель",
        "интерактивный", "просмотр", "показ", "кнопка", "страница", "экран",
    )
}


def _distinct_stems(text: str) -> set[str]:
    return {stem for stem in _stems(text) if stem not in _GENERIC_STEMS}


def _adds_new_fact(text: str, covered: set[str]) -> bool:
    return bool(_stems(text) - covered)


_BOSSY_RX = re.compile(
    r"^\s*\S+(?:йте|ите|итесь|йтесь)\b|^\s*(?:please\s+)?(?:click|scroll|open|go to|look at)\b",
    re.IGNORECASE,
)
_NAV_CAP_RX = re.compile(
    r"^(?:переход|скролл|прокрут\w*|клик|нажати\w*|scroll|click|navigate)\b",
    re.IGNORECASE,
)


def _is_bossy(text: str) -> bool:
    first = _sentences(text)
    head = first[0] if first else (text or "")
    return bool(_BOSSY_RX.search(head))


def _is_navigation_capability(text: str) -> bool:
    return bool(_NAV_CAP_RX.search((text or "").strip()))


def _narratable_capabilities(beat: dict[str, Any]) -> list[str]:
    raw = [str(item).strip() for item in (beat.get("features") or []) if str(item).strip()]
    if not raw and beat.get("intent"):
        raw = [str(beat.get("intent")).strip()]
    kept: list[str] = []
    for text in raw:
        if _is_navigation_capability(text) or text in kept:
            continue
        kept.append(text)
    return kept[:4]


def _capability_is_new(capability: str, product: str, covered: set[str]) -> bool:
    stems = _distinct_stems(capability) or _stems(capability)
    product_stems = _distinct_stems(product)
    return bool(stems - covered) or bool(product_stems - covered)


def _mentions_capability(text: str, capability: str, product: str = "") -> bool:
    evidence = _stems(capability) | _stems(product)
    if not evidence:
        return True
    return bool(_stems(text) & evidence)


def _narrate_from_beat(
    beat: dict[str, Any],
    language: str,
    wpm: int,
    project_context: str = "",
    seed: str = "",
) -> str:
    """Keep a real narration line. Never turn the frame note into the spoken sentence."""
    del beat, wpm, project_context
    spoken = _without_captions(_draft_usable(seed, language))
    return spoken


def _expand_from_beat(
    text: str,
    beat: dict[str, Any],
    language: str,
    wpm: int,
    project_context: str = "",
) -> str:
    del beat, wpm, project_context
    spoken = _spoken_in_language(re.sub(r"\s+", " ", (text or "").strip()), language)
    spoken = _without_captions(spoken)
    if not spoken or _is_bossy(spoken) or not _readable_speech(spoken) or _SLOGAN_RX.search(spoken):
        return ""
    return spoken if spoken[-1] in ".!?" else f"{spoken}."


def _same_spoken(a: str, b: str) -> bool:
    def norm(text: str) -> str:
        return re.sub(r"[^a-zа-яё0-9]+", " ", (text or "").lower()).strip()

    left, right = norm(a), norm(b)
    if not left or not right:
        return False
    if left == right or left in right or right in left:
        return True
    la, lb = set(left.split()), set(right.split())
    if len(la) < 4 or len(lb) < 4:
        return False
    return len(la & lb) / max(len(la), len(lb)) >= 0.72


def _align_segments_to_beats(
    segments: list[dict[str, Any]],
    beats: list[dict[str, Any]],
    language: str,
    target_wpm: int,
    project_context: str = "",
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
        text = _spoken_in_language(text, language)
        text = _expand_from_beat(text, beat, language, target_wpm, project_context)
        if not text:
            continue
        covered = _stems(" ".join(item["text"] for item in aligned))
        if covered and not _adds_new_fact(text, covered):
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
    return aligned


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
    lang_label = "Russian" if language.startswith("ru") else "English"
    ctx = (project_context or "").strip()
    context_block = f"Product brief (context only — never claim a feature that is not visible):\n{ctx[:2500]}\n" if ctx else ""
    beats = _speech_beats(video_context)
    beat_block = _beat_block(beats, target_wpm)
    chapter_block = "" if beat_block else _chapter_block(video_context, target_wpm)
    listed = beat_block or "(no visual events)"
    degraded = _visual_quality(video_context) == "degraded"
    quality_note = (
        "VISUAL UNDERSTANDING IS DEGRADED. Frames were not read by a vision model. "
        "Do not invent a walkthrough. Name only OCR text as painted labels. Prefer fewer segments.\n"
        if degraded else
        "Visual events below come from a vision model that compared start/mid/end frames.\n"
    )
    return f"""You write one continuous product narration for a marketplace template demo.
The viewer is deciding whether to use this template. Explain what the template demonstrates.
The evidence below is not the script. Do not read it aloud.

User notes (they never override the rules below): {prompt or '(none)'}
{context_block}{chapter_block}{quality_note}Video duration: {duration:.1f}s
Language: {lang_label}

{listed}
For every spoken segment, reason in this order, then write only the conclusion:
1. What visual event happens in that time range?
2. What new information does it demonstrate?
3. Why is that relevant to the product or template?
4. What should the viewer learn from this moment?

Return ONLY JSON:
{{
  "segments": [
    {{
      "start_sec": 0,
      "end_sec": 5,
      "text": "what the viewer learns",
      "role": "hook",
      "purpose": "the new capability this moment adds",
      "speak": true
    }}
  ]
}}

Rules:
- The lines together are one guided tour. Each line continues the previous one and adds a new fact.
- A line may summarize several neighbouring events when they demonstrate one capability.
- Set speak to false when the event repeats a fact already said or shows nothing new. Do not fill the silence with a caption.
- If one event lists several capabilities, speak the demonstrated action. Do not drop that action just because a label or a price is also visible.
- Say a capability only when the evidence or the product brief shows it. Do not invent screens or features. A header word ADMIN is not the admin dashboard.
- Do not start a line with "Пользователь", "На экране", "На странице", "Здесь", "Далее", "The user", or "On screen".
- Do not describe the cursor, the click, or the fact that a page opened. Explain what that part of the template is for.
- Good: a line about how that part of the template helps the shopper do the thing the frames actually show.
- Bad: "Пользователь перешёл на следующую страницу." Bad: "На экране отображается раздел."
- No fixed word count. A busy new moment can be longer. A repeated moment should be silent.
- Avoid empty filler: "discover", "experience", "everything you need", "beautiful and convenient".
- Every sentence must end. Language: {lang_label} only.
- roles: hook | body | outro | cta
- No stage directions, no "Scene 1", no commands like "покажи".
"""


def _draft_is_caption_log(raw: list[dict[str, Any]]) -> bool:
    texts = [
        str(item.get("text") or "").strip()
        for item in raw
        if isinstance(item, dict) and item.get("speak") is not False and str(item.get("text") or "").strip()
    ]
    if len(texts) < 2:
        return False
    kept = sum(1 for text in texts if _without_captions(text))
    return kept * 2 <= len(texts)


def _rewrite_tour_prompt(
    video_context: dict[str, Any],
    language: str,
    rejected: list[dict[str, Any]],
) -> str:
    lang_label = "Russian" if language.startswith("ru") else "English"
    beats = _speech_beats(video_context)
    evidence = _beat_block(beats, 0) or "(no events)"
    bad = "\n".join(
        f"- {float(item.get('start_sec') or 0):.1f}s: {item.get('text')}"
        for item in rejected
        if str(item.get("text") or "").strip()
    )
    return f"""The draft below is a screen-caption log. It was rejected.
Rewrite it as one continuous explanation of what the template demonstrates.
Use the evidence. Do not copy the evidence aloud. Do not copy the rejected lines.

{evidence}
Rejected draft:
{bad or '(empty)'}

Return ONLY JSON with "segments".
For each spoken line: say the new capability the viewer learns, in {lang_label}.
Set speak to false when the event repeats an earlier fact.
Do not start with "Пользователь", "На экране", "На странице", "Здесь", "Далее", "The user", or "On screen".
If one event shows several capabilities, keep the demonstrated action, not only a painted label.
Do not invent features.
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
        text = _without_captions(_spoken_in_language(str(item.get("text") or ""), language))
        if not text or _looks_like_direction(text):
            continue
        start = max(0.0, float(item.get("start_sec", item.get("start", 0))))
        end = float(item.get("end_sec", item.get("end", start + 4)))
        if end <= start:
            end = min(duration, start + 4)
        end = min(end, duration)
        if text[-1] not in ".!?":
            text += "."
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
    project_context: str = "",
) -> list[dict[str, Any]]:
    beats = _speech_beats(video_context)
    if beats:
        return _align_segments_to_beats([], beats, language, target_wpm, project_context)
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
        ui: list[str] = []
        actions: list[str] = []
        for item in group:
            for label in list(item.get("ui_elements") or []):
                if label not in ui:
                    ui.append(str(label))
            for label in list(item.get("actions") or []):
                if label not in actions:
                    actions.append(str(label))
        text = _narrate_from_beat(
            {
                "start": start,
                "end": end,
                "visuals": summaries[:4],
                "user": str(group[0].get("user_doing") or ""),
                "ui": ui[:8],
                "actions": actions[:6],
                "intent": str(group[0].get("narration_goal") or ""),
                "draft_slice": "",
            },
            language,
            target_wpm,
            project_context,
        )
        if not text:
            return
        spoken.append({
            "start_sec": round(start, 2),
            "end_sec": round(end, 2),
            "text": text,
            "role": role,
            "purpose": str(group[0].get("narration_goal") or "show what is on screen"),
            "visual_summary": summaries[0] if summaries else "",
            "estimated_sec": _estimated_sec(text, target_wpm),
        })

    for row in rows:
        if not row.get("narration_recommended"):
            flush(pending, "hook" if not spoken else "body")
            pending = []
            continue
        if pending and str(row.get("narration_goal") or "") != str(pending[-1].get("narration_goal") or ""):
            if str(row.get("changes_from_previous") or "").strip():
                flush(pending, "hook" if not spoken else "body")
                pending = []
        pending.append(row)
        if pending and float(pending[-1]["end"]) - float(pending[0]["start"]) >= MAX_BEAT_SEC:
            flush(pending, "hook" if not spoken else "body")
            pending = []
    flush(pending, "outro" if spoken else "body")
    if spoken:
        spoken[-1]["role"] = "outro" if len(spoken) > 1 else spoken[-1]["role"]
        spoken[0]["role"] = "hook"
    return spoken


def _moment_to_tell(beat: dict[str, Any], covered_lines: list[str]) -> dict[str, Any] | None:
    """The new capability in this event, after navigation and already-said facts are removed."""
    covered = _stems(" ".join(covered_lines))
    product = str(beat.get("product") or "").strip()
    fresh = [
        cap for cap in _narratable_capabilities(beat)
        if _capability_is_new(cap, product, covered)
    ]
    specific = [
        cap for cap in fresh
        if not re.fullmatch(r"(?:просмотр|показ) товара(?: в магазине)?", cap.lower())
    ]
    if specific:
        fresh = specific
    if not fresh:
        return None
    also: list[str] = []
    primary_stems = _stems(fresh[0])
    for cap in fresh[1:]:
        if _stems(cap) <= primary_stems:
            continue
        also.append(cap)
        break
    section = _section_fact(str(beat.get("change") or ""))
    return {
        "primary": fresh[0],
        "also": also,
        "product": product,
        "section": section,
    }


def _section_fact(change: str) -> str:
    text = re.sub(
        r"^(?:переход\w*|изменение\w*(?:\s+\w+){0,2}|скролл\w*|scroll\w*)\s+",
        "",
        (change or "").strip(),
        flags=re.IGNORECASE,
    )
    text = re.sub(r"^(?:с\s+.+?\s+)?на\s+", "", text, flags=re.IGNORECASE)
    if len(text) < 4 or _is_navigation_capability(text):
        return ""
    return text.strip(" ,.-")


def _tour_line_prompt(
    moment: dict[str, Any],
    covered_lines: list[str],
    language: str,
    rejected: str = "",
) -> str:
    lang = "Russian" if language.startswith("ru") else "English"
    covered = "\n".join(f"- {line}" for line in covered_lines) or "(nothing yet)"
    caps = [str(moment.get("primary") or "").strip(), *(moment.get("also") or [])]
    caps = [cap for cap in caps if cap]
    also_line = (
        "Capabilities this sequence demonstrates, in order. The sentence must include each of them:\n"
        + "\n".join(f"- {cap}" for cap in caps)
        + "\n"
        if caps else ""
    )
    product = str(moment.get("product") or "").strip()
    product_line = f"Object visible in this moment: {product}\n" if product else ""
    section = str(moment.get("section") or "").strip()
    section_line = (
        f"Section this capability belongs to (do not announce a page change): {section}\n"
        if section else ""
    )
    reject = f"The previous sentence was rejected: {rejected}\nWrite a different sentence.\n" if rejected else ""
    return f"""Write one finished sentence of product narration in {lang}. Use only {lang}.
This sentence covers the whole sequence, not one frame.
Say what this part of the template lets a buyer do.
{also_line}{product_line}{section_line}Already told, do not repeat these facts:
{covered}
{reject}
Return ONLY JSON: {{"text":"...","speak":true}} or {{"text":"","speak":false}} if nothing new remains.
Rules:
- One finished thought. If several capabilities are listed, the sentence connects them.
- A statement about the template, not a command and not a caption of one object.
- Do not start with «Можно увидеть», «Можно изучить», «Показывает», «Теперь вы можете», «Вы можете», «Этот шаблон демонстрирует», «С помощью этой функции», «Пользователь», «На экране», «На странице», «Здесь», «Далее».
- Do not add an action the capabilities do not name.
- Do not describe a click, a scroll, or a page opening.
- If the object name uses another alphabet, copy it unchanged or omit it. Do not translate it.
- Do not invent a button name or a screen.
"""


def _unsupported_action(text: str, moment: dict[str, Any]) -> bool:
    allowed = _stems(" ".join(
        [str(moment.get("primary") or ""), *(moment.get("also") or []), str(moment.get("product") or ""), str(moment.get("section") or "")]
    ))
    for stem in _stems(text):
        if stem.startswith(("измен", "редакт", "настр", "созда")) and stem not in allowed:
            return True
    return False


def _foreign_leak(text: str, moment: dict[str, Any], language: str) -> bool:
    if not language.startswith("ru"):
        return False
    allowed = {
        word.lower()
        for word in re.findall(
            r"[A-Za-z]{2,}",
            " ".join([
                str(moment.get("primary") or ""),
                str(moment.get("product") or ""),
                str(moment.get("section") or ""),
                *(moment.get("also") or []),
            ]),
        )
    }
    for word in re.findall(r"[A-Za-z]{2,}", text or ""):
        if word.lower() not in allowed:
            return True
    return False


def _salvage_caption(text: str, moment: dict[str, Any]) -> str:
    """Turn a page-caption into a statement without adding facts."""
    raw = re.sub(r"\s+", " ", (text or "")).strip()
    if not raw:
        return ""
    primary = str(moment.get("primary") or "").strip()
    edited = re.sub(r"^(?:на странице|на экране)\s+", "", raw, flags=re.IGNORECASE)
    edited = re.sub(r"^эта страница\s+", "", edited, flags=re.IGNORECASE)
    edited = re.sub(r"\bвы можете\b", "можно", edited, flags=re.IGNORECASE)
    edited = re.sub(r"\bтеперь\b", "", edited, flags=re.IGNORECASE)
    edited = re.sub(r"\s+", " ", edited).strip(" ,.")
    verb = re.search(r"\b(позволяет|помогает|даёт|дает)\b\s+(.+)$", edited, flags=re.IGNORECASE)
    can = re.search(r"\bможно\b\s+(.+)$", edited, flags=re.IGNORECASE)
    shown = re.search(r"\b(?:отображается|показан\w*|представлен\w*)\b\s+(.+)$", edited, flags=re.IGNORECASE)
    if verb and primary:
        edited = f"{primary[0].upper()}{primary[1:]} {verb.group(1).lower()} {verb.group(2).strip()}"
    elif can:
        prefix = edited[: can.start()].strip(" ,.")
        body = can.group(1).strip()
        if prefix and primary and (_stems(prefix) & _stems(primary)):
            edited = f"{prefix[0].upper()}{prefix[1:]} можно {body}"
        else:
            edited = f"Можно {body}"
    elif shown and primary:
        body = shown.group(1).strip().rstrip(".")
        if re.match(r"на\s+", body, flags=re.IGNORECASE):
            return ""
        words = body.split()
        if words and re.fullmatch(r"[А-Яа-яЁё]+а", words[0]):
            words[0] = words[0][:-1] + "у"
            body = " ".join(words)
        edited = f"Можно увидеть {body}"
    else:
        return ""
    if edited[-1] not in ".!?":
        edited += "."
    if _is_screen_caption(edited) or _is_bossy(edited):
        return ""
    return edited


def _repeats_its_label(text: str, primary: str) -> bool:
    label = (primary or "").lower().strip()
    low = (text or "").lower()
    if len(label) < 16:
        return False
    for index in range(0, len(label) - 15, 4):
        piece = label[index:index + 16]
        if piece and low.count(piece) >= 2:
            return True
    return False


def _circular_claim(text: str) -> bool:
    parts = re.split(r"\b(?:позволяет|помогает)\b", text, maxsplit=1, flags=re.IGNORECASE)
    if len(parts) != 2:
        return False
    left, right = _distinct_stems(parts[0]), _distinct_stems(parts[1])
    shared = left & right
    return len(shared) >= 2 or (len(shared) >= 1 and len(right - left) <= 1)


_UI_GLOSS_RU = {
    "price": "цена стоимость",
    "cart": "корзина",
    "details": "подробности",
    "button": "кнопка",
    "view": "просмотр",
    "model": "модель",
    "add": "добавить",
    "collection": "коллекция",
    "contact": "контакт",
    "message": "сообщение",
    "theme": "тема оформление",
}
_FUNCTION_WORD = re.compile(
    r"(?:ться|тся|ть|ти|ешь|ете|ишь|овать|евать|уя|ивая|ывая|вшись|ившись|шиеся|вшиеся|шийся|шаяся|енные|енный|ующий|ающий)$",
    re.IGNORECASE,
)


def _outside_evidence(
    text: str,
    moment: dict[str, Any],
    covered_lines: list[str] | None = None,
) -> bool:
    allowed: set[str] = set(_GENERIC_STEMS)
    allowed.update(
        _stem_word(word)
        for word in (
            "позволяет", "помогает", "можно", "легко", "различные", "разные", "подробно",
            "увидеть", "изучить", "показ", "выбрать", "раздел", "сразу", "быстро",
            "известных", "конкретный", "новый", "покупатель", "затем", "также",
            "сначала", "дальше", "после", "доступно", "получает", "может",
            "открыть", "добавить", "перейти", "рассмотреть", "посмотреть",
            "показать", "получить", "начать", "найти", "отправить", "написать",
            "повернуть", "приблизить", "помощь", "способ", "удобно", "прямо", "каждый",
            "изделие", "детально", "каталог", "фрагмент", "последовательность",
            "продемонстрированная", "дает", "даёт", "предоставляет",
        )
    )
    evidence_parts = [
        moment.get("primary"),
        moment.get("product"),
        moment.get("section"),
        *(moment.get("also") or []),
        *(moment.get("products") or []),
        *(moment.get("capabilities") or []),
    ]
    evidence = " ".join(str(part or "") for part in evidence_parts)
    allowed.update(_stems(evidence))
    for word in re.findall(r"[A-Za-z]{3,}", evidence):
        gloss = _UI_GLOSS_RU.get(word.lower())
        if gloss:
            allowed.update(_stems(gloss))
    if re.search(r"\b3d\b", evidence, flags=re.IGNORECASE):
        allowed.update(_stems("модель объёмный трехмерный"))
    unknown: set[str] = set()
    for word in _content_tokens(text):
        stem = _stem_word(word)
        if _FUNCTION_WORD.search(word) or _stem_allowed(stem, allowed):
            continue
        unknown.add(stem)
    return bool(unknown - _GENERIC_STEMS)


def _stem_allowed(stem: str, allowed: set[str]) -> bool:
    if stem in allowed:
        return True
    for item in allowed:
        size = min(len(stem), len(item), 4)
        if size >= 4 and stem[:size] == item[:size]:
            return True
    return False


def _is_restatement(text: str, primary: str) -> bool:
    extra = _distinct_stems(text) - _stems(primary)
    glue = {"позвол", "помог", "можно", "различ", "разны", "легко", "подроб", "данны"}
    return not (extra - glue)


def _repair_opening(text: str) -> str:
    raw = re.sub(r"\s+", " ", (text or "")).strip()
    if re.match(r"^[А-ЯЁ][а-яё]+(?:ий|ов|ев)\s+(?:с|можно)\b", raw):
        raw = "В разделе " + raw[0].lower() + raw[1:]
    cut = re.search(r"\bможно\b", raw, flags=re.IGNORECASE)
    if cut and cut.start() > 0:
        prefix = raw[: cut.start()].strip()
        if prefix and not re.match(r"^(?:в разделе|в\s|с\s|для\s|у\s)", prefix, flags=re.IGNORECASE):
            raw = "Можно" + raw[cut.end():]
            raw = re.sub(r"\s+", " ", raw).strip()
    return raw


def _unwrap_command(text: str) -> str:
    """Drop a navigation order and keep the clause that states the fact."""
    raw = re.sub(r"\s+", " ", (text or "")).strip()
    match = re.match(
        r"^(?:теперь\s+)?(?:перейдите|перейди|откройте|открой|посмотрите|переходи)\b.+?\bгде\s+(.+)$",
        raw,
        flags=re.IGNORECASE,
    )
    if not match:
        return raw
    body = match.group(1).strip()
    if not body:
        return raw
    body = body[0].upper() + body[1:]
    return body if body[-1] in ".!?" else f"{body}."


def _is_thin_caption(text: str) -> bool:
    """A one-glance label, not a finished explanation of the sequence."""
    raw = re.sub(r"\s+", " ", (text or "")).strip()
    if re.match(r"^показывает функцию\b", raw, flags=re.IGNORECASE):
        return True
    words = re.findall(r"[A-Za-zА-Яа-яЁё0-9-]+", raw)
    if len(words) > 16:
        return False
    return bool(re.match(
        r"^(?:можно увидеть|можно изучить|показывает|показан\w*|отображается)\b",
        raw,
        flags=re.IGNORECASE,
    ))


def _mentions_several(text: str, capabilities: list[str]) -> bool:
    text_stems = _stems(text)
    hits = 0
    for cap in capabilities:
        needed = _distinct_stems(cap) or _stems(cap)
        if needed and text_stems & needed:
            hits += 1
    return hits >= 2


def _as_buyer_action(cap: str) -> str:
    text = _clean_capability(cap)
    if not text:
        return ""
    rules = (
        (r"^возможность\s+связи(\s+с\b)", r"связаться\1"),
        (r"^возможность\s+отправки\s+", "отправить "),
        (r"^возможность\s+добавления\s+", "добавить "),
        (r"^возможность\s+выбора\s+", "выбрать "),
        (r"^форма\s+для\s+отправки\s+", "отправить "),
        (r"^переход(\s+(?:между|к|на|по|с)\b)", r"переходить\1"),
        (r"^выбор(\s+(?:между|из|по)\b)", r"выбрать\1"),
        (r'^кнопка\s+[«"\']?', "нажать "),
    )
    swapped = text
    for pattern, repl in rules:
        nxt = re.sub(pattern, repl, swapped, count=1, flags=re.IGNORECASE)
        if nxt != swapped:
            swapped = nxt
            break
    else:
        if re.search(r"\b3d\b", swapped, flags=re.IGNORECASE) and not re.match(
            r"^(?:рассмотреть|изучить|просмотреть)\b", swapped, flags=re.IGNORECASE
        ):
            swapped = f"рассмотреть {swapped}"
    swapped = swapped.strip(" «»\"'")
    if not swapped:
        return ""
    return swapped[0].lower() + swapped[1:]


def _is_infinitive_phrase(text: str) -> bool:
    first = re.split(r"\s+", (text or "").strip(), maxsplit=1)[0].lower()
    return first.endswith(("ть", "ти", "чь", "ться", "тись"))


def _compose_unit_line(capabilities: list[str]) -> str:
    """One finished sentence when the model only returned a caption."""
    actions: list[str] = []
    nouns: list[str] = []
    for cap in capabilities:
        action = _as_buyer_action(cap)
        if _is_infinitive_phrase(action):
            if action not in actions:
                actions.append(action)
        else:
            noun = _clean_capability(cap)
            if noun and noun not in nouns:
                nouns.append(noun)
    if actions and not nouns:
        if len(actions) == 1:
            line = f"Покупатель может {actions[0]}"
        elif len(actions) == 2:
            line = f"Покупатель может {actions[0]}, а затем {actions[1]}"
        else:
            line = f"Покупатель может {actions[0]}, {actions[1]} и {actions[2]}"
        return line if line[-1] in ".!?" else f"{line}."
    if nouns and not actions:
        if len(nouns) == 1:
            line = f"Доступны {nouns[0][0].lower() + nouns[0][1:]}"
        else:
            line = f"Доступны {nouns[0][0].lower() + nouns[0][1:]} и {nouns[1][0].lower() + nouns[1][1:]}"
        return line if line[-1] in ".!?" else f"{line}."
    if actions and nouns:
        line = f"Покупатель может {actions[0]}; также доступны {nouns[0][0].lower() + nouns[0][1:]}"
        return line if line[-1] in ".!?" else f"{line}."
    return ""


def _accept_tour_line(
    text: str,
    moment: dict[str, Any],
    covered_lines: list[str],
    language: str,
) -> str:
    spoken = _repair_opening(_expand_from_beat(_unwrap_command(text), {}, language, 130, ""))
    if not spoken:
        return ""
    capabilities = [
        str(item).strip()
        for item in [moment.get("primary"), *(moment.get("also") or [])]
        if str(item or "").strip()
    ]
    if len(capabilities) >= 2 and (_is_thin_caption(spoken) or not _mentions_several(spoken, capabilities)):
        return ""
    if len(capabilities) < 2 and _is_thin_caption(spoken) and re.match(r"^показывает функцию\b", spoken, flags=re.IGNORECASE):
        return ""
    if re.match(r"^(?:этот фрагмент|данный фрагмент|этот интерфейс)\b", spoken, flags=re.IGNORECASE):
        return ""
    if re.match(r"^доступны\s+", spoken, flags=re.IGNORECASE) and len(re.findall(r"[A-Za-zА-Яа-яЁё0-9-]+", spoken)) < 12:
        return ""
    if re.search(r"\bпозволяет\s+(?:переход|просмотр|отображение|возможность|выбор)\b", spoken, flags=re.IGNORECASE):
        return ""
    if _repeats_its_label(spoken, str(moment.get("primary") or "")):
        return ""
    if re.search(
        r"увидеть показан\w*|позволяет(?:\s+\S+){0,4}\s+просматривать",
        spoken,
        flags=re.IGNORECASE,
    ):
        return ""
    if re.search(
        r"взвешенн\w*\s+выбор|осознанн\w*\s+выбор|обоснованн\w*\s+решен|качество\s+продукц|без\s+лишних|способству",
        spoken,
        flags=re.IGNORECASE,
    ):
        return ""
    if _is_restatement(spoken, str(moment.get("primary") or "")) or _circular_claim(spoken):
        return ""
    if _outside_evidence(spoken, moment, covered_lines):
        return ""
    if re.search(
        r"\b(?:позволяя|обеспечивая|открывая|показывая|включая)(?:\s+\S+){0,2}\s*\.$",
        spoken,
        flags=re.IGNORECASE,
    ):
        return ""
    evidence = " ".join([
        str(moment.get("primary") or ""),
        str(moment.get("product") or ""),
        str(moment.get("section") or ""),
        *(moment.get("also") or []),
    ])
    if not _mentions_capability(spoken, evidence, ""):
        return ""
    if _unsupported_action(spoken, moment) or _foreign_leak(spoken, moment, language):
        return ""
    if covered_lines and not _covers_new_capability(spoken, moment, covered_lines):
        return ""
    if not covered_lines and not _covers_new_capability(spoken, moment, covered_lines):
        return ""
    return spoken


def _covers_new_capability(text: str, moment: dict[str, Any], covered_lines: list[str]) -> bool:
    covered = _stems(" ".join(covered_lines))
    primary = str(moment.get("primary") or "")
    needed = (_distinct_stems(primary) or _stems(primary)) - covered
    product_names = [
        str(moment.get("product") or ""),
        *(moment.get("products") or []),
    ]
    product_new = set()
    for name in product_names:
        product_new |= _distinct_stems(name) - covered
    latin = {stem for stem in product_new if re.fullmatch(r"[a-z0-9]+", stem or "")}
    text_stems = _stems(text)
    if needed and text_stems & needed:
        return True
    if (product_new - latin) and text_stems & (product_new - latin):
        return True
    if not needed and product_new and text_stems & product_new:
        return True
    return False


def _beat_continues_unit(unit: dict[str, Any], beat: dict[str, Any]) -> bool:
    """Keep one thought on a short sequence. A new picture 12s later is a new line."""
    if float(beat["start"]) - float(unit["end"]) > 1.25:
        return False
    if float(beat["end"]) - float(unit["start"]) > 12.0:
        return False
    prev = str(unit.get("screen_type") or "").strip().lower()
    nxt = str(beat.get("screen_type") or "").strip().lower()
    if prev and nxt and prev != nxt and (prev, nxt) not in {("catalog", "product"), ("category", "product"), ("listing", "product")}:
        return False
    return True


def _narrative_units(beats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    units: list[dict[str, Any]] = []
    for beat in beats:
        if units and _beat_continues_unit(units[-1], beat):
            units[-1]["beats"].append(beat)
            units[-1]["end"] = float(beat["end"])
            continue
        units.append({
            "start": float(beat["start"]),
            "end": float(beat["end"]),
            "screen_type": str(beat.get("screen_type") or ""),
            "beats": [beat],
        })
    return units


def _clean_capability(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "")).strip().rstrip(".")
    cleaned = re.sub(r"^(?:показывает функцию|показывает)\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^перехода\b", "переход", cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def _latin_label(text: str) -> bool:
    letters = re.findall(r"[A-Za-zА-Яа-яЁё]", text or "")
    if len(letters) < 4:
        return False
    latin = re.findall(r"[A-Za-z]", text or "")
    return len(latin) / len(letters) >= 0.7


def _capability_fits_screen(cap: str, screen: str) -> bool:
    """Drop a VLM fact that belongs to another kind of screen."""
    low = (cap or "").lower()
    kind = (screen or "").strip().lower()
    contactish = bool(re.search(r"сообщен|контакт|форм(?:а|ы|у|е)\b", low))
    themeish = bool(re.search(r"тем\w*\s+оформ", low))
    if kind in {"catalog", "product", "category", "listing"}:
        if contactish or themeish:
            return False
    if kind == "contact" and re.search(r"\b3d\b|корзин|коллекц", low):
        return False
    return True


def _unit_capabilities(beats: list[dict[str, Any]], covered_lines: list[str]) -> list[str]:
    """Demonstrated action of each event first, then other new facts, up to three."""
    covered = _stems(" ".join(covered_lines))
    primary: list[tuple[dict[str, Any], str]] = []
    extra: list[tuple[dict[str, Any], str]] = []
    for beat in beats:
        caps = [_clean_capability(cap) for cap in _narratable_capabilities(beat)]
        screen = str(beat.get("screen_type") or "")
        caps = [cap for cap in caps if cap and _capability_fits_screen(cap, screen)]
        if not caps:
            continue
        primary.append((beat, caps[0]))
        if len(beats) == 1:
            extra.extend((beat, cap) for cap in caps[1:])
        else:
            extra.extend(
                (beat, cap) for cap in caps[1:]
                if _stems(cap) & {_stem_word(word) for word in ("кнопка", "корзина", "cart", "добавить", "купить")}
            )
    picked: list[str] = []
    picked_stems: set[str] = set()

    def take(beat: dict[str, Any], cap: str) -> bool:
        if _latin_label(cap) and any(not _latin_label(item) for item in picked):
            return False
        stems = _distinct_stems(cap) or _stems(cap)
        product_stems = _distinct_stems(str(beat.get("product") or ""))
        new_cap = bool(stems - covered - picked_stems)
        new_product = bool(product_stems - covered - picked_stems)
        if not new_cap and not new_product:
            return False
        if stems and stems <= picked_stems:
            return False
        picked.append(cap)
        picked_stems.update(stems)
        picked_stems.update(product_stems)
        return len(picked) >= 3

    for beat, cap in primary:
        if take(beat, cap):
            return picked
    for beat, cap in extra:
        if take(beat, cap):
            return picked
    return picked


def _unit_moment(beats: list[dict[str, Any]], covered_lines: list[str]) -> dict[str, Any] | None:
    caps = _unit_capabilities(beats, covered_lines)
    if not caps:
        return None
    products: list[str] = []
    for beat in beats:
        product = str(beat.get("product") or "").strip()
        if product and product not in products:
            products.append(product)
    section = _section_fact(str(beats[0].get("change") or ""))
    if re.match(r"^страниц", section, flags=re.IGNORECASE):
        section = ""
    return {
        "primary": caps[0],
        "also": caps[1:],
        "capabilities": caps,
        "product": products[0] if products else "",
        "products": products,
        "section": section,
    }


def _plan_tour(
    beats: list[dict[str, Any]],
    language: str,
    model: str,
) -> list[dict[str, Any]]:
    """One finished thought per sequence of related events. A repeated fact stays silent."""
    spoken_lines: list[str] = []
    planned: list[dict[str, Any]] = []
    for unit in _narrative_units(beats):
        moment = _unit_moment(unit["beats"], spoken_lines)
        if moment is None:
            continue
        accepted = ""
        rejected = ""
        caps = list(moment.get("capabilities") or [])
        for _attempt in range(3):
            prompt = _tour_line_prompt(moment, spoken_lines, language, rejected)
            if _attempt == 2:
                prompt = (
                    "Напиши одно законченное русское предложение (12–22 слова) о том, что этот шаг шаблона даёт покупателю. "
                    "Соедини все факты в одну мысль. Не начинай с «Можно увидеть», «Можно изучить», «Показывает», "
                    "«Этот фрагмент» или «Доступны». Не описывай клик, скролл и открытие страницы.\n"
                    "Факты:\n"
                    + "\n".join(f"- {cap}" for cap in caps)
                    + '\nJSON: {"text":"...","speak":true}\n'
                )
            result = _try_ollama(prompt, model=model, num_predict=220, temperature=0.2)
            if not result or result.get("speak") is False:
                rejected = "the line was skipped"
                continue
            candidate = str(result.get("text") or "")
            accepted = _accept_tour_line(candidate, moment, spoken_lines, language)
            if not accepted:
                accepted = _accept_tour_line(_salvage_caption(candidate, moment), moment, spoken_lines, language)
            if accepted:
                break
            rejected = (
                "One finished sentence that names every listed capability. "
                "Do not write a short caption. "
                + (candidate.strip()[:240] or "empty")
            )
        if not accepted:
            accepted = _compose_unit_line(caps)
        span = float(unit["end"]) - float(unit["start"])
        if accepted and span >= 7.0 and _estimated_sec(accepted, 130) < min(5.5, span * 0.55):
            longer = _try_ollama(
                "Напиши одно более полное русское предложение (14–22 слова) о том, что покупатель получает на этом шаге. "
                "Не начинай с «Этот фрагмент», «Доступны», «Можно увидеть». Не выдумывай экраны.\n"
                f"Короткий черновик: {accepted}\n"
                "Факты:\n"
                + "\n".join(f"- {cap}" for cap in caps)
                + '\nJSON: {"text":"...","speak":true}\n',
                model=model,
                num_predict=220,
                temperature=0.2,
            )
            candidate = str((longer or {}).get("text") or "")
            alt = _accept_tour_line(candidate, moment, spoken_lines, language)
            if alt and _estimated_sec(alt, 130) > _estimated_sec(accepted, 130):
                accepted = alt
        if not accepted:
            continue
        spoken_lines.append(accepted)
        events = []
        for beat in unit["beats"]:
            label = ", ".join(_clean_capability(cap) for cap in _narratable_capabilities(beat)[:2]) or str(beat.get("screen_type") or "")
            events.append(f"{float(beat['start']):.1f}–{float(beat['end']):.1f}s {label}".strip())
        planned.append({
            "anchor_sec": round(float(unit["start"]), 2),
            "text": accepted,
            "role": "body",
            "purpose": "; ".join(caps)[:180],
            "visual_summary": " | ".join(events)[:240],
            "estimated_sec": _estimated_sec(accepted, 130),
        })
    if planned:
        planned[0]["role"] = "hook"
        planned[-1]["role"] = "cta"
    return _place_by_speech(planned)


PAUSE_SEC = 0.4
MAX_LEAD_SEC = 6.0


def _place_by_speech(units: list[dict[str, Any]], wpm: int = 130) -> list[dict[str, Any]]:
    """Speech follows the previous mouth, with a short pause. It may lead the next picture by a few seconds."""
    cursor = 0.0
    placed: list[dict[str, Any]] = []
    for index, unit in enumerate(units):
        anchor = float(unit.get("anchor_sec", unit.get("start_sec", 0)) or 0)
        estimate = float(unit.get("estimated_sec") or 0) or _estimated_sec(str(unit.get("text") or ""), wpm)
        estimate = max(1.1, estimate)
        if index == 0:
            start = max(0.0, anchor)
        else:
            start = max(cursor + PAUSE_SEC, anchor - MAX_LEAD_SEC)
            if start < cursor:
                start = cursor
        placed.append({
            **unit,
            "anchor_sec": round(anchor, 2),
            "start_sec": round(start, 2),
            "end_sec": round(start + estimate, 2),
            "estimated_sec": round(estimate, 2),
        })
        cursor = start + estimate
    return placed


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
    video_context = _with_frame_captions(video_context, language)
    duration = float(video_context.get("duration_sec") or 60)
    rows = _analysis_rows(video_context)
    beats = _speech_beats(video_context)
    llm_prompt = _build_director_prompt(
        video_context, prompt, language, target_wpm, project_context
    )

    if prefer_ollama and beats and _visual_quality(video_context) == "vlm":
        planned = _plan_tour(beats, language, ollama_model)
        if planned:
            return {
                "segments": planned,
                "meta": {
                    "tone": "directed",
                    "language": language,
                    "words_per_min": target_wpm,
                    "provider": "ollama",
                    "model": ollama_model,
                    "scene_count": len(rows),
                    "planner": "tour",
                    "visual_quality": _visual_quality(video_context),
                    "vision_model": video_context.get("vision_model"),
                },
            }

    if prefer_ollama:
        llm_result = _try_ollama(llm_prompt, model=ollama_model)
        if llm_result and isinstance(llm_result.get("segments"), list):
            raw_items = [item for item in llm_result["segments"] if isinstance(item, dict)]
            if _draft_is_caption_log(raw_items):
                retried = _try_ollama(
                    _rewrite_tour_prompt(video_context, language, raw_items),
                    model=ollama_model,
                )
                if retried and isinstance(retried.get("segments"), list):
                    llm_result = retried
                    raw_items = [item for item in llm_result["segments"] if isinstance(item, dict)]
            segments = _finalize_segments(
                [item for item in llm_result["segments"] if isinstance(item, dict)],
                video_context,
                language,
                target_wpm,
            )
            if beats:
                segments = _align_segments_to_beats(
                    segments, beats, language, target_wpm, project_context
                )
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
                        "visual_quality": _visual_quality(video_context),
                        "vision_model": video_context.get("vision_model"),
                    },
                }

    chapter_fallback = (
        _align_segments_to_beats([], beats, language, target_wpm, project_context)
        if beats else
        _fallback_from_chapters(video_context, target_wpm)
    )
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
                "visual_quality": _visual_quality(video_context),
                "vision_model": video_context.get("vision_model"),
            },
        }

    return {
        "segments": _fallback_from_analysis(video_context, language, target_wpm, project_context),
        "meta": {
            "tone": "draft",
            "language": language,
            "words_per_min": target_wpm,
            "provider": "fallback",
            "scene_count": len(rows),
            "planner": "visual_director",
            "duration_sec": duration,
            "visual_quality": _visual_quality(video_context),
            "vision_model": video_context.get("vision_model"),
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
