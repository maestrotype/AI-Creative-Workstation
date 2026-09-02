"""Russian text normalization and stress marking for TTS."""
from __future__ import annotations

import json
import os
import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

VOICE_DIR = os.path.expanduser("~/Documents/Canvas/Voice")
LEXICON_PATH = os.path.join(VOICE_DIR, "lexicon.json")

_CYRILLIC_RE = re.compile(r"[а-яА-ЯёЁ]")
_INTEGER_RE = re.compile(r"\b(\d{1,9})\b")
_RU_VOWELS = "аеёиоуыэюя"
# RUAccent + marker; apostrophe stress; combining acute — XTTS treats these as breaks.
_COMBINING_ACUTE_RE = re.compile(r"([\u0430-\u044F\u0451])\u0301", re.IGNORECASE)
_APOSTROPHE_STRESS_RE = re.compile(r"([\u0430-\u044F\u0451])['\u2019](?=[\s\W]|$)", re.IGNORECASE)

_REPLACE_RE = re.compile(
    r"^[\"«]?([\w\u0400-\u04FF-]+)[\"»]?\s*(?:→|->|:)\s*[\"«]?(.+?)[\"»]?\s*$",
    re.IGNORECASE,
)
_WORD_RE = re.compile(
    r"(?:слово|word)\s+[\"«]?([\w\u0400-\u04FF-]+)[\"»]?",
    re.IGNORECASE,
)
_STRESS_VOWEL_RE = re.compile(
    rf"ударени[ея]\s+на\s+[\"«]?([{_RU_VOWELS}])[\"»]?",
    re.IGNORECASE,
)
_STRESS_VOWEL_EN_RE = re.compile(
    r"stress\s+on\s+[\"«]?([a-z])[\"»]?",
    re.IGNORECASE,
)

_accentizer: Any = None
_lexicon_mtime: float = 0.0
_stress_available: bool = False
_stress_error: Optional[str] = None

_UNIT_PATTERNS: List[Tuple[re.Pattern[str], str]] = [
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*ГБ", re.IGNORECASE), "гигабайт"),
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*МБ", re.IGNORECASE), "мегабайт"),
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*КБ", re.IGNORECASE), "килобайт"),
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*гб", re.IGNORECASE), "гигабайт"),
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*мб", re.IGNORECASE), "мегабайт"),
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*кб", re.IGNORECASE), "килобайт"),
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*%"), "процент"),
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*₽"), "рубль"),
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*руб\.?", re.IGNORECASE), "рубль"),
]


@dataclass
class LexiconEntry:
    spoken: str
    stress: Optional[str] = None
    note: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {"spoken": self.spoken}
        if self.stress:
            out["stress"] = self.stress
        if self.note:
            out["note"] = self.note
        return out


def detect_language(text: str, hint: Optional[str] = None) -> str:
    if hint and hint.lower().startswith("ru"):
        return "ru"
    if hint and hint.lower().startswith("en"):
        return "en"
    return "ru" if _CYRILLIC_RE.search(text or "") else "en"


def _read_lexicon_raw() -> Dict[str, Any]:
    try:
        with open(LEXICON_PATH, encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            return data
    except (OSError, json.JSONDecodeError, TypeError):
        pass
    return {}


def _write_lexicon_raw(data: Dict[str, Any]) -> None:
    os.makedirs(VOICE_DIR, exist_ok=True)
    with open(LEXICON_PATH, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)


def _parse_entry_value(raw: Any) -> Optional[LexiconEntry]:
    if isinstance(raw, str):
        spoken = to_spoken_text(raw.strip())
        if not spoken:
            return None
        return LexiconEntry(spoken=spoken)
    if isinstance(raw, dict):
        spoken = to_spoken_text(str(raw.get("spoken") or "").strip())
        if not spoken:
            return None
        stress = raw.get("stress")
        stress_str = str(stress).strip() if stress else None
        note = raw.get("note")
        note_str = str(note).strip() if note else None
        return LexiconEntry(spoken=spoken, stress=stress_str, note=note_str)
    return None


def load_lexicon_entries() -> Dict[str, LexiconEntry]:
    raw = _read_lexicon_raw()
    out: Dict[str, LexiconEntry] = {}
    for key, value in raw.items():
        entry = _parse_entry_value(value)
        if entry:
            out[str(key).lower().strip()] = entry
    return out


def load_lexicon_stress_dict() -> Dict[str, str]:
    """RUAccent custom_dict: word → stressed form with + markers."""
    stress: Dict[str, str] = {}
    for word, entry in load_lexicon_entries().items():
        if entry.stress:
            stress[word] = entry.stress
    return stress


def list_lexicon_entries() -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for word, entry in sorted(load_lexicon_entries().items()):
        items.append({"word": word, **entry.to_dict()})
    return items


def save_lexicon_entry(
    word: str,
    spoken: str,
    stress: Optional[str] = None,
    note: Optional[str] = None,
) -> LexiconEntry:
    key = (word or "").lower().strip()
    if not key:
        raise ValueError("word is required")
    spoken_clean = to_spoken_text((spoken or "").strip())
    if not spoken_clean:
        raise ValueError("spoken is required")

    stress_clean = stress.strip() if stress else None
    note_clean = note.strip() if note else None
    entry = LexiconEntry(spoken=spoken_clean, stress=stress_clean, note=note_clean)

    data = _read_lexicon_raw()
    data[key] = entry.to_dict()
    _write_lexicon_raw(data)

    global _accentizer, _lexicon_mtime
    _accentizer = None
    _lexicon_mtime = 0.0

    return entry


def delete_lexicon_entry(word: str) -> bool:
    key = (word or "").lower().strip()
    if not key:
        return False
    data = _read_lexicon_raw()
    if key not in data:
        return False
    del data[key]
    _write_lexicon_raw(data)

    global _accentizer, _lexicon_mtime
    _accentizer = None
    _lexicon_mtime = 0.0
    return True


def load_lexicon() -> Dict[str, str]:
    """Legacy flat map word → spoken (for callers expecting simple dict)."""
    return {word: entry.spoken for word, entry in load_lexicon_entries().items()}


def _word_boundary_pattern(word: str) -> re.Pattern[str]:
    escaped = re.escape(word)
    return re.compile(
        rf"(?<![\w\u0400-\u04FF]){escaped}(?![\w\u0400-\u04FF])",
        re.IGNORECASE,
    )


def apply_lexicon_spoken(text: str) -> str:
    if not text:
        return text
    out = text
    entries = load_lexicon_entries()
    for word in sorted(entries.keys(), key=len, reverse=True):
        entry = entries[word]
        out = _word_boundary_pattern(word).sub(entry.spoken, out)
    return out


def _insert_stress_before_vowel(word: str, vowel: str) -> str:
    target = vowel.lower()
    for index, char in enumerate(word):
        if char.lower() == target:
            return f"{word[:index]}+{word[index:]}"
    return word


def parse_pronunciation_fix(
    prompt: str,
    default_word: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    text = (prompt or "").strip()
    if not text:
        return None

    replace_match = _REPLACE_RE.match(text)
    if replace_match:
        word = replace_match.group(1).lower()
        spoken = to_spoken_text(replace_match.group(2).strip())
        return {
            "word": word,
            "spoken": spoken,
            "stress": None,
            "note": text,
            "parsed_as": "replacement",
        }

    word_match = _WORD_RE.search(text)
    word = (word_match.group(1) if word_match else default_word or "").lower().strip()
    vowel_match = _STRESS_VOWEL_RE.search(text) or _STRESS_VOWEL_EN_RE.search(text)
    if word and vowel_match:
        vowel = vowel_match.group(1).lower()
        stress = _insert_stress_before_vowel(word, vowel)
        spoken = to_spoken_text(stress)
        return {
            "word": word,
            "spoken": spoken,
            "stress": stress,
            "note": text,
            "parsed_as": "stress_on_vowel",
            "needs_spoken_hint": spoken.lower() == word.lower(),
        }

    if default_word and text:
        return {
            "word": default_word.lower().strip(),
            "spoken": to_spoken_text(text),
            "stress": None,
            "note": text,
            "parsed_as": "spoken_only",
        }

    return None


def apply_pronunciation_fix(
    prompt: str,
    default_word: Optional[str] = None,
) -> Dict[str, Any]:
    parsed = parse_pronunciation_fix(prompt, default_word)
    if not parsed:
        raise ValueError(
            "Could not parse fix. Use: замок → текст  or  слово «замок» ударение на «а»",
        )

    entry = save_lexicon_entry(
        parsed["word"],
        parsed["spoken"],
        stress=parsed.get("stress"),
        note=parsed.get("note"),
    )
    return {
        "word": parsed["word"],
        "entry": entry.to_dict(),
        "parsed_as": parsed.get("parsed_as"),
        "needs_spoken_hint": bool(parsed.get("needs_spoken_hint")),
    }


def _parse_number(raw: str) -> float:
    return float(raw.replace(",", "."))


def _number_to_words(value: float, unit: Optional[str] = None) -> str:
    try:
        from num2words import num2words
    except ImportError:
        return str(value).replace(".", ",")

    if abs(value - round(value)) < 1e-9:
        words = num2words(int(round(value)), lang="ru")
    else:
        words = num2words(value, lang="ru")

    if not unit:
        return words

    unit_words = unit
    if unit == "процент":
        n = int(round(value)) if abs(value - round(value)) < 1e-9 else value
        if isinstance(n, int):
            if n % 10 == 1 and n % 100 != 11:
                unit_words = "процент"
            elif 2 <= n % 10 <= 4 and not (12 <= n % 100 <= 14):
                unit_words = "процента"
            else:
                unit_words = "процентов"
    elif unit == "рубль":
        n = int(round(value))
        if n % 10 == 1 and n % 100 != 11:
            unit_words = "рубль"
        elif 2 <= n % 10 <= 4 and not (12 <= n % 100 <= 14):
            unit_words = "рубля"
        else:
            unit_words = "рублей"
    elif unit in {"гигабайт", "мегабайт", "килобайт"}:
        n = int(round(value))
        if n % 10 == 1 and n % 100 != 11:
            unit_words = unit
        elif 2 <= n % 10 <= 4 and not (12 <= n % 100 <= 14):
            unit_words = unit[:-1] + "а" if unit.endswith("т") else unit
        else:
            if unit == "гигабайт":
                unit_words = "гигабайт"
            elif unit == "мегабайт":
                unit_words = "мегабайт"
            else:
                unit_words = "килобайт"

    return f"{words} {unit_words}"


def normalize_ru(text: str) -> str:
    """Expand numbers and common units for clearer Russian TTS."""
    if not text:
        return text

    out = text

    for pattern, unit in _UNIT_PATTERNS:
        def repl(match: re.Match[str], u: str = unit) -> str:
            return _number_to_words(_parse_number(match.group(1)), u)

        out = pattern.sub(repl, out)

    def int_repl(match: re.Match[str]) -> str:
        return _number_to_words(float(match.group(1)))

    out = _INTEGER_RE.sub(int_repl, out)
    return out


def _read_lexicon_mtime() -> float:
    try:
        return os.path.getmtime(LEXICON_PATH)
    except OSError:
        return 0.0


def _get_accentizer() -> Tuple[Any, bool, Optional[str]]:
    global _accentizer, _lexicon_mtime, _stress_available, _stress_error

    mtime = _read_lexicon_mtime()
    if _accentizer is not None and mtime == _lexicon_mtime and _stress_available:
        return _accentizer, True, None

    try:
        from ruaccent import RUAccent
    except ImportError:
        _stress_available = False
        _stress_error = "RUACCENT_NOT_INSTALLED"
        return None, False, _stress_error

    try:
        accentizer = RUAccent()
        custom = load_lexicon_stress_dict()
        accentizer.load(
            omograph_model_size="turbo2",
            use_dictionary=True,
            custom_dict=custom,
            device="CPU",
            tiny_mode=False,
        )
        _accentizer = accentizer
        _lexicon_mtime = mtime
        _stress_available = True
        _stress_error = None
        return accentizer, True, None
    except Exception as exc:  # noqa: BLE001
        _accentizer = None
        _stress_available = False
        _stress_error = str(exc)[:200]
        return None, False, _stress_error


def add_stress(text: str) -> Tuple[str, List[str]]:
    """Return text with RUAccent + marks and any warnings."""
    warnings: List[str] = []
    accentizer, ok, err = _get_accentizer()
    if not ok:
        if err:
            warnings.append(err)
        return text, warnings
    try:
        return accentizer.process_all(text), warnings
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"STRESS_FAILED: {exc}")
        return text, warnings


def to_spoken_text(text: str) -> str:
    """Strip stress markup before XTTS — + and similar symbols cause glitches/pauses."""
    if not text:
        return text
    out = text.replace("+", "")
    out = _COMBINING_ACUTE_RE.sub(r"\1", out)
    out = _APOSTROPHE_STRESS_RE.sub(r"\1", out)
    return unicodedata.normalize("NFC", out)


def prepare_text(
    text: str,
    language: str = "auto",
    apply_stress: bool = True,
) -> Dict[str, Any]:
    original = text or ""
    lang = detect_language(original, language)
    warnings: List[str] = []

    if lang != "ru":
        return {
            "original": original,
            "normalized": original,
            "stressed": original,
            "spoken": original,
            "language": lang,
            "warnings": warnings,
            "stress_available": False,
            "lexicon_applied": [],
        }

    normalized = normalize_ru(original)
    lexicon_before = normalized
    normalized = apply_lexicon_spoken(normalized)
    lexicon_applied = []
    if normalized != lexicon_before:
        entries = load_lexicon_entries()
        for word in entries:
            if _word_boundary_pattern(word).search(lexicon_before):
                lexicon_applied.append(word)

    stressed = normalized
    stress_available = False

    if apply_stress:
        stressed, stress_warnings = add_stress(normalized)
        warnings.extend(stress_warnings)
        accentizer, ok, _ = _get_accentizer()
        stress_available = ok and accentizer is not None

    spoken = to_spoken_text(stressed)

    return {
        "original": original,
        "normalized": normalized,
        "stressed": stressed,
        "spoken": spoken,
        "language": lang,
        "warnings": warnings,
        "stress_available": stress_available,
        "lexicon_applied": lexicon_applied,
    }


def stress_status() -> Dict[str, Any]:
    _, ok, err = _get_accentizer()
    return {"available": ok, "error": err}
