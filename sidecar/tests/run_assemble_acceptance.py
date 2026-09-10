#!/usr/bin/env python3
"""Assemble real Wan clips with the same renderer the app uses. Not a fake duration path."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.video import RenderTimelineRequest, TimelineClipModel, render_timeline  # noqa: E402
from shot_assemble import assemble  # noqa: E402

ACC = Path.home() / "Documents/Canvas/Generated/Video/acceptance"
STILL = Path.home() / "Documents/Canvas/PocI2V/sneaker.png"

CLIPS = (
    ("prompt_a_41", "PRODUCT_HERO", False),
    ("prompt_orbit_41", "ANGLE", False),
    ("prompt_detail_41", "DETAIL", False),
    ("prompt_b_41", "CTA", True),
)


def _shot(name: str, purpose: str, identity_warning: bool) -> dict | None:
    mp4 = ACC / f"{name}.mp4"
    meta = ACC / f"{name}.json"
    if not mp4.is_file() or not meta.is_file():
        return None
    data = json.loads(meta.read_text(encoding="utf-8"))
    quality = data.get("quality") or {}
    duration = float(quality.get("duration_sec") or data.get("probe", {}).get("duration_sec") or 0)
    warning = identity_warning or bool(quality.get("identity_warning"))
    return {
        "id": name,
        "shotPurpose": purpose,
        "duration": duration,
        "artifactPath": str(mp4),
        "validationStatus": "warning" if warning else "ok",
        "productIdentityWarning": warning,
        "generationMetadata": quality,
    }


def main() -> int:
    shots = []
    missing = []
    for name, purpose, force_warn in CLIPS:
        row = _shot(name, purpose, force_warn)
        if row is None:
            missing.append(name)
            continue
        shots.append(row)
    if missing:
        print("missing", missing, file=sys.stderr)
        if len(shots) < 2:
            return 2
    plan = assemble(shots, 10)
    print(json.dumps({
        "rationale": plan["rationale"],
        "actualSec": plan["actualSec"],
        "skipped": plan["skipped"],
        "placements": plan["placements"],
    }, indent=2))
    clips = [
        TimelineClipModel(
            kind="video",
            track="v1",
            path=next(s["artifactPath"] for s in shots if s["id"] == item["shotId"]),
            text=None,
            start_sec=item["startSec"],
            duration_sec=item["durationSec"],
            source_in_sec=0.0,
        )
        for item in plan["placements"]
    ]
    actual = float(plan["actualSec"])
    if actual < 8 and STILL.is_file():
        hold = round(min(4.0, 10.0 - actual) * 10) / 10
        clips.append(TimelineClipModel(
            kind="image",
            track="v1",
            path=str(STILL),
            text=None,
            start_sec=actual,
            duration_sec=hold,
            source_in_sec=0.0,
        ))
        print(json.dumps({"still_pad_sec": hold}, indent=2))

    auto = render_timeline(RenderTimelineRequest(clips=clips, width=1920, height=1080, fps=30))
    auto_out = ACC / "assembled_auto.mp4"
    dest = Path(auto["file_path"])
    if dest.is_file():
        auto_out.write_bytes(dest.read_bytes())

    usable = [s for s in shots if not s["productIdentityWarning"]]
    # Manual: same clips, different order, one trim. Same renderer.
    manual_order = ["prompt_a_41", "prompt_detail_41", "prompt_orbit_41"]
    cursor = 0.0
    manual_clips = []
    for name in manual_order:
        shot = next((s for s in usable if s["id"] == name), None)
        if not shot:
            continue
        dur = 1.0 if name == "prompt_detail_41" else float(shot["duration"])
        manual_clips.append(TimelineClipModel(
            kind="video",
            track="v1",
            path=shot["artifactPath"],
            text=None,
            start_sec=cursor,
            duration_sec=dur,
            source_in_sec=0.0,
        ))
        cursor += dur
    manual = render_timeline(RenderTimelineRequest(clips=manual_clips, width=1920, height=1080, fps=30))
    manual_out = ACC / "assembled_manual.mp4"
    dest = Path(manual["file_path"])
    if dest.is_file():
        manual_out.write_bytes(dest.read_bytes())
    print(json.dumps({
        "auto_export": str(auto_out),
        "auto": auto,
        "manual_export": str(manual_out),
        "manual": manual,
        "manual_order": manual_order,
        "manual_trim_detail_sec": 1.0,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
