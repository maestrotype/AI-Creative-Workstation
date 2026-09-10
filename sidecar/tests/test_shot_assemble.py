from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from shot_assemble import assemble  # noqa: E402


def shot(sid: str, purpose: str, duration: float, **extra) -> dict:
    row = {
        "id": sid,
        "shotPurpose": purpose,
        "duration": duration,
        "artifactPath": f"/{sid}.mp4",
        "validationStatus": "ok",
        "productIdentityWarning": False,
        "generationMetadata": {},
    }
    row.update(extra)
    return row


class AssembleTests(unittest.TestCase):
    def test_ten_second_ecommerce_order(self):
        plan = assemble([
            shot("a", "PRODUCT_HERO", 3.4),
            shot("b", "DETAIL", 3.4),
            shot("c", "ANGLE", 3.4),
            shot("d", "CTA", 3.4),
        ], 10)
        purposes = [p["purpose"] for p in plan["placements"]]
        self.assertEqual(purposes, ["PRODUCT_HERO", "DETAIL", "ANGLE", "CTA"])
        self.assertLessEqual(plan["actualSec"], 10.01)
        self.assertGreaterEqual(plan["actualSec"], 8.0)
        for item in plan["placements"]:
            self.assertLessEqual(item["durationSec"], 3.4)
            self.assertGreaterEqual(item["durationSec"], 0.5)

    def test_skips_low_motion_and_identity(self):
        plan = assemble([
            shot("bad", "HOOK", 3.4, generationMetadata={"low_motion": True}),
            shot("idw", "DETAIL", 3.4, productIdentityWarning=True),
            shot("ok", "PRODUCT_HERO", 1.7),
        ], 8)
        ids = [p["shotId"] for p in plan["placements"]]
        self.assertEqual(ids, ["ok"])
        reasons = {row["reason"] for row in plan["skipped"]}
        self.assertIn("low_motion", reasons)
        self.assertIn("identity_warning", reasons)

    def test_does_not_invent_clips(self):
        plan = assemble([shot("only", "PRODUCT_HERO", 1.7)], 10)
        self.assertEqual(len(plan["placements"]), 1)
        self.assertAlmostEqual(plan["placements"][0]["durationSec"], 1.7)

    def test_short_clips_are_not_stretched(self):
        plan = assemble([
            shot("a", "PRODUCT_HERO", 1.7),
            shot("b", "DETAIL", 1.7),
            shot("c", "ANGLE", 1.7),
        ], 10)
        self.assertAlmostEqual(plan["actualSec"], 5.1)
        for item in plan["placements"]:
            self.assertLessEqual(item["durationSec"], 1.7)


if __name__ == "__main__":
    unittest.main()
