"""Deterministic product-shot assembly. Mirrors renderer autoAssemble.ts."""
from __future__ import annotations

MIN_CLIP = 0.5
CTA_RESERVE = 1.5
PURPOSE_ORDER = (
    "HOOK",
    "PRODUCT_HERO",
    "DETAIL",
    "ANGLE",
    "FEATURE",
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


def _norm_path(path: str | None) -> str:
    return (path or "").replace("\\", "/").lower().removeprefix("file://")


def _same_product(source: str | None, still: str | None) -> bool:
    left = _norm_path(source)
    right = _norm_path(still)
    return bool(left) and left == right


def assemble(shots: list[dict], target_sec: float = 10.0, footage: list[dict] | None = None, still_path: str | None = None, project_id: str | None = None) -> dict:
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
        if project_id and shot.get("projectId") and shot.get("projectId") != project_id:
            skipped.append({"id": shot["id"], "reason": "other_film"})
            continue
        if still_path:
            if not shot.get("sourceAsset"):
                skipped.append({"id": shot["id"], "reason": "unscoped"})
                continue
            if not _same_product(shot.get("sourceAsset"), still_path):
                skipped.append({"id": shot["id"], "reason": "other_product"})
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
    uploads = []
    for row in (footage or []):
        if row.get("kind") != "video" or float(row.get("duration") or 0) < MIN_CLIP:
            continue
        if row.get("path") in shot_paths:
            continue
        # A product film only keeps uploads that were checked against the still.
        if still_path and row.get("productMatch") != "same":
            skipped.append({"id": f"upload:{row.get('path')}", "reason": "unrelated_footage"})
            continue
        if row.get("productMatch") == "other":
            skipped.append({"id": f"upload:{row.get('path')}", "reason": "unrelated_footage"})
            continue
        uploads.append(row)
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
