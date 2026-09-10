"""Deterministic product-shot assembly. Mirrors renderer autoAssemble.ts."""
from __future__ import annotations

MIN_CLIP = 0.5
CTA_RESERVE = 1.5
PURPOSE_ORDER = (
    "HOOK",
    "PRODUCT_HERO",
    "DETAIL",
    "FEATURE",
    "ANGLE",
    "LIFESTYLE",
    "TRANSITION",
    "CTA",
)


def _round(n: float) -> float:
    return round(n * 10) / 10


def assemble(shots: list[dict], target_sec: float = 10.0) -> dict:
    skipped = []
    usable = []
    for shot in shots:
        if shot.get("validationStatus") == "failed":
            skipped.append({"id": shot["id"], "reason": "failed_validation"})
            continue
        if shot.get("generationMetadata", {}).get("low_motion"):
            skipped.append({"id": shot["id"], "reason": "low_motion"})
            continue
        if shot.get("productIdentityWarning"):
            skipped.append({"id": shot["id"], "reason": "identity_warning"})
            continue
        if not shot.get("artifactPath") or float(shot.get("duration") or 0) < MIN_CLIP:
            skipped.append({"id": shot["id"], "reason": "invalid"})
            continue
        usable.append(shot)
    seen = set()
    unique = []
    ordered = sorted(usable, key=lambda s: PURPOSE_ORDER.index(s["shotPurpose"]) if s["shotPurpose"] in PURPOSE_ORDER else 50)
    for shot in ordered:
        purpose = shot["shotPurpose"]
        if purpose in seen:
            continue
        seen.add(purpose)
        unique.append(shot)
    cta = next((s for s in unique if s["shotPurpose"] == "CTA"), None)
    body = [s for s in unique if s["shotPurpose"] != "CTA"]
    placements = []
    cursor = 0.0
    reserve = min(CTA_RESERVE, float(cta["duration"]), max(0.0, target_sec * 0.2)) if cta else 0.0
    budget = max(MIN_CLIP, target_sec - reserve)
    for shot in body:
        remaining = budget - cursor
        if remaining < MIN_CLIP:
            break
        duration = min(float(shot["duration"]), remaining)
        if duration < MIN_CLIP:
            break
        duration = _round(duration)
        placements.append({
            "shotId": shot["id"],
            "startSec": cursor,
            "durationSec": duration,
            "purpose": shot["shotPurpose"],
        })
        cursor += duration
    if cta:
        remaining = target_sec - cursor
        duration = min(float(cta["duration"]), max(MIN_CLIP, remaining))
        if duration >= MIN_CLIP:
            duration = _round(duration)
            placements.append({
                "shotId": cta["id"],
                "startSec": cursor,
                "durationSec": duration,
                "purpose": "CTA",
            })
            cursor += duration
    return {
        "actualSec": _round(cursor),
        "placements": placements,
        "skipped": skipped,
        "rationale": " → ".join(p["purpose"] for p in placements),
    }
