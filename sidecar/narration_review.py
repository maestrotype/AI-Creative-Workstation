"""Second and third pass over a narration script, before any voice is synthesized.

Pass 1 is whoever wrote the script (chapter fit or the story planner).
Pass 2 is deterministic: clean punctuation, drop a dangling last fragment, and
list every rule the line breaks (length for its window, repeats, absence claims).
Lines with problems are rewritten one at a time with those problems named.
Pass 3 is a model acting as an editor over the whole script. It flags lines that
contradict the picture or repeat another line; those lines get one more rewrite.
A rewrite is kept only when it breaks fewer rules than the line it replaces.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Optional

WPM = 130
ROOM_SEC = 0.4

Ask = Callable[[str, float], Optional[dict[str, Any]]]

_STOP = {
    "и", "в", "во", "на", "по", "к", "ко", "с", "со", "о", "об", "от", "для",
    "это", "эта", "этот", "эти", "как", "что", "чтобы", "или", "а", "но", "же",
    "уже", "ещё", "еще", "не", "ни", "то", "так", "ли", "бы", "из", "у",
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are",
}
_DANGLING_END = re.compile(
    r"\b(может|можно|могут|позволяет|позволяют|чтобы|и|а|но|или|который|которая|которые|"
    r"где|когда|с|в|на|для|по|к|can|to|and|or|with|which|that)\s*[.!?…]*$",
    re.IGNORECASE,
)
_ABSENCE = re.compile(
    r"\bне\s+(содержит|имеет|отображает|показывает|предлагает|видно|видна|виден)\b|\bотсутству|"
    r"\b(does not|doesn't) (have|contain|show)\b",
    re.IGNORECASE,
)
_BROKEN_PUNCT = re.compile(r"[,;:]\s*[.!?]|[.!?]\s*[,;:]|\.{2,}|\s[,.;:!?]")
_ADDRESS = re.compile(r"\b(вы видите|мы видим|как вы можете видеть|you can see|we can see)\b", re.IGNORECASE)
# A stage direction, not a sentence a person would say.
_CAPTION = re.compile(
    r"^(?:демонстрир\w*|показыва\w*|показан\w*|отобража\w*|позволяет\s+(?:возможность|просмотр|отображение)|"
    r"этот\s+\S+\s+демонстрир\w*|можно\s+(?:увидеть|изучить))\b",
    re.IGNORECASE,
)


def word_count(text: str) -> int:
    return len([word for word in re.split(r"\s+", (text or "").strip()) if word])


def target_words(start: float, end: float, wpm: int = WPM) -> int:
    room = max(1.0, float(end) - float(start) - ROOM_SEC)
    return max(5, int(round(room * wpm / 60)))


def _sentences(text: str) -> list[str]:
    raw = re.sub(r"\s+", " ", (text or "")).strip()
    return [part.strip() for part in re.split(r"(?<=[.!?…])\s+", raw) if part.strip()]


def _key(text: str) -> str:
    return re.sub(r"[^\w\s]+", "", text.lower(), flags=re.UNICODE).strip()


def _stems(text: str) -> set[str]:
    words = re.findall(r"[A-Za-zА-Яа-яЁё0-9]+", (text or "").lower())
    return {word[:6] for word in words if len(word) > 2 and word not in _STOP}


def _overlap(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / float(min(len(a), len(b)))


def _topic_label(sentence: str) -> bool:
    """A planner heading such as «Главная страница + 3D-каталог обуви», not a spoken sentence."""
    return " + " in sentence and word_count(sentence) <= 14


def _repeats(sentence: str, said: list[str]) -> bool:
    """True when this sentence is a topic heading or restates something already spoken."""
    if _topic_label(sentence):
        return True
    mine = _stems(sentence)
    opening = " ".join(_key(sentence).split()[:4])
    for previous in said:
        if opening and len(opening.split()) == 4 and opening == " ".join(_key(previous).split()[:4]):
            return True
        if len(mine) < 3:
            continue
        earlier = _sentences(previous) or [previous]
        # 0.75, not 0.55: sharing «коллекция» and «3D» is the same product, not the same sentence.
        if any(_overlap(mine, _stems(item)) >= 0.75 and len(_stems(item)) >= 4 for item in earlier):
            return True
    return False


def drop_repeated(text: str, said: list[str]) -> str:
    """Keep only sentences that add a fact. A line that only repeats comes back empty."""
    kept = [sentence for sentence in _sentences(clean_line(text)) if not _repeats(sentence, said)]
    return clean_line(" ".join(kept))


def clean_line(text: str) -> str:
    """Fix punctuation, drop repeated clauses, and drop an unfinished last fragment."""
    line = re.sub(r"\s+", " ", str(text or "")).strip().strip("«»\"")
    if not line:
        return ""
    line = re.sub(r"\s+([,.;:!?…])", r"\1", line)
    line = re.sub(r"[,;:]+\s*([.!?…])", r"\1", line)
    line = re.sub(r"([.!?…])\s*[,;:]+", r"\1", line)
    line = re.sub(r"\.{2,}", ".", line)
    line = re.sub(r"([!?])\1+", r"\1", line)
    kept: list[str] = []
    seen: set[str] = set()
    for sentence in _sentences(line):
        key = _key(sentence)
        if len(key.split()) >= 2:
            if key in seen:
                continue
            seen.add(key)
        kept.append(sentence)
    while len(kept) > 1:
        last = kept[-1]
        if word_count(last) < 3 or _DANGLING_END.search(last):
            kept.pop()
            continue
        break
    line = " ".join(kept).strip()
    if line and line[-1] not in ".!?…":
        line += "."
    return line


def seed_line(segment: dict[str, Any], *, language: str = "ru") -> str:
    """A non-empty spoken line from the brief or the picture note. Never a stage direction."""
    ru = not language.startswith("en")
    for raw in (
        segment.get("brief"),
        segment.get("visual_summary"),
        segment.get("text"),
    ):
        line = clean_line(str(raw or ""))
        if not line:
            continue
        kept = [
            sentence for sentence in _sentences(line)
            if not _CAPTION.match(sentence) and not _topic_label(sentence)
        ]
        line = clean_line(" ".join(kept))
        if word_count(line) >= 6:
            return line
    return "На экране следующий шаг этого демо." if ru else "The next step of this demo is on screen."


def enough_words(text: str, target: int) -> bool:
    return word_count(text) >= max(5, int(round(max(5, target) * 0.75)))


def line_issues(
    text: str,
    target: int,
    said: list[str],
    *,
    language: str = "ru",
) -> list[str]:
    """Every rule the line breaks. Empty means it can be voiced."""
    from script_llm import spoken_stutters, valid_narration_line

    ru = not language.startswith("en")
    spoken = re.sub(r"\s+", " ", (text or "")).strip()
    if not spoken:
        return ["пустая реплика" if ru else "empty line"]
    issues: list[str] = []
    if spoken[-1] not in ".!?…":
        issues.append("фраза не закончена" if ru else "unfinished sentence")
    last = _sentences(spoken)[-1] if _sentences(spoken) else spoken
    if _DANGLING_END.search(last):
        issues.append("последнее предложение оборвано" if ru else "last sentence is cut off")
    if _BROKEN_PUNCT.search(spoken):
        issues.append("сломанная пунктуация" if ru else "broken punctuation")
    if spoken_stutters(spoken):
        issues.append("одна и та же фраза повторена" if ru else "the same clause is repeated")
    if any(_topic_label(sentence) for sentence in _sentences(spoken)):
        issues.append(
            "подпись тем через «+», её нельзя произносить" if ru
            else "a topic label with '+' is not speech"
        )
    if not valid_narration_line(spoken, language):
        issues.append("не тот язык или служебный текст модели" if ru else "wrong language or model chatter")
    if _ABSENCE.search(spoken):
        issues.append(
            "описывает то, чего нет на экране; говори о том, что есть" if ru
            else "describes what is missing; talk about what is there"
        )
    if _ADDRESS.search(spoken):
        issues.append("«вы видите» вместо смысла" if ru else "'you can see' instead of meaning")
    if any(_CAPTION.match(sentence) for sentence in _sentences(spoken)):
        issues.append(
            "это подпись к кадру, а не речь: скажи, что человек делает и что из этого следует" if ru
            else "this is a caption, not speech"
        )
    opening = " ".join(_key(spoken).split()[:4])
    sentences = [_stems(sentence) for sentence in _sentences(spoken)]
    for previous in said:
        if opening and len(opening.split()) == 4 and opening == " ".join(_key(previous).split()[:4]):
            issues.append("начинается так же, как прошлая реплика" if ru else "opens like an earlier line")
            break
        earlier = [_stems(sentence) for sentence in _sentences(previous)]
        if any(_overlap(mine, theirs) >= 0.7 and len(mine) >= 3 for mine in sentences for theirs in earlier):
            issues.append("повторяет мысль прошлой реплики" if ru else "repeats an earlier line")
            break
    count = word_count(spoken)
    # Loose on purpose: the measured speech is fitted again after synthesis.
    low = max(5, int(round(target * 0.75)))
    high = int(round(target * 1.2)) + 2
    if count < low:
        issues.append(
            f"коротко: {count} слов, нужно {low}–{high}" if ru
            else f"too short: {count} words, need {low}-{high}"
        )
    elif count > high:
        issues.append(
            f"длинно: {count} слов, нужно {low}–{high}" if ru
            else f"too long: {count} words, need {low}-{high}"
        )
    return issues


def _score(issues: list[str], text: str, target: int) -> tuple[int, int]:
    # A repeated thought is worse than a short line: the short line can be expanded later.
    repeated = sum(
        1 for issue in issues
        if "повтор" in issue or "повторяет" in issue or "начинается" in issue or "подпись" in issue
        or "repeat" in issue or "opens like" in issue
    )
    return (repeated * 5 + len(issues), abs(word_count(text) - target))


def _rewrite_prompt(
    segment: dict[str, Any],
    text: str,
    issues: list[str],
    said: list[str],
    upcoming: str,
    target: int,
    language: str,
) -> str:
    low = max(5, int(round(target * 0.85)))
    high = int(round(target * 1.1)) + 2
    seen = str(segment.get("visual_summary") or "").strip()[:500]
    brief = str(segment.get("brief") or segment.get("text") or "").strip()[:600]
    title = str(segment.get("purpose") or "").strip()
    history = "\n".join(f"- {line}" for line in said[-6:] if line) or "(это начало ролика)"
    span = f"{float(segment.get('start_sec') or 0):.0f}–{float(segment.get('end_sec') or 0):.0f} с"
    openings = [" ".join(line.split()[:4]) for line in said[-3:] if line]
    if openings:
        avoid = "; ".join(f"«{opening}»" for opening in openings)
        issues = issues + [
            f"не начинай так: {avoid}" if not language.startswith("en") else f"do not open with: {avoid}"
        ]
    if language.startswith("en"):
        return (
            "You write one voiceover line for a product demo video, in English.\n"
            f"Picture {span}, chapter \"{title}\".\n"
            f"On screen: {seen or 'this chapter'}\n"
            f"Meaning to deliver: {brief}\n"
            f"Earlier lines (do not repeat their thoughts):\n{history}\n"
            f"Next line (do not jump ahead): {upcoming or '(end of video)'}\n"
            f"Write {low}-{high} words (about {target}). The voice is not sped up or slowed, so the length is required.\n"
            "Rules: finished sentences; each sentence adds a new fact; talk about what is on screen, "
            "never about what is missing; no comma lists of UI elements; no 'you can see'; no cut-off ending.\n"
            f"Current draft: {text or '(empty)'}\n"
            f"What is wrong: {'; '.join(issues)}\n"
            'JSON: {"text":"..."}'
        )
    return (
        "Пишешь одну реплику закадрового голоса для демо-ролика, на русском.\n"
        f"Кадр {span}, глава «{title}».\n"
        f"Что на экране: {seen or 'кадр этой главы'}\n"
        f"Смысл, который нужно передать: {brief}\n"
        f"Предыдущие реплики (их мысли не повторять):\n{history}\n"
        f"Следующая реплика (не забегай вперёд): {upcoming or '(конец ролика)'}\n"
        f"Нужно {low}–{high} слов (около {target}). Голос не ускоряется и не замедляется, поэтому длина обязательна.\n"
        "Правила: законченные предложения; каждое предложение — новый факт; говори о том, что есть на экране, "
        "а не о том, чего нет; без перечисления элементов интерфейса через запятую; без «вы видите»; "
        "без обрыва в конце; живой разговорный русский без канцелярита.\n"
        "Нельзя начинать с «демонстрирует», «показывает», «позволяет просмотр». "
        "Плохо: «Демонстрирует возможность просмотра коллекции сумок и их вращения в 3D.» "
        "Хорошо: «Сумку можно повернуть и рассмотреть со всех сторон. "
        "Вращение показывает форму, фурнитуру и как она сидит.» "
        "Если вариант короче нужного числа слов, допиши его фактами с экрана, а не оставляй одну подпись.\n"
        f"Текущий вариант: {text or '(пусто)'}\n"
        f"Что с ним не так: {'; '.join(issues)}\n"
        'JSON: {"text":"..."}'
    )


def _critic_prompt(rows: list[tuple[int, dict[str, Any]]], language: str) -> str:
    lines = []
    for index, segment in rows:
        seen = str(segment.get("visual_summary") or "").strip()[:240] or "—"
        lines.append(f"{index}. [экран: {seen}] {segment.get('text') or ''}")
    if language.startswith("en"):
        return (
            "You edit voiceover for a product demo. Check the lines below.\n"
            "Flag only real problems: contradicts the screen note; repeats the thought of another line; "
            "clumsy or ungrammatical English; describes something missing; unfinished thought; a list instead of a sentence.\n"
            'JSON: {"issues":[{"i":number,"problem":"short"}]}. If all lines are fine: {"issues":[]}.\n'
            + "\n".join(lines)
        )
    return (
        "Ты редактор закадрового текста демо-ролика. Проверь реплики ниже.\n"
        "Отмечай только настоящие проблемы: противоречит тому, что на экране; повторяет мысль другой реплики; "
        "неуклюжий или неграмотный русский; описывает то, чего нет; мысль оборвана; перечисление вместо фразы.\n"
        'JSON: {"issues":[{"i":номер,"problem":"коротко"}]}. Если всё хорошо: {"issues":[]}.\n'
        + "\n".join(lines)
    )


STRONGER_EDITORS = ("qwen2.5:32b", "qwen3:32b", "gemma3:27b")


def editor_model(requested: str) -> str:
    """Use a larger installed text model for editing; 14B misses length and repeats more often."""
    from script_llm import _list_ollama_models

    installed = set(_list_ollama_models())
    for name in STRONGER_EDITORS:
        if name in installed:
            return name
    return requested


def _default_ask(model: str) -> Ask:
    from script_llm import _try_ollama

    chosen = editor_model(model)

    def ask(prompt: str, temperature: float) -> Optional[dict[str, Any]]:
        return _try_ollama(prompt, model=chosen, num_predict=900, temperature=temperature)

    return ask


def review_script(
    segments: list[dict[str, Any]],
    *,
    language: str = "ru",
    model: str = "qwen2.5:14b",
    critic: bool = True,
    ask: Optional[Ask] = None,
    wpm: int = WPM,
) -> dict[str, Any]:
    """Return segments that pass the rules, plus a report of what still does not."""
    ask = ask or _default_ask(model)
    rows = [dict(segment) for segment in segments]
    for row in rows:
        row["text"] = clean_line(row.get("text") or "")
    rewritten: set[int] = set()

    def try_rewrite(index: int, issues: list[str], said: list[str], attempts: int) -> None:
        row = rows[index]
        target = target_words(row.get("start_sec") or 0, row.get("end_sec") or 0, wpm)
        upcoming = rows[index + 1]["text"] if index + 1 < len(rows) else ""
        # Start from the line with repeated sentences already removed, so the model
        # is not asked to polish a duplicate it will just paraphrase.
        best_text = drop_repeated(row["text"], said)
        problems = list(issues)
        if best_text != row["text"]:
            problems = [
                "текст снят: он повторял уже сказанное. Напиши новый факт с экрана, которого ещё не было."
                if not language.startswith("en")
                else "the draft was removed because it repeated an earlier line. Write a new fact from the screen."
            ] + [item for item in issues if "повтор" not in item and "repeat" not in item]
        best_score = _score(line_issues(best_text, target, said, language=language), best_text, target) if best_text else (99, 999)
        for attempt in range(attempts):
            reply = ask(
                _rewrite_prompt(row, best_text, problems, said, upcoming, target, language),
                0.3 + 0.1 * attempt,
            )
            candidate = drop_repeated(clean_line(str((reply or {}).get("text") or "")), said)
            if not candidate:
                continue
            found = line_issues(candidate, target, said, language=language)
            score = _score(found, candidate, target)
            if score < best_score:
                best_text, best_score, problems = candidate, score, found
            if not found:
                break
        if best_text != row["text"]:
            row["text"] = best_text
            rewritten.add(index)

    said: list[str] = []
    for index, row in enumerate(rows):
        target = target_words(row.get("start_sec") or 0, row.get("end_sec") or 0, wpm)
        row["text"] = drop_repeated(row["text"], said)
        issues = line_issues(row["text"], target, said, language=language)
        if not row["text"]:
            issues = [
                "текст снят: он повторял уже сказанное. Напиши новый факт с экрана, которого ещё не было."
                if not language.startswith("en")
                else "the draft was removed because it repeated an earlier line. Write a new fact from the screen."
            ]
        if issues:
            try_rewrite(index, issues, said, attempts=2)
            row["text"] = drop_repeated(row["text"], said)
        said.append(rows[index]["text"])

    flagged: dict[int, str] = {}
    if critic and rows:
        for offset in range(0, len(rows), 10):
            chunk = [(i + 1, rows[i]) for i in range(offset, min(len(rows), offset + 10))]
            reply = ask(_critic_prompt(chunk, language), 0.1) or {}
            for item in reply.get("issues") or []:
                if not isinstance(item, dict):
                    continue
                try:
                    number = int(item.get("i"))
                except (TypeError, ValueError):
                    continue
                problem = str(item.get("problem") or "").strip()
                if 1 <= number <= len(rows) and problem:
                    flagged[number - 1] = problem[:200]
        for index, problem in sorted(flagged.items()):
            row = rows[index]
            target = target_words(row.get("start_sec") or 0, row.get("end_sec") or 0, wpm)
            earlier = [r["text"] for r in rows[:index]]
            issues = line_issues(row["text"], target, earlier, language=language) + [problem]
            try_rewrite(index, issues, earlier, attempts=1)
            row["text"] = drop_repeated(row["text"], earlier)

    # A hole on A1 is worse than a short line. Every window must keep spoken words.
    for index, row in enumerate(rows):
        earlier = [r["text"] for r in rows[:index]]
        target = target_words(row.get("start_sec") or 0, row.get("end_sec") or 0, wpm)
        row["text"] = drop_repeated(row["text"], earlier)
        if enough_words(row["text"], target) and not line_issues(row["text"], target, earlier, language=language):
            continue
        if not row["text"]:
            row["text"] = drop_repeated(seed_line(row, language=language), earlier) or seed_line(row, language=language)
        issues = line_issues(row["text"], target, earlier, language=language)
        if not enough_words(row["text"], target):
            issues = [
                f"коротко: {word_count(row['text'])} слов, нужно около {target}"
                if not language.startswith("en")
                else f"too short: {word_count(row['text'])} words, need about {target}"
            ] + issues
        if issues:
            try_rewrite(index, issues, earlier, attempts=3)
            row["text"] = drop_repeated(row["text"], earlier)
        if not row["text"]:
            row["text"] = seed_line(row, language=language)
            rewritten.add(index)

    remaining: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        target = target_words(row.get("start_sec") or 0, row.get("end_sec") or 0, wpm)
        issues = line_issues(row["text"], target, [r["text"] for r in rows[:index]], language=language)
        if not row["text"]:
            issues = ["пустая реплика" if not language.startswith("en") else "empty line"]
        if issues:
            remaining.append({"index": index, "issues": issues})
    return {
        "segments": rows,
        "report": {
            "rewritten": sorted(rewritten),
            "critic_flagged": sorted(flagged),
            "remaining": remaining,
        },
    }
