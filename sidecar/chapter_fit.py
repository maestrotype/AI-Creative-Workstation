"""Write the ready chapter script out to the length of the picture.

Each beat already has a word budget from the chapter duration. This module
asks for that many words, keeps the ready script as the meaning, and uses the
picture note only for what can be said about that moment.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Optional

WPM = 130


def word_count(text: str) -> int:
    return len([word for word in re.split(r"\s+", (text or "").strip()) if word])


def line_gap(text: str, target_words: int) -> list[str]:
    """Empty when the line will actually fill its beat."""
    spoken = re.sub(r"\s+", " ", (text or "")).strip()
    if not spoken or spoken[-1] not in ".!?":
        return ["фраза не закончена"]
    count = word_count(spoken)
    low = max(6, int(round(target_words * 0.75)))
    high = int(round(target_words * 1.18)) + 2
    problems: list[str] = []
    if count < low:
        problems.append(f"коротко: {count} слов, нужно около {target_words}")
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


def correct_line(text: str, target_words: int, sources: list[str]) -> str:
    """Lengthen a short line with sentences already in the chapter, then stop.

    A second click cannot invent words the chapter does not contain, so this
    is the correction. If the chapter text itself is shorter than the picture,
    the line stays short and is still returned.
    """
    spoken = _clean_line(text)
    if spoken and spoken[-1] not in ".!?":
        spoken += "."
    low = max(6, int(round(target_words * 0.75)))
    have = spoken.lower()
    pool: list[str] = []
    for source in sources:
        for sentence in _sentences(source):
            if sentence.lower() in have or sentence in pool:
                continue
            pool.append(sentence)
    added = 0
    while word_count(spoken) < low and pool and added < 8:
        spoken = f"{spoken} {pool.pop(0)}".strip()
        have = spoken.lower()
        added += 1
    return spoken


def _lines_from_reply(reply: Optional[dict[str, Any]], count: int) -> Optional[list[str]]:
    if not reply or not isinstance(reply.get("lines"), list):
        return None
    lines = [_clean_line(item) for item in reply["lines"]]
    if len(lines) != count or any(not line for line in lines):
        return None
    return lines


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
        rows.append(
            f"{index}. {int(beat.get('target_words') or 12)} слов. "
            f"Смысл этой реплики: {brief} "
            f"В кадре сейчас: {seen}"
        )
    history = "\n".join(f"- {line}" for line in said[-6:]) or "(это начало ролика)"
    retry = ""
    if problems:
        retry = "Прошлый вариант не подошёл: " + "; ".join(problems) + ". Напиши заново.\n"
    script = str(chapter.get("script") or "").strip()
    return (
        "Пишешь озвучку одной главы демо-ролика на русском. "
        "Говори как человек, который ведёт покупателя по продукту: законченные фразы, не подпись и не список.\n"
        f"Глава «{chapter.get('title') or 'Глава'}».\n"
        "Готовый сценарий — смысл главы. Раскрой его. Не заменяй другими фактами и не пропускай.\n"
        f"{script}\n\n"
        f"Уже сказано раньше (эти мысли не повторяй):\n{history}\n\n"
        "Реплики по порядку. Число слов — это длина речи, чтобы она заполняла кадр. "
        "Если один и тот же смысл стоит на нескольких репликах, развивай его по тому, что в кадре, "
        "а не повторяй ту же фразу.\n"
        + "\n".join(rows)
        + "\n"
        + retry
        + f'Верни JSON {{"lines":[...]}} ровно из {len(beats)} строк. '
        "Каждая строка заканчивается точкой и держит заданное число слов.\n"
    )


def _clip_long(text: str, target_words: int) -> str:
    from script_llm import _fit_spoken

    window = max(4.0, target_words * 60 / WPM)
    return _fit_spoken(text, window, WPM)


def fit_chapters(
    chapters: list[dict[str, Any]],
    model: str,
    *,
    ask: Optional[Callable[[str], Optional[dict[str, Any]]]] = None,
) -> list[dict[str, Any]]:
    """One spoken line per beat. Times are the beat times, not a packed pile."""
    if ask is None:
        from script_llm import _try_ollama

        def ask(prompt: str, _model: str = model) -> Optional[dict[str, Any]]:
            return _try_ollama(prompt, model=_model, num_predict=1400, temperature=0.35)

    said: list[str] = []
    segments: list[dict[str, Any]] = []
    for chapter in chapters:
        beats = [beat for beat in (chapter.get("beats") or []) if isinstance(beat, dict)]
        if not beats:
            continue
        problems: list[str] = []
        chosen: Optional[list[str]] = None
        for attempt in range(3):
            reply = ask(chapter_prompt(chapter, said, problems if attempt else None))
            lines = _lines_from_reply(reply, len(beats))
            if not lines:
                problems = [f"нужно ровно {len(beats)} законченных реплик"]
                continue
            fitted = [_clip_long(line, int(beat.get("target_words") or 12)) for line, beat in zip(lines, beats)]
            problems = []
            for line, beat in zip(fitted, beats):
                problems.extend(line_gap(line, int(beat.get("target_words") or 12)))
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
            if line_gap(line, target):
                line = correct_line(
                    line,
                    target,
                    [str(beat.get("brief") or ""), str(chapter.get("script") or "")],
                )
            high = int(round(target * 1.18)) + 2
            if word_count(line) > high:
                line = _clip_long(line, target)
            if line and line[-1] not in ".!?":
                line += "."
            fixed.append(line)
        for beat, text in zip(beats, fixed):
            start = round(float(beat.get("start") or 0), 2)
            end = round(float(beat.get("end") or start), 2)
            target = int(beat.get("target_words") or 12)
            segments.append({
                "start_sec": start,
                "end_sec": end,
                "anchor_sec": start,
                "text": text,
                "role": "body",
                "purpose": str(chapter.get("title") or ""),
                "visual_summary": str(beat.get("seen") or "")[:300],
                "estimated_sec": round(word_count(text) * 60 / WPM, 2),
                "short": bool(line_gap(text, target)),
            })
            said.append(text)
    if segments:
        segments[0]["role"] = "hook"
        segments[-1]["role"] = "cta"
    return segments
