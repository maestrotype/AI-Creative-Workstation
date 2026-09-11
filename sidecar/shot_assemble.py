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


def _push(placements: list, skipped: list, cursor: float, remaining: float, item: dict) -> float:
    if remaining < MIN_CLIP:
        skipped.append({"id": item["shotId"], "reason": "no_budget"})
        return cursor
    duration = _round(min(float(item["duration"]), remaining))
    if duration < MIN_CLIP:
        skipped.append({"id": item["shotId"], "reason": "too_short"})
        return cursor
    placements.append({
        "shotId": item["shotId"],
        "startSec": cursor,
        "durationSec": duration,
        "purpose": item["purpose"],
        "path": item.get("path"),
    })
    return _round(cursor + duration)


def assemble(shots: list[dict], target_sec: float = 10.0, footage: list[dict] | None = None, still_path: str | None = None) -> dict:
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
    shot_paths = {s.get("artifactPath") for s in usable}
    uploads = [
        row for row in (footage or [])
        if row.get("kind") == "video" and float(row.get("duration") or 0) >= MIN_CLIP and row.get("path") not in shot_paths
    ]
    placements = []
    cursor = 0.0
    reserve = min(CTA_RESERVE, float(cta["duration"]), max(0.0, target_sec * 0.2)) if cta else 0.0
    if uploads:
        hook_cap = max(2.0, target_sec * 0.35)
        cursor = _push(placements, skipped, cursor, max(MIN_CLIP, target_sec - reserve - cursor), {
            "shotId": f"upload:{uploads[0]['path']}",
            "duration": min(float(uploads[0]["duration"]), hook_cap),
            "purpose": "HOOK",
            "path": uploads[0]["path"],
        })
    for shot in body:
        cursor = _push(placements, skipped, cursor, max(0.0, target_sec - reserve - cursor), {
            "shotId": shot["id"],
            "duration": float(shot["duration"]),
            "purpose": shot["shotPurpose"],
            "path": shot["artifactPath"],
        })
    for extra in uploads[1:]:
        cursor = _push(placements, skipped, cursor, max(0.0, target_sec - reserve - cursor), {
            "shotId": f"upload:{extra['path']}",
            "duration": float(extra["duration"]),
            "purpose": "LIFESTYLE",
            "path": extra["path"],
        })
    if cta:
        cursor = _push(placements, skipped, cursor, max(MIN_CLIP, target_sec - cursor), {
            "shotId": cta["id"],
            "duration": float(cta["duration"]),
            "purpose": "CTA",
            "path": cta["artifactPath"],
        })
    if not placements and still_path:
        cursor = _push(placements, skipped, 0.0, target_sec, {
            "shotId": "still",
            "duration": min(4.0, target_sec),
            "purpose": "PRODUCT_HERO",
            "path": still_path,
        })
    actual = _round(cursor)
    need = _round(max(0.0, target_sec - actual))
    return {
        "actualSec": actual,
        "placements": placements,
        "skipped": skipped,
        "rationale": " → ".join(p["purpose"] for p in placements),
        "needMoreMaterial": need > 0.8,
        "needMoreSec": need,
    }
