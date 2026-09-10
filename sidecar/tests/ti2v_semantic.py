"""Score camera-prompt adherence from first / mid / last frames.

Studio stills in this app are not pure white — corners are often ~180–220.
Foreground is darker than the corner background, not darker than 240.
Push-in grows the bbox. Pull-back shrinks it. Orbit shifts the centroid
with a modest scale change.
"""
from __future__ import annotations

from typing import Any

from PIL import Image


def _corner_background(gray: Image.Image) -> int:
    w, h = gray.size
    m = max(8, min(w, h) // 20)
    samples: list[int] = []
    for box in (
        (0, 0, m, m),
        (w - m, 0, w, m),
        (0, h - m, m, h),
        (w - m, h - m, w, h),
    ):
        samples.extend(gray.crop(box).getdata())
    samples.sort()
    return samples[len(samples) // 2]


def product_stats(im: Image.Image, *, white_cut: int | None = None) -> dict[str, float] | None:
    gray = im.convert("L")
    w, h = gray.size
    bg = _corner_background(gray)
    cuts = [bg - 18]
    if white_cut is not None:
        cuts.append(int(white_cut))
    cuts.append(bg - 40)
    bbox = None
    for cut in cuts:
        mask = gray.point(lambda p, c=cut: 255 if p < c else 0)
        box = mask.getbbox()
        if not box:
            continue
        area = (box[2] - box[0]) * (box[3] - box[1])
        if area / float(max(1, w * h)) < 0.92:
            bbox = box
            break
        bbox = box
    if not bbox:
        return None
    x0, y0, x1, y1 = bbox
    area = max(1, (x1 - x0) * (y1 - y0))
    return {
        "cx": ((x0 + x1) / 2.0) / max(1, w),
        "cy": ((y0 + y1) / 2.0) / max(1, h),
        "area": area / float(max(1, w * h)),
        "width": (x1 - x0) / max(1, w),
        "height": (y1 - y0) / max(1, h),
        "bg": float(bg),
    }


def camera_deltas(frames: list[Image.Image]) -> dict[str, float]:
    if len(frames) < 2:
        raise ValueError("need at least two frames")
    first = product_stats(frames[0])
    last = product_stats(frames[-1])
    mid = product_stats(frames[len(frames) // 2])
    if not first or not last:
        raise ValueError("could not find product silhouette")
    scale = last["area"] / max(1e-6, first["area"]) - 1.0
    return {
        "scale_delta": round(scale, 4),
        "shift_x": round(last["cx"] - first["cx"], 4),
        "shift_y": round(last["cy"] - first["cy"], 4),
        "first_area": round(first["area"], 4),
        "last_area": round(last["area"], 4),
        "mid_area": round((mid or first)["area"], 4),
    }


def classify_camera(deltas: dict[str, float]) -> str:
    scale = float(deltas.get("scale_delta") or 0)
    shift = max(abs(float(deltas.get("shift_x") or 0)), abs(float(deltas.get("shift_y") or 0)))
    if scale <= -0.06:
        return "pull"
    if scale >= 0.08:
        return "push"
    if shift >= 0.035:
        return "orbit"
    if abs(scale) < 0.04 and shift < 0.02:
        return "freeze"
    if scale > 0:
        return "push"
    return "orbit"


def score_adherence(*, intent: str, frames: list[Image.Image], motion_mae: float | None = None) -> dict[str, Any]:
    deltas = camera_deltas(frames)
    measured = classify_camera(deltas)
    expected = (intent or "hero").lower()
    if expected in ("hero", "push-in", "push_in", "detail"):
        expected = "push"
    if expected in ("pull-back", "pull_back", "wide"):
        expected = "pull"
    low_motion = motion_mae is not None and motion_mae < 3.0
    if low_motion:
        measured = "freeze"
    ok = measured == expected
    if expected == "orbit" and measured == "push" and abs(float(deltas["shift_x"])) >= 0.02:
        ok = True
        measured = "orbit+push"
    return {
        "intent": intent,
        "expected": expected,
        "measured": measured,
        "pass": ok,
        **deltas,
        "motion_mae": motion_mae,
    }
