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
    duration = float(video_context.get("duration_sec") or 60)
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
        caption = str(note.get("caption") or "").strip()
        if not caption:
            continue
        try:
            t = float(note.get("time", -1))
        except (TypeError, ValueError):
            continue
        if t < start - 0.4 or t > end + 0.4:
            continue
        dist = abs(t - mid)
        if dist < best_dist:
            best_dist = dist
            best = caption
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
    duration = float(video_context.get("duration_sec") or 60)
    topic = _brief_as_topic(prompt, language)
    aligned: list[dict[str, Any]] = []

    for i, scene in enumerate(scenes):
        start = float(scene.get("start", 0))
        end = float(scene.get("end", duration))
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
    if preferred in names:
        return preferred
    vision = ("llava", "vision", "moondream", "vl:", "qwen2.5vl", "qwen2-vl")
    text_models = [name for name in names if not any(token in name.lower() for token in vision)]
    pool = text_models or names
    pref_root = preferred.split(":")[0]
    for name in pool:
        if name.startswith(pref_root):
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
    return f"""You are a director writing voiceover for a REAL screencast. Watch the beats. Then decide what to say.

User notes: {prompt or '(none)'}
{context_block}
Video duration: {duration:.1f}s
Language: {lang_label}
Speaking rate target: ~{target_wpm} wpm (leave breathing room; never fill silence with filler)

Visual beats:
{chr(10).join(blocks) or '(no beats)'}

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
- One narration segment can COVER several short beats if they are the same idea (e.g. page opens then 3D viewer).
- PAUSE / NO_NARRATION beats must not get spoken lines. Do not invent talk for transitions, logos, or repeated identical UI.
- Speak only about what the Visible / User / UI fields show. Product brief is context, not a checklist to read.
- Write a coherent commercial: hook → what it is → what we see now → why it matters → optional CTA. Not a slideshow of captions.
- start_sec/end_sec must sit inside the beats you are covering. end_sec is the VISUAL window you may occupy, not a command to keep talking.
- Word count per segment MUST stay under the max words of that window ({SPEAK_WINDOW_RATIO:.0%} of duration at {target_wpm} wpm). Shorter clear sentences beat stuffed ones.
- roles: hook | body | outro | cta
- Spoken "text" and "purpose" MUST be only in {lang_label}. Never Chinese, never mixed scripts.
- Cover the whole recording with several segments. Do not stop after the first 5 seconds.
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
    duration = float(video_context.get("duration_sec") or 60)
    rows = _analysis_rows(video_context)
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
            if segments and _coverage_ok(segments, duration):
                meta = llm_result.get("meta") if isinstance(llm_result.get("meta"), dict) else {}
                return {
                    "segments": segments,
                    "meta": {
                        "tone": str(meta.get("tone", "directed")),
                        "language": str(meta.get("language", language)),
                        "words_per_min": int(meta.get("words_per_min", target_wpm)),
                        "provider": "ollama",
                        "model": str(meta.get("model") or ollama_model),
                        "scene_count": len(rows),
                        "planner": "visual_director",
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
