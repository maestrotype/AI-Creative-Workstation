"""Turn a user Create prompt into a Wan TI2V camera prompt.

Wan T5/CLIP ignore Cyrillic. A sentence like «создай вращение» is an instruction,
not a camera move. Map intents onto shots that this local model can actually do.

I2V cannot reframe a close still into a wide shot. "From far away" / "further back"
froze the clip (mae ~1.5). Use push-in + orbit language that actually moved frames.
"""
from __future__ import annotations

import re

LOCK = (
    "Preserve the exact product shape, colors, materials and proportions. "
    "Keep the product as the visual focus. No additional products or unrelated objects."
)

_ORBIT = re.compile(
    r"вращ|оборот|поворот|orbit|spin|rotat|круж|круч",
    re.I,
)
_WIDE = re.compile(
    r"издалека|из\s+далек|далеко|wide|far\s|отдален|полный\s+рост|издали",
    re.I,
)
_DETAIL = re.compile(
    r"детал|макро|close[-\s]?up|текстур|материал|шв[ыа]|строчк",
    re.I,
)
_PUSH = re.compile(
    r"прибли|наезд|push[-\s]?in|dolly\s+in|hero",
    re.I,
)


def camera_intent(text: str) -> str:
    raw = text or ""
    if _ORBIT.search(raw):
        return "orbit"
    if _DETAIL.search(raw):
        return "detail"
    if _PUSH.search(raw) or _WIDE.search(raw):
        return "hero"
    return "hero"


def _shot_line(intent: str) -> str:
    if intent == "orbit":
        return (
            "Slowly push the camera toward the product with a clear cinematic orbit. "
            "Visible camera motion around the product. Not a still photo."
        )
    if intent == "detail":
        return (
            "Slow cinematic push-in on material texture of the product. "
            "Visible camera motion. Not a still photo."
        )
    return (
        "Slowly push the camera toward the product with a subtle cinematic orbit. "
        "Visible camera motion. Not a still photo."
    )


def prepare_wan_prompt(user: str, *, translate: bool = True) -> dict:
    raw = (user or "").strip()
    intent = camera_intent(raw)
    shot = _shot_line(intent)
    english = raw
    source = "en"
    if translate:
        from prompt_en import has_cyrillic, to_english

        if has_cyrillic(raw):
            prepared = to_english(raw, allow_ollama=True)
            english = (prepared.english or "").strip()
            source = prepared.source
    return {
        "wan": f"{shot} {LOCK}",
        "intent": intent,
        "english": english,
        "source": source,
        "user": raw,
    }
