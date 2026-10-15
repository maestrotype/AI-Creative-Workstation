"""Write the ready chapter script out to the length of the picture.

Each beat already has a word budget from the chapter duration. This module
asks for that many words, keeps the ready script as the meaning, and uses the
picture note only for what can be said about that moment.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Optional

WPM = 130
CHAPTER_BREATH_SEC = 0.55
_STOP = {
    "и", "в", "во", "на", "по", "к", "ко", "с", "со", "о", "об", "от", "для",
    "это", "эта", "этот", "эти", "как", "что", "чтобы", "или", "а", "но", "же",
    "уже", "ещё", "еще", "не", "ни", "то", "так", "же", "ли", "бы", "из", "у",
}


def word_count(text: str) -> int:
    return len([word for word in re.split(r"\s+", (text or "").strip()) if word])


def line_gap(text: str, target_words: int, *, authored_words: Optional[int] = None) -> list[str]:
    """Empty when the line will actually fill its beat."""
    spoken = re.sub(r"\s+", " ", (text or "")).strip()
    if not spoken or spoken[-1] not in ".!?":
        return ["фраза не закончена"]
    count = word_count(spoken)
    effective = target_words
    if authored_words is not None and authored_words > 0:
        # Do not force a long pad when the ready meaning is short.
        effective = min(target_words, max(authored_words + 4, int(round(authored_words * 1.55))))
    low = max(6, int(round(effective * 0.72)))
    high = int(round(target_words * 1.18)) + 2
    problems: list[str] = []
    if count < low:
        problems.append(f"коротко: {count} слов, нужно около {effective}")
    if count > high:
        problems.append(f"длинно: {count} слов, нужно около {target_words}")
    return problems


def _clean_line(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().strip("«»\"")


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+", re.sub(r"\s+", " ", (text or "")).strip())
    out: list[str] = []
    for part in parts:
        sentence = part.strip().strip("«»\"")
        if not sentence:
            continue
        if sentence[-1] not in ".!?":
            sentence += "."
        out.append(sentence)
    return out


def _stems(text: str) -> set[str]:
    words = re.findall(r"[A-Za-zА-Яа-яЁё0-9]+", (text or "").lower())
    return {word[:6] for word in words if len(word) > 2 and word not in _STOP}


def _overlap(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    shared = len(a & b)
    return shared / float(min(len(a), len(b)))


def drop_paraphrases(text: str) -> str:
    """Keep the first claim. Drop a later sentence that only restates it."""
    kept: list[str] = []
    for sentence in _sentences(text):
        stems = _stems(sentence)
        if any(_overlap(stems, _stems(prev)) >= 0.55 for prev in kept):
            continue
        kept.append(sentence)
    return " ".join(kept) if kept else _clean_line(text)


def correct_line(text: str, target_words: int, sources: list[str]) -> str:
    """Lengthen a short line with sentences already in the chapter, then stop.

    A second click cannot invent words the chapter does not contain, so this
    is the correction. If the chapter text itself is shorter than the picture,
    the line stays short and is still returned.
    """
    spoken = drop_paraphrases(_clean_line(text))
    if spoken and spoken[-1] not in ".!?":
        spoken += "."
    low = max(6, int(round(target_words * 0.72)))
    have = spoken.lower()
    pool: list[str] = []
    spoken_stems = _stems(spoken)
    for source in sources:
        for sentence in _sentences(source):
            if sentence.lower() in have or sentence in pool:
                continue
            if _overlap(_stems(sentence), spoken_stems) >= 0.55:
                continue
            pool.append(sentence)
    added = 0
    while word_count(spoken) < low and pool and added < 8:
        next_sentence = pool.pop(0)
        spoken = f"{spoken} {next_sentence}".strip()
        spoken_stems = _stems(spoken)
        have = spoken.lower()
        added += 1
    return drop_paraphrases(spoken)


def _lines_from_reply(reply: Optional[dict[str, Any]], count: int) -> Optional[list[str]]:
    if not reply or not isinstance(reply.get("lines"), list):
        return None
    from script_llm import valid_narration_line

    lines = [drop_paraphrases(_clean_line(item)) for item in reply["lines"]]
    if len(lines) != count or any(not line for line in lines):
        return None
    if any(not valid_narration_line(line, "ru") for line in lines):
        return None
    return lines


def _job_hint(job: str) -> str:
    if job == "show":
        return "Задача: назови то, что видно в этом куске кадра. Не пересказывай предыдущую реплику другими словами."
    if job == "close":
        return "Задача: закончи мысль главы. Одна ясная фраза-итог, без «и ещё…» и без висящего продолжения."
    return "Задача: скажи один новый факт из сценария. Одну мысль — один раз."


def _place_hint(place: str, media_kind: str) -> str:
    still = media_kind == "image" or media_kind == "still"
    if place == "open":
        if still:
            return (
                "Это открывающий скрин. Короткое вступление: что за продукт и зачем смотреть дальше. "
                "Не разгоняй весь сценарий здесь.\n"
            )
        return "Это первая глава. Начни спокойно и закончи мысль, чтобы дальше был естественный переход.\n"
    if place == "close":
        if still:
            return (
                "Это закрывающий скрин. Краткое окончание: что зритель получил и куда смотреть дальше. "
                "Без новых фактов из середины ролика.\n"
            )
        return "Это последняя глава. Закрой рассказ законченной фразой, не обрывай на полусмысле.\n"
    return "Между этой и соседними главами будет короткая пауза. Не цепляй конец к следующей главе союзом «и».\n"


def chapter_prompt(
    chapter: dict[str, Any],
    said: list[str],
    problems: Optional[list[str]] = None,
) -> str:
    beats = chapter.get("beats") or []
    rows = []
    for index, beat in enumerate(beats, start=1):
        seen = str(beat.get("seen") or "").strip() or "кадр этой главы"
        brief = str(beat.get("brief") or "").strip() or str(chapter.get("script") or "").strip()
        job = str(beat.get("job") or "say").strip() or "say"
        rows.append(
            f"{index}. {int(beat.get('target_words') or 12)} слов. "
            f"{_job_hint(job)} "
            f"Смысл: {brief} "
            f"В кадре: {seen}"
        )
    history = "\n".join(f"- {line}" for line in said[-8:]) or "(это начало ролика)"
    retry = ""
    if problems:
        retry = "Прошлый вариант не подошёл: " + "; ".join(problems) + ". Напиши заново.\n"
    script = str(chapter.get("script") or "").strip()
    place = str(chapter.get("place") or "mid")
    media_kind = str(chapter.get("media_kind") or chapter.get("mediaKind") or "video")
    return (
        "Пишешь озвучку одной главы демо-ролика на русском.\n"
        "Говори просто и по делу: законченные фразы, без канцелярита и без повтора одной мысли другими словами.\n"
        "Плохо: «Файлы в комплекте… Те же файлы лежат в комплекте…».\n"
        "Хорошо: одна ясная мысль, потом новый факт или то, что видно на экране.\n"
        "Каждая реплика должна звучать цельно, будто после неё можно помолчать — не обрывай на «поэтому…» без итога.\n"
        f"Глава «{chapter.get('title') or 'Глава'}».\n"
        f"{_place_hint(place, media_kind)}"
        "Готовый сценарий — смысл главы. Раскрой его. Не заменяй другими фактами и не пропускай.\n"
        f"{script}\n\n"
        f"Уже сказано раньше (эти мысли и близкие пересказы не повторяй):\n{history}\n\n"
        "Реплики по порядку. Число слов — ориентир длины, не повод набивать воду. "
        "Лучше чуть короче и ясно, чем длинная тавтология.\n"
        + "\n".join(rows)
        + "\n"
        + retry
        + f'Верни JSON {{"lines":[...]}} ровно из {len(beats)} строк. '
        "Каждая строка — только русская озвучка, заканчивается точкой, без китайского и без пояснений переводчика.\n"
    )


def _clip_long(text: str, target_words: int) -> str:
    from script_llm import _fit_spoken

    window = max(4.0, target_words * 60 / WPM)
    return drop_paraphrases(_fit_spoken(text, window, WPM))


def _apply_chapter_breath(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Leave a short silence between chapters so cuts do not sound rushed."""
    if len(segments) < 2:
        return segments
    for index in range(len(segments) - 1):
        current = segments[index]
        nxt = segments[index + 1]
        if str(current.get("purpose") or "") == str(nxt.get("purpose") or ""):
            continue
        end = float(current.get("end_sec") or 0)
        start = float(current.get("start_sec") or 0)
        nxt_start = float(nxt.get("start_sec") or 0)
        room = end - start
        if room < 1.2:
            continue
        target_end = min(end, nxt_start - CHAPTER_BREATH_SEC)
        if target_end >= start + 0.8:
            current["end_sec"] = round(target_end, 2)
    return segments


def fit_chapters(
    chapters: list[dict[str, Any]],
    model: str,
    *,
    ask: Optional[Callable[[str], Optional[dict[str, Any]]]] = None,
) -> list[dict[str, Any]]:
    """One spoken line per beat. Times are the beat times, not a packed pile."""
    attempt_box = {"n": 0}
    if ask is None:
        from script_llm import _try_ollama

        def ask(prompt: str, _model: str = model) -> Optional[dict[str, Any]]:
            return _try_ollama(
                prompt,
                model=_model,
                num_predict=1400,
                temperature=min(0.55, 0.32 + 0.08 * attempt_box["n"]),
            )

    said: list[str] = []
    segments: list[dict[str, Any]] = []
    for chapter in chapters:
        beats = [beat for beat in (chapter.get("beats") or []) if isinstance(beat, dict)]
        if not beats:
            continue
        problems: list[str] = []
        chosen: Optional[list[str]] = None
        for attempt in range(3):
            attempt_box["n"] = attempt
            reply = ask(chapter_prompt(chapter, said, problems if attempt else None))
            lines = _lines_from_reply(reply, len(beats))
            if not lines:
                problems = [f"нужно ровно {len(beats)} законченных реплик"]
                continue
            fitted = [_clip_long(line, int(beat.get("target_words") or 12)) for line, beat in zip(lines, beats)]
            problems = []
            from script_llm import valid_narration_line

            for line, beat in zip(fitted, beats):
                authored = word_count(str(beat.get("brief") or chapter.get("script") or ""))
                problems.extend(line_gap(line, int(beat.get("target_words") or 12), authored_words=authored))
                if not valid_narration_line(line, "ru"):
                    problems.append("ответ не на русском или служебный текст модели")
                if "те же" in line.lower() and "уже" in line.lower():
                    problems.append("повтор одной мысли другими словами")
            chosen = fitted
            if not problems:
                break
        if not chosen:
            raise RuntimeError(
                "CHAPTER_FIT_EMPTY: " + ("; ".join(problems) or f"глава {chapter.get('title')}")
            )
        fixed: list[str] = []
        for line, beat in zip(chosen, beats):
            target = int(beat.get("target_words") or 12)
            authored = word_count(str(beat.get("brief") or chapter.get("script") or ""))
            if line_gap(line, target, authored_words=authored):
                line = correct_line(
                    line,
                    min(target, max(authored + 4, int(round(authored * 1.55)))) if authored else target,
                    [str(beat.get("brief") or ""), str(beat.get("seen") or ""), str(chapter.get("script") or "")],
                )
            high = int(round(target * 1.18)) + 2
            if word_count(line) > high:
                line = _clip_long(line, target)
            line = drop_paraphrases(line)
            if line and line[-1] not in ".!?":
                line += "."
            fixed.append(line)
        place = str(chapter.get("place") or "mid")
        for index, (beat, text) in enumerate(zip(beats, fixed)):
            start = round(float(beat.get("start") or 0), 2)
            end = round(float(beat.get("end") or start), 2)
            target = int(beat.get("target_words") or 12)
            role = "body"
            if place == "open" and index == 0:
                role = "hook"
            elif place == "close" and index == len(beats) - 1:
                role = "cta"
            segments.append({
                "start_sec": start,
                "end_sec": end,
                "anchor_sec": start,
                "text": text,
                "role": role,
                "purpose": str(chapter.get("title") or ""),
                "visual_summary": str(beat.get("seen") or "")[:300],
                "estimated_sec": round(word_count(text) * 60 / WPM, 2),
                "short": bool(line_gap(text, target, authored_words=word_count(str(beat.get("brief") or "")))),
            })
            said.append(text)
    segments = _apply_chapter_breath(segments)
    if segments:
        segments[0]["role"] = "hook"
        segments[-1]["role"] = "cta"
    return segments
