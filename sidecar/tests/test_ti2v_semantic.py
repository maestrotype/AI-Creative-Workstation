"""Semantic camera scoring from synthetic frames. No GPU."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tests.ti2v_semantic import score_adherence  # noqa: E402


def _still(box: tuple[int, int, int, int], size: tuple[int, int] = (200, 120)) -> Image.Image:
    im = Image.new("RGB", size, (250, 250, 250))
    draw = ImageDraw.Draw(im)
    draw.rectangle(box, fill=(40, 40, 40))
    return im


class SemanticCameraTests(unittest.TestCase):
    def test_push_in_grows_bbox(self):
        frames = [_still((70, 40, 130, 80)), _still((50, 25, 150, 95))]
        out = score_adherence(intent="hero", frames=frames, motion_mae=20)
        self.assertEqual(out["measured"], "push")
        self.assertTrue(out["pass"])

    def test_pull_back_shrinks_bbox(self):
        frames = [_still((40, 20, 160, 100)), _still((80, 45, 120, 75))]
        out = score_adherence(intent="pull", frames=frames, motion_mae=20)
        self.assertEqual(out["measured"], "pull")
        self.assertTrue(out["pass"])

    def test_orbit_shifts_centroid(self):
        frames = [_still((40, 40, 90, 90)), _still((110, 40, 160, 90))]
        out = score_adherence(intent="orbit", frames=frames, motion_mae=18)
        self.assertEqual(out["measured"], "orbit")
        self.assertTrue(out["pass"])

    def test_low_motion_is_freeze(self):
        frames = [_still((70, 40, 130, 80)), _still((71, 40, 131, 80))]
        out = score_adherence(intent="hero", frames=frames, motion_mae=1.2)
        self.assertEqual(out["measured"], "freeze")
        self.assertFalse(out["pass"])


if __name__ == "__main__":
    unittest.main()
