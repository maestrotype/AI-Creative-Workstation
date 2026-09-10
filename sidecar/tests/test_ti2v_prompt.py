"""Wan camera prompt mapping. No GPU."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.ti2v_prompt import camera_intent, prepare_wan_prompt  # noqa: E402


class Ti2vPromptTests(unittest.TestCase):
    def test_russian_orbit_from_afar_stays_orbit_on_current_frame(self):
        self.assertEqual(camera_intent("Создай вращение товара из далека"), "orbit")

    def test_english_spin(self):
        self.assertEqual(camera_intent("rotate the product"), "orbit")

    def test_prepare_does_not_ask_for_pullback(self):
        out = prepare_wan_prompt("Создай вращение товара из далека", translate=False)
        self.assertEqual(out["intent"], "orbit")
        self.assertNotIn("Создай", out["wan"])
        self.assertNotIn("further back", out["wan"].lower())
        self.assertNotIn("slow and stable", out["wan"].lower())
        self.assertIn("orbit", out["wan"].lower())
        self.assertIn("push", out["wan"].lower())

    def test_hero_push_in(self):
        out = prepare_wan_prompt("slow push-in on the sneaker", translate=False)
        self.assertEqual(out["intent"], "hero")
        self.assertIn("push", out["wan"].lower())


if __name__ == "__main__":
    unittest.main()
