"""Russian text normalization and stress marking for TTS."""
from __future__ import annotations

import json
import os
import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

VOICE_DIR = os.path.expanduser("~/Documents/Canvas/Voice")
LEXICON_PATH = os.path.join(VOICE_DIR, "lexicon.json")

_CYRILLIC_RE = re.compile(r"[а-яА-ЯёЁ]")
_INTEGER_RE = re.compile(r"\b(\d{1,9})\b")
# RUAccent + marker; apostrophe stress; combining acute — XTTS treats these as breaks.
_COMBINING_ACUTE_RE = re.compile(r"([\u0430-\u044F\u0451])\u0301", re.IGNORECASE)
_APOSTROPHE_STRESS_RE = re.compile(r"([\u0430-\u044F\u0451])['\u2019](?=[\s\W]|$)", re.IGNORECASE)

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


def detect_language(text: str, hint: Optional[str] = None) -> str:
    if hint and hint.lower().startswith("ru"):
        return "ru"
    if hint and hint.lower().startswith("en"):
        return "en"
    return "ru" if _CYRILLIC_RE.search(text or "") else "en"


def load_lexicon() -> Dict[str, str]:
    try:
        with open(LEXICON_PATH, encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            return {str(k).lower(): str(v) for k, v in data.items()}
    except (OSError, json.JSONDecodeError, TypeError):
        pass
    return {}


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
    except ImportError as exc:
        _stress_available = False
        _stress_error = "RUACCENT_NOT_INSTALLED"
        return None, False, _stress_error

    try:
        accentizer = RUAccent()
        custom = load_lexicon()
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
        }

    normalized = normalize_ru(original)
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
    }


def stress_status() -> Dict[str, Any]:
    _, ok, err = _get_accentizer()
    return {"available": ok, "error": err}
