"""Narration as a guided story over the whole video.

Three layers, each built once for the whole film:

1. Visual evidence — what is visible in every read frame (visual_timeline).
2. Story map — which product capabilities the video actually demonstrates.
   Topics come from the frames; nothing here knows what a shop or a theme is.
3. Narration — one spoken thought per capability, in Russian, at the first
   showing that can hold a finished sentence. Related pictures may share a line.

A visual beat is not a sentence. A short showing is not dropped: the line waits
for a clearer occurrence, or it shares the previous thought.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

import script_llm as _sl

DARK_LUMA = 80.0
CHROME_SHARE = 0.5
# A finished spoken thought needs about this long on this machine (XTTS).
MIN_THOUGHT_SEC = 3.6
# Absolute floor: shorter than this, do not attempt a caption.
MIN_SPEECH_SEC = 2.8
GAP_SEC = 0.4
END_GRACE_SEC = 0.5
SAME_SHOWING_GAP_SEC = 2.0
SAME_SCREEN_SIMILARITY = 0.45
RETRIES = 2
LABEL_CHUNK = 8

_LANG_NAME = {"ru": "русский", "uk": "украинский", "en": "английский"}
_NON_RUSSIAN_LETTER = re.compile(r"[іїєґІЇЄҐ]")
_IMPERATIVE = re.compile(
    r"\b(?:заполни|выбирай|выбери|открой|открывай|нажми|нажимай|перейди|попробуй|оцени|узнай|"
    r"посмотри|загляни|добавь|добавляй|зайди|листай|покрути|крути|смотри|переключи|"
    r"переключай|напиши|пиши|закажи|купи|поверни)(?:те)?\b",
    re.IGNORECASE,
)
_CAPTION_OPENING = re.compile(
    r"^(?:на экране|страниц\w*|можно увидеть|здесь\b|покупатель может|шаблон позволяет|"
    r"этот блок|вот\b|продукт\b|экран\b)",
    re.IGNORECASE,
)
_SO_RX = re.compile(r"\bс\s+(?=[сзшжщ][бвгджзклмнпрстфхцчшщ])", re.IGNORECASE)
_RANK = {"low": 0, "medium": 1, "high": 2}


def speech_sec(text: str) -> float:
    """XTTS time measured on this machine: ~0.06 s per character plus a pause per sentence."""
    raw = (text or "").strip()
    return round(0.06 * len(raw) + 0.4 * max(1, len(re.findall(r"[.!?]", raw))), 2)


def _dark(state: Dict[str, Any]) -> Optional[bool]:
    luma = state.get("luma")
    if luma is None:
        luma = state.get("thumb_luma")
    return None if luma is None else float(luma) < DARK_LUMA


def _chrome(states: List[Dict[str, Any]]) -> set:
    """Labels that sit on most frames, like a navigation bar, say nothing about the moment."""
    counts: Dict[str, int] = {}
    for state in states:
        for item in {str(x).strip().lower() for x in (state.get("evidence") or []) if str(x).strip()}:
            counts[item] = counts.get(item, 0) + 1
    total = max(1, len(states))
    return {item for item, count in counts.items() if count / total >= CHROME_SHARE}


def visual_map(states: List[Dict[str, Any]], duration: float) -> List[Dict[str, Any]]:
    """Every read frame with the interval it covers and its visible facts."""
    chrome = _chrome(states)
    frames: List[Dict[str, Any]] = []
    for index, state in enumerate(states):
        start = 0.0 if index == 0 else float(state.get("change_at", state.get("time", 0)))
        end = duration if index + 1 == len(states) else float(
            states[index + 1].get("change_at", states[index + 1].get("time", duration))
        )
        facts = [
            str(item).strip() for item in (state.get("evidence") or [])
            if str(item).strip() and str(item).strip().lower() not in chrome
        ]
        popup = str(state.get("popup") or "").replace("\n", ", ").strip()
        if popup.lower() in {"пусто", "empty", "нет"}:
            popup = ""
        measured: List[str] = []
        lang = str(state.get("language") or "")
        if lang in _LANG_NAME:
            measured.append(f"язык интерфейса: {_LANG_NAME[lang]}")
        dark = _dark(state)
        if dark is not None:
            measured.append("оформление тёмное" if dark else "оформление светлое")
        frames.append({
            "time": round(float(state.get("time", start)), 2),
            "start": round(start, 2),
            "end": round(max(start, end), 2),
            "state": str(state.get("state") or "").strip(),
            "facts": facts,
            "popup": popup,
            "measured": measured,
            "seen_text": [str(x) for x in (state.get("seen_text") or [])],
        })
    return frames


def _frame_line(frame: Dict[str, Any]) -> str:
    parts = [f"{frame['time']:.1f}с", "; ".join(frame["measured"]), frame["state"]]
    if frame["facts"]:
        parts.append("надписи: " + "; ".join(frame["facts"][:8]))
    if frame["popup"]:
        parts.append("открытое меню: " + frame["popup"][:80])
    return " | ".join(part for part in parts if part)


def project_name(project_context: str) -> str:
    first = (project_context or "").strip().splitlines()[0] if (project_context or "").strip() else ""
    name = re.split(r"\s+[—–-]\s+", first, maxsplit=1)[0].strip()
    return name if 2 <= len(name) <= 40 else ""


def _label_prompt(
    frames: List[Dict[str, Any]],
    project_context: str,
    first: int = 0,
    last: Optional[int] = None,
    names: Optional[List[str]] = None,
) -> str:
    last = len(frames) - 1 if last is None else last
    lines = []
    if first > 0:
        prev = frames[first - 1]
        hint = f" → тема «{prev['topic']}»" if prev.get("topic") else ""
        lines.append(f"(уже разобран, для связи) {first}. " + _frame_line(prev) + hint)
    for index in range(first, last + 1):
        frame = frames[index]
        prev = frames[index - 1] if index > 0 else None
        changed = [m for m in frame["measured"] if not prev or m not in prev["measured"]]
        line = f"{index + 1}. " + _frame_line(frame)
        if changed and prev:
            line += " | изменилось: " + "; ".join(changed)
        lines.append(line)
    context = (project_context or "").strip()[:900]
    known = ""
    if names:
        known = (
            "Темы, уже названные раньше (если кадр про то же — то же название): "
            + ", ".join(f"«{n}»" for n in names) + "\n"
        )
    return (
        "Кадры демо-ролика продукта по порядку. Для каждого кадра назови возможность "
        "продукта, которую он демонстрирует, а не то, как выглядит скриншот.\n"
        f"О продукте от автора (только для понимания):\n{context or '(нет)'}\n\n"
        + known
        + "\n".join(lines)
        + f"\n\nДля КАЖДОГО кадра с номерами {first + 1}–{last + 1} ответь:\n"
        '- "topic": возможность или часть продукта, 1–3 слова по-русски. Одно и то же '
        "называй одинаково. Если измеренный признак изменился (оформление, язык) — "
        "тема этого кадра есть эта смена, а не страница, на которой она произошла;\n"
        '- "meaning": одно предложение: что продукт здесь умеет. Без слов «экран», '
        "«страница», «запись». Без оценок (удобно, быстро, легко);\n"
        '- "new": что появилось по сравнению с предыдущим кадром, или пусто;\n'
        '- "importance": "high" — новая возможность, "medium" — стоит сказать, если есть '
        'время, "low" — переход, повтор, шапка, просто меню.\n'
        'JSON: {"frames":[{"n":1,"topic":"...","meaning":"...","new":"...","importance":"high"}]}\n'
    )


def _topic_key(name: str) -> str:
    stems = sorted(_sl._distinct_stems(name))
    return " ".join(stems) if stems else re.sub(r"[^a-zа-яё0-9]+", " ", name.lower()).strip()


def _occurrences(frames: List[Dict[str, Any]], indices: List[int]) -> List[Dict[str, float]]:
    runs: List[Dict[str, float]] = []
    for index in sorted(set(indices)):
        frame = frames[index]
        if runs and frame["start"] - runs[-1]["end"] <= SAME_SHOWING_GAP_SEC:
            runs[-1]["end"] = frame["end"]
            runs[-1]["last"] = index
        else:
            runs.append({"start": frame["start"], "end": frame["end"], "first": index, "last": index})
    return runs


def label_frames(frames: List[Dict[str, Any]], model: str, project_context: str) -> None:
    """Attach topic, meaning, new and importance to each frame, by frame number."""
    for first in range(0, len(frames), LABEL_CHUNK):
        last = min(len(frames), first + LABEL_CHUNK) - 1
        names: List[str] = []
        for frame in frames[:first]:
            if frame.get("topic") and frame["topic"] not in names:
                names.append(frame["topic"])
        result = _sl._try_ollama(
            _label_prompt(frames, project_context, first, last, names),
            model=model, num_predict=1400, temperature=0.1,
        )
        _apply_labels(frames, result, first, last)


def _apply_labels(frames: List[Dict[str, Any]], result: Optional[Dict[str, Any]], first: int, last: int) -> None:
    for item in (result or {}).get("frames") or []:
        if not isinstance(item, dict):
            continue
        try:
            index = int(item.get("n")) - 1
        except (TypeError, ValueError):
            continue
        if not first <= index <= last:
            continue
        frames[index]["topic"] = str(item.get("topic") or "").strip()
        frames[index]["meaning"] = str(item.get("meaning") or "").strip()
        frames[index]["new"] = str(item.get("new") or "").strip()
        importance = str(item.get("importance") or "medium").strip().lower()
        frames[index]["importance"] = importance if importance in _RANK else "medium"


def _fact_set(frame: Dict[str, Any]) -> set:
    return {item.strip().lower() for item in frame["facts"] if item.strip()}


def _is_change(frames: List[Dict[str, Any]], index: int) -> bool:
    return index > 0 and any(m not in frames[index - 1]["measured"] for m in frames[index]["measured"])


def _similarity(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def _unify_topics(frames: List[Dict[str, Any]]) -> None:
    """A screen seen again under another name keeps the name it was first given.

    A measured change of look (theme, language) stays its own topic: the line is
    about the change, not the page it happens on.
    """
    facts = [_fact_set(frame) for frame in frames]
    by_kind: Dict[str, str] = {}
    for index, frame in enumerate(frames):
        if not frame.get("topic") or not _is_change(frames, index):
            continue
        kinds = [
            m.split(":")[0].split()[0]
            for m in frame["measured"]
            if m not in frames[index - 1]["measured"]
        ]
        frame["topic"] = next((by_kind[k] for k in kinds if k in by_kind), frame["topic"])
        for kind in kinds:
            by_kind.setdefault(kind, frame["topic"])
    for index, frame in enumerate(frames):
        if not frame.get("topic") or _is_change(frames, index):
            continue
        best, match = 0.0, None
        for j in range(index):
            if not frames[j].get("topic") or _is_change(frames, j):
                continue
            score = _similarity(facts[index], facts[j])
            if score > best:
                best, match = score, j
        if match is not None and best >= SAME_SCREEN_SIMILARITY:
            frame["topic"] = frames[match]["topic"]


def story_map(frames: List[Dict[str, Any]], model: str, project_context: str) -> List[Dict[str, Any]]:
    """Capabilities of the whole film, each with every showing and its strongest description."""
    label_frames(frames, model, project_context)
    _unify_topics(frames)
    clusters: List[Dict[str, Any]] = []
    by_key: Dict[str, Dict[str, Any]] = {}
    for index, frame in enumerate(frames):
        name = str(frame.get("topic") or "")
        if not name:
            continue
        key = _topic_key(name)
        cluster = by_key.get(key)
        if cluster is None:
            cluster = {"names": [], "frames": []}
            by_key[key] = cluster
            clusters.append(cluster)
        cluster["names"].append(name)
        cluster["frames"].append(index)
    topics: List[Dict[str, Any]] = []
    for cluster in clusters:
        ranked = sorted(cluster["frames"], key=lambda i: (-_RANK[frames[i].get("importance", "medium")], i))
        best = frames[ranked[0]]
        importance = best.get("importance", "medium")
        if importance == "low" or not best.get("meaning"):
            continue
        topics.append({
            "topic": max(set(cluster["names"]), key=cluster["names"].count),
            "meaning": best["meaning"],
            "importance": importance,
            "frames": cluster["frames"],
            "occurrences": _occurrences(frames, cluster["frames"]),
        })
    topics.sort(key=lambda topic: topic["occurrences"][0]["start"])
    return topics


def _free_start(units: List[Dict[str, Any]], start: float) -> float:
    for unit in sorted(units, key=lambda u: u["start"]):
        if unit["start"] <= start < unit["limit"] + GAP_SEC:
            start = unit["limit"] + GAP_SEC
    return start


def _extend_end(
    frames: List[Dict[str, Any]],
    last: int,
    own: set,
    told: set,
) -> Tuple[float, List[int]]:
    """Keep the window open while the screen only repeats told or low-importance pictures."""
    end = frames[last]["end"]
    covered = [last]
    for index in range(last + 1, len(frames)):
        key = frames[index].get("topic_key")
        if key in own or key in told or frames[index].get("importance") == "low":
            end = frames[index]["end"]
            if key in own:
                covered.append(index)
            continue
        break
    return end, covered


def plan_units(
    topics: List[Dict[str, Any]],
    frames: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """One unit per capability, at the first showing that can hold a finished thought.

    A later, longer showing is used when the first one is too short. Related
    pictures that follow a placed line may share it instead of going silent.
    """
    for frame in frames:
        frame["topic_key"] = None
    for topic in topics:
        for i in topic["frames"]:
            frames[i]["topic_key"] = id(topic)
    units: List[Dict[str, Any]] = []
    silent: List[Dict[str, Any]] = []
    told: set = set()
    for topic in topics:
        placed = None
        for occ in topic["occurrences"]:
            start = _free_start(units, float(occ["start"]))
            end, covered = _extend_end(frames, int(occ["last"]), {id(topic)}, told)
            end = end + END_GRACE_SEC
            later = [u["start"] for u in units if u["start"] > start]
            if later:
                end = min(end, min(later) - GAP_SEC)
            window = end - start
            if window >= MIN_THOUGHT_SEC or (placed is None and window >= MIN_SPEECH_SEC):
                candidate = {
                    "start": round(start, 2),
                    "limit": round(end, 2),
                    "topics": [{**topic, "meaning": topic["meaning"]}],
                    "frames": [i for i in topic["frames"] if occ["first"] <= i <= occ["last"]] + [
                        i for i in covered if i not in topic["frames"]
                    ],
                    "budget": round(window, 2),
                    "window": window,
                }
                if window >= MIN_THOUGHT_SEC:
                    placed = candidate
                    break
                if placed is None or window > placed["window"]:
                    placed = candidate
        if placed is None:
            silent.append(topic)
            continue
        units.append(placed)
        told.add(id(topic))
    units.sort(key=lambda unit: unit["start"])
    left: List[Dict[str, Any]] = []
    for topic in silent:
        if not _join_previous(units, topic, frames, told):
            left.append({
                "topic": topic["topic"],
                "reason": "ни в одном показе нет окна для законченной мысли",
            })
        else:
            told.add(id(topic))
    for index, unit in enumerate(units):
        if index + 1 < len(units):
            unit["limit"] = round(min(unit["limit"], units[index + 1]["start"] - GAP_SEC), 2)
        unit["budget"] = round(unit["limit"] - unit["start"], 2)
        unit["frames"] = sorted({i for i in unit["frames"] if 0 <= i < len(frames) and frames[i]["start"] < unit["limit"]})
    return units, left


def _join_previous(
    units: List[Dict[str, Any]],
    topic: Dict[str, Any],
    frames: List[Dict[str, Any]],
    told: set,
) -> bool:
    """A showing too short for its own line is told with the thought that runs into it."""
    for occ in topic["occurrences"]:
        hosts = [u for u in units if u["start"] < occ["start"] <= u["limit"] + 1.2]
        if not hosts:
            continue
        host = hosts[-1]
        end, covered = _extend_end(frames, int(occ["last"]), {id(topic)}, told)
        end = end + END_GRACE_SEC
        later = [u["start"] for u in units if u["start"] > host["start"]]
        if later:
            end = min(end, min(later) - GAP_SEC)
        if end - occ["start"] < 1.2:
            continue
        host["topics"].append({
            **topic,
            "meaning": topic["meaning"],
            "from": round(float(occ["start"]), 2),
        })
        host["frames"] = sorted(set(host["frames"] + covered + [
            i for i in topic["frames"] if occ["first"] <= i <= occ["last"]
        ]))
        host["limit"] = round(max(host["limit"], end), 2)
        return True
    return False


def _unit_evidence(unit: Dict[str, Any], frames: List[Dict[str, Any]]) -> List[str]:
    """Only this unit's own frames: no fact from a later unrelated screen."""
    items: List[str] = []
    for i in unit.get("frames") or []:
        if not 0 <= i < len(frames):
            continue
        frame = frames[i]
        items.append(frame["state"])
        if frame.get("meaning"):
            items.append(frame["meaning"])
        if frame.get("new"):
            items.append(frame["new"])
        items.extend(frame["facts"][:8])
        items.extend(frame["measured"])
        if frame["popup"]:
            items.append(frame["popup"])
    seen: List[str] = []
    for item in items:
        if item and item not in seen:
            seen.append(item)
    return seen


def _stems(text: str) -> set:
    return _sl._stems(text) | {
        word[:5] for word in re.findall(r"[a-z]{3,}", (text or "").lower())
    } | set(re.findall(r"\d+", text or ""))


def line_problems(
    text: str,
    unit: Dict[str, Any],
    frames: List[Dict[str, Any]],
    said: List[str],
    name: str,
    claims: Optional[List[Dict[str, Any]]] = None,
    *,
    first: bool,
    qualities: Optional[List[str]] = None,
) -> List[str]:
    """Checks on the spoken thought. Claims are judged, not individual words.

    `qualities` is accepted for compatibility and ignored: an evaluation is a
    claim of type «оценка», not a banned adjective.
    """
    del qualities
    spoken = re.sub(r"\s+", " ", str(text or "")).strip()
    problems: List[str] = []
    if not spoken or spoken[-1] not in ".!?":
        return ["фраза не закончена"]
    if len(spoken.split()) < 7:
        problems.append("это подпись, а не мысль: нужно полное предложение")
    if _NON_RUSSIAN_LETTER.search(spoken):
        problems.append("фраза не на русском")
    allowed_latin = {w.lower() for w in re.findall(r"[A-Za-z]{2,}", " ".join(_unit_evidence(unit, frames)))}
    if first:
        allowed_latin |= {w.lower() for w in re.findall(r"[A-Za-z]{2,}", name)}
    latin = [w for w in re.findall(r"[A-Za-z]{2,}", spoken) if w.lower() != "d"]
    if [w for w in latin if w.lower() not in allowed_latin] or len(latin) > 4:
        problems.append("латиница не с экрана")
    if _IMPERATIVE.search(spoken) or _sl._is_bossy(spoken):
        problems.append("повелительное наклонение")
    if _CAPTION_OPENING.search(spoken):
        problems.append("начало как у подписи к скриншоту")
    if _SO_RX.search(spoken) or _sl._broken_object_case(spoken):
        problems.append("грамматика")
    if any(_sl._same_spoken(spoken, line) for line in said):
        problems.append("повтор уже сказанного")
    meaning = " ".join(t.get("meaning") or t.get("topic") or "" for t in unit["topics"])
    if not (_stems(spoken) & _stems(meaning)):
        problems.append("реплика не про смысл этого момента")
    evidence_text = " ".join(_unit_evidence(unit, frames) + [meaning] + ([name] if first else []))
    evidence_stems = _stems(evidence_text)
    for claim in claims or []:
        if not isinstance(claim, dict):
            continue
        kind = str(claim.get("type") or "").strip().lower()
        body = str(claim.get("claim") or "").strip()
        support = str(claim.get("evidence") or "").strip()
        if kind.startswith("оцен") or kind == "evaluation":
            problems.append(f"оценка, которой нет в кадре: {body[:60]}")
            continue
        if not support:
            problems.append(f"утверждение без указанной опоры: {body[:60]}")
            continue
        if not (_stems(support) & evidence_stems):
            problems.append(f"опора утверждения не из этого кадра: {body[:60]}")
    if claims is not None and not claims:
        problems.append("нет утверждений с опорой")
    if speech_sec(spoken) > float(unit["budget"]) + 0.25:
        problems.append(f"длиннее кадра: {speech_sec(spoken):.1f}с при окне {unit['budget']:.1f}с")
    return problems


def _word_hint(budget: float) -> int:
    chars = max(36.0, (float(budget) - 0.5) / 0.06)
    return max(7, min(22, int(chars / 7.2)))


_EXAMPLE = (
    "Пример тона на другом продукте, не копируй слова и не копируй структуру:\n"
    "Плохо: «Страница ресторана с меню.»\n"
    "Хорошо: «Меню разбито на разделы, и у каждого блюда сразу видны вес и цена.»\n"
    "Плохо: «Форма на сайте.»\n"
    "Хорошо: «Забронировать столик можно прямо на сайте — через короткую форму с датой.»\n"
)

_RULES = (
    "Язык озвучки — только русский, даже если надписи на экране на другом языке. "
    "Пиши как человек, который показывает продукт коллеге: одна-две законченные мысли, "
    "не подпись к скриншоту и не список. Толковать видимое можно "
    "(«каталог разделён на категории, и по ним можно перейти к нужному разделу»). "
    "Приписывать невидимое (скорость, удобство, качество, популярность, оплату) нельзя. "
    "Не начинай с «На экране», «Страница», «Можно увидеть», «Здесь», «Вот», «Этот блок», "
    "«Продукт», «Экран». Без повелительного наклонения. Английские надписи не зачитывай, "
    "кроме названия продукта в первой реплике."
)


def _line_prompt(
    unit: Dict[str, Any],
    frames: List[Dict[str, Any]],
    name: str,
    first: bool,
    last: bool,
    said: List[str],
    rejected: str = "",
    problems: Optional[List[str]] = None,
) -> str:
    hint = _word_hint(unit["budget"])
    topics = "\n".join(
        f"- {t['topic']}"
        + (f" (появляется с {t['from']:.1f} с)" if t.get("from") else "")
        + f": {t['meaning']}"
        for t in unit["topics"]
    )
    if len(unit["topics"]) > 1:
        topics += "\nСкажи обо всём этом одной связной репликой, по ходу ролика."
    visible = "; ".join(_unit_evidence(unit, frames)[:14])
    history = "\n".join(f"- {line}" for line in said) or "(это начало ролика)"
    role = ""
    if first and name:
        role = f"Это первая реплика: назови продукт «{name}».\n"
    elif last:
        role = "Это последняя реплика: заверши рассказ, не повторяя уже сказанное.\n"
    retry = ""
    if rejected or problems:
        retry = f"Прошлый вариант «{rejected}» не подошёл: {'; '.join(problems or [])}. Напиши иначе.\n"
    return (
        "Ты профессиональный диктор демо-ролика продукта и пишешь одну следующую реплику.\n"
        f"{_EXAMPLE}{_RULES}\n\n"
        f"Уже сказано (эти мысли не повторяй):\n{history}\n\n"
        f"Сейчас на экране ({unit['start']:.1f}–{unit['limit']:.1f} с). Смысл момента:\n{topics}\n"
        f"Видимые факты (опора, не текст для зачитывания): {visible}\n"
        f"{role}{retry}"
        f"Длина — законченная мысль примерно из {hint} слов, чтобы уложиться в {unit['budget']:.1f} с. "
        "Не укорачивай до подписи.\n"
        "Верни утверждения реплики. Тип «видно» — прямо на экране; «толкование» — очевидный смысл "
        "видимого; «оценка» — качество, которого в кадре нет (такие не пиши).\n"
        'JSON: {"text":"...","claims":[{"claim":"...","evidence":"...","type":"видно"}]}\n'
    )


def write_script(
    units: List[Dict[str, Any]],
    frames: List[Dict[str, Any]],
    model: str,
    project_context: str,
) -> List[Dict[str, Any]]:
    """One line per unit, in order, with memory of what was already said."""
    name = project_name(project_context)
    said: List[str] = []
    written: List[Dict[str, Any]] = []
    for index, unit in enumerate(units):
        first = not said
        last = index == len(units) - 1
        text, claims, problems = "", [], ["пустой ответ"]
        for attempt in range(RETRIES + 1):
            prompt = _line_prompt(
                unit, frames, name, first, last, said,
                text if attempt else "", problems if attempt else None,
            )
            reply = _sl._try_ollama(prompt, model=model, num_predict=400, temperature=0.45) or {}
            text = re.sub(r"\s+", " ", str(reply.get("text") or "")).strip().strip("«»\"")
            claims = reply.get("claims") if isinstance(reply.get("claims"), list) else []
            problems = line_problems(text, unit, frames, said, name, claims, first=first)
            if not problems:
                break
        entry = {"unit": unit, "text": "" if problems else text, "claims": claims, "problems": problems, "draft": text}
        if not problems:
            said.append(text)
        written.append(entry)
    return written


def place(written: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cursor = 0.0
    placed: List[Dict[str, Any]] = []
    for entry in written:
        if not entry["text"]:
            continue
        unit = entry["unit"]
        start = max(float(unit["start"]), cursor + GAP_SEC if placed else float(unit["start"]))
        duration = speech_sec(entry["text"])
        if start + duration > float(unit["limit"]) + 0.25:
            entry["problems"] = [f"не помещается после предыдущей реплики ({start:.1f}+{duration:.1f}с)"]
            entry["text"] = ""
            continue
        placed.append({
            "anchor_sec": round(float(unit["start"]), 2),
            "start_sec": round(start, 2),
            "end_sec": round(start + duration, 2),
            "text": entry["text"],
            "role": "body",
            "purpose": " + ".join(t["topic"] for t in unit["topics"]),
            "visual_summary": f"{unit['start']:.1f}–{unit['limit']:.1f}s " + "; ".join(
                t["meaning"] for t in unit["topics"]
            ),
            "estimated_sec": duration,
        })
        cursor = start + duration
    if placed:
        placed[0]["role"] = "hook"
        placed[-1]["role"] = "cta"
    return placed


def acceptance_rows(story: Dict[str, Any]) -> List[Dict[str, Any]]:
    """TIME / VISUAL EVIDENCE / PRODUCT MEANING / ALREADY COVERED / NARRATION / WHY."""
    frames = story.get("frames") or []
    covered: List[str] = []
    rows: List[Dict[str, Any]] = []
    by_start = {round(float(e["unit"]["start"]), 2): e for e in story.get("written") or []}
    for unit in story.get("units") or []:
        entry = by_start.get(round(float(unit["start"]), 2), {})
        evidence = "; ".join(_unit_evidence(unit, frames)[:8])
        meaning = "; ".join(t["meaning"] for t in unit["topics"])
        text = entry.get("text") or ""
        why = "новая возможность продукта, ещё не сказанная" if text else "реплика отвергнута: " + "; ".join(
            entry.get("problems") or ["нет текста"]
        )
        rows.append({
            "time": f"{unit['start']:.1f}–{unit['limit']:.1f}",
            "visual_evidence": evidence,
            "product_meaning": meaning,
            "already_covered": "; ".join(covered) or "—",
            "narration": text or "—",
            "why": why,
        })
        if text:
            covered.extend(t["topic"] for t in unit["topics"])
    for item in story.get("silent") or []:
        rows.append({
            "time": "—",
            "visual_evidence": "",
            "product_meaning": item.get("topic", ""),
            "already_covered": "; ".join(covered) or "—",
            "narration": "—",
            "why": item.get("reason", "не сказано"),
        })
    return rows


def plan_story(
    states: List[Dict[str, Any]],
    duration: float,
    model: str,
    project_context: str = "",
) -> Dict[str, Any]:
    frames = visual_map(states, duration)
    topics = story_map(frames, model, project_context)
    units, silent = plan_units(topics, frames)
    written = write_script(units, frames, model, project_context) if units else []
    placed = place(written)
    return {
        "frames": frames,
        "topics": topics,
        "units": units,
        "silent": silent,
        "written": written,
        "placed": placed,
        "acceptance": acceptance_rows({
            "frames": frames, "units": units, "written": written, "silent": silent,
        }),
    }


def plan_from_video(
    video_context: Dict[str, Any],
    model: str,
    project_context: str = "",
) -> List[Dict[str, Any]]:
    from visual_timeline import build_dense_timeline

    states = build_dense_timeline(video_context)
    if len(states) < 2:
        return []
    duration = float(video_context.get("duration_sec") or states[-1]["time"])
    return plan_story(states, duration, model, project_context)["placed"]
