"""RU → EN for CLIP. CLIP is English-only; Cyrillic is ignored.

Fast path: glossary rewrite (no GPU).
Slow path: Ollama qwen2.5:7b, then unload so FLUX can load.
Never keep the LLM resident next to the image pipeline.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Literal

from ollama_rt import OLLAMA_URL, unload_model

OLLAMA_MODEL = "qwen2.5:7b"
_CYRILLIC = re.compile(r"[а-яА-ЯёЁ]")
_SPACE = re.compile(r"\s+")

Source = Literal["en", "glossary", "ollama"]


@dataclass(frozen=True)
class EnglishPrompt:
    english: str
    source: Source
    leftover_cyrillic: bool = False
    model: str = ""


# Longest phrases first. Replacements keep a readable English sentence.
_PHRASES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(?i)сделай\s+эт(?:от|у|о|и)\s+"), "make this "),
    (re.compile(r"(?i)сделай\s+из\s+эт(?:ого|ой|их)\s+"), "make this into "),
    (re.compile(r"(?i)измени\s+цвет\s+на\s+"), "change the color to "),
    (re.compile(r"(?i)по\s+этом[уы]\s+референс[уа]?\b"), "matching this reference"),
    (re.compile(r"(?i)такой\s+же\s+формы"), "same shape"),
    (re.compile(r"(?i)чистый\s+фон"), "clean background"),
    (re.compile(r"(?i)студийны[йе]\s+свет"), "studio lighting"),
    (re.compile(r"(?i)title\s*card|титр[а-яё]*"), "cinematic title card"),
    (re.compile(r"(?i)интернет-?магазин[а-яё]*"), "ecommerce website"),
    (re.compile(r"(?i)page\s*builder|конструктор[а-яё]*"), "page builder UI"),
    (re.compile(r"(?i)тёмн\w*\s*ui|темн\w*\s*ui"), "dark user interface"),
    (re.compile(r"(?i)3d[- ]?товар[а-яё]*"), "3D product viewer"),
)

# Inflected stems → CLIP-friendly English. Longer stems first where they overlap.
_WORDS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(?i)кроссовок|кроссовк[а-яё]*"), "sneaker"),
    (re.compile(r"(?i)кед(?:а|ы|у|ом|ами)?\b"), "sneaker"),
    (re.compile(r"(?i)бут(?:ылка|ылку|ылки|ылкой|ылок)\b"), "bottle"),
    (re.compile(r"(?i)дозатор[а-яё]*"), "pump dispenser"),
    (re.compile(r"(?i)сумк[а-яё]*"), "bag"),
    (re.compile(r"(?i)рюкзак[а-яё]*"), "backpack"),
    (re.compile(r"(?i)кошк[а-яё]*|\bкот(?:а|у|ом|е)?\b"), "cat"),
    (re.compile(r"(?i)собак[а-яё]*|\bпёс\b|\bпес\b"), "dog"),
    (re.compile(r"(?i)пекар[ьяюе]\b"), "baker"),
    (re.compile(r"(?i)повар[а-яё]*"), "chef"),
    (re.compile(r"(?i)шаблон[а-яё]*"), "website template"),
    (re.compile(r"(?i)админк[а-яё]*"), "admin dashboard"),
    (re.compile(r"(?i)витрин[а-яё]*"), "storefront"),
    (re.compile(r"(?i)каталог[а-яё]*"), "catalog"),
    (re.compile(r"(?i)шёлк[а-яё]*|шелк[а-яё]*"), "silk"),
    (re.compile(r"(?i)кож[а-яё]*"), "leather"),
    (re.compile(r"(?i)серебр[а-яё]*"), "silver"),
    (re.compile(r"(?i)золот[а-яё]*"), "gold"),
    (re.compile(r"(?i)бел(?:ый|ая|ое|ые|ым|ую|ого|ой|ому|ыми)\b"), "white"),
    (re.compile(r"(?i)чёрн(?:ый|ая|ое|ые|ым|ую|ого|ой|ому|ыми)\b|черн(?:ый|ая|ое|ые|ым|ую|ого|ой)\b"), "black"),
    (re.compile(r"(?i)сер(?:ый|ая|ое|ые|ым|ую|ого|ой|ому|ыми)\b"), "grey"),
    (re.compile(r"(?i)син(?:ий|яя|ее|ие|им|юю|его|ей|ему|ими)\b"), "blue"),
    (re.compile(r"(?i)красн(?:ый|ая|ое|ые|ым|ую|ого|ой|ому|ыми)\b"), "red"),
    (re.compile(r"(?i)зелён(?:ый|ая|ое|ые|ым|ую|ого|ой)|зелен(?:ый|ая|ое|ые|ым|ую|ого|ой)\b"), "green"),
    (re.compile(r"(?i)жёлт(?:ый|ая|ое|ые|ым|ую|ого|ой)|желт(?:ый|ая|ое|ые|ым|ую|ого|ой)\b"), "yellow"),
    (re.compile(r"(?i)коричнев(?:ый|ая|ое|ые|ым|ую|ого|ой)\b"), "brown"),
    (re.compile(r"(?i)розов(?:ый|ая|ое|ые|ым|ую|ого|ой)\b"), "pink"),
    (re.compile(r"(?i)фиолетов(?:ый|ая|ое|ые|ым|ую|ого|ой)\b"), "purple"),
    (re.compile(r"(?i)оранжев(?:ый|ая|ое|ые|ым|ую|ого|ой)\b"), "orange"),
    (re.compile(r"(?i)бежев(?:ый|ая|ое|ые|ым|ую|ого|ой)\b"), "beige"),
    (re.compile(r"(?i)\bэтот\b|\bэту\b|\bэто\b|\bэти\b"), "this"),
    (re.compile(r"(?i)\bсделай\b|\bсделайте\b"), "make"),
)


def has_cyrillic(text: str) -> bool:
    return bool(_CYRILLIC.search(text or ""))


def clip_clean(text: str) -> str:
    """CLIP cannot use Cyrillic; drop leftovers so they do not waste the 77-token budget."""
    out = _CYRILLIC.sub(" ", text or "")
    out = _SPACE.sub(" ", out).strip(" ,.;:-")
    return out


def glossary_rewrite(text: str) -> str:
    out = text or ""
    for rx, en in _PHRASES:
        out = rx.sub(en, out)
    for rx, en in _WORDS:
        out = rx.sub(en, out)
    return _SPACE.sub(" ", out).strip(" ,.;:-")


def _clean_ollama(raw: str) -> str:
    text = (raw or "").strip().strip('"').strip("'")
    lowered = text.lower()
    for prefix in ("english:", "translation:", "prompt:", "here is the translation:"):
        if lowered.startswith(prefix):
            text = text[len(prefix):].strip().strip('"')
            break
    return text.split("\n")[0].strip()[:400]


def _ollama_translate(text: str) -> str | None:
    payload = json.dumps(
        {
            "model": OLLAMA_MODEL,
            "stream": False,
            "keep_alive": 0,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Translate the image-generation prompt into concise English. "
                        "Output only the English prompt. No quotes, no preamble. "
                        "Keep brand names and UI terms. Do not invent extra scene details."
                    ),
                },
                {"role": "user", "content": text},
            ],
            "options": {"temperature": 0, "num_predict": 120},
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError, ValueError):
        return None
    content = (body.get("message") or {}).get("content") or ""
    cleaned = _clean_ollama(content)
    return cleaned or None


def to_english(text: str, allow_ollama: bool = True) -> EnglishPrompt:
    raw = (text or "").strip()
    if not raw:
        return EnglishPrompt("", "en")
    if not has_cyrillic(raw):
        return EnglishPrompt(raw, "en")

    gloss = glossary_rewrite(raw)
    if not has_cyrillic(gloss):
        return EnglishPrompt(clip_clean(gloss), "glossary")

    ollama_text: str | None = None
    if allow_ollama:
        ollama_text = _ollama_translate(raw)
        unload_model(OLLAMA_MODEL)

    if ollama_text and not has_cyrillic(ollama_text):
        return EnglishPrompt(clip_clean(ollama_text), "ollama", model=OLLAMA_MODEL)

    if ollama_text:
        mixed = glossary_rewrite(ollama_text)
        cleaned = clip_clean(mixed)
        if cleaned:
            return EnglishPrompt(
                cleaned,
                "ollama",
                leftover_cyrillic=has_cyrillic(mixed),
                model=OLLAMA_MODEL,
            )

    cleaned = clip_clean(gloss)
    return EnglishPrompt(cleaned or "photorealistic photograph of the described subject", "glossary", leftover_cyrillic=True)


def _self_check() -> None:
    sneaker = to_english("Сделай этот кроссовок синим", allow_ollama=False)
    assert "sneaker" in sneaker.english.lower(), sneaker
    assert "blue" in sneaker.english.lower(), sneaker
    bag = to_english("серая шёлковая сумка", allow_ollama=False)
    assert "grey" in bag.english.lower() or "gray" in bag.english.lower(), bag
    assert "silk" in bag.english.lower(), bag
    assert "bag" in bag.english.lower(), bag
    assert to_english("blue sneaker", allow_ollama=False).source == "en"


if __name__ == "__main__":
    _self_check()
    print("prompt_en self-check ok")
