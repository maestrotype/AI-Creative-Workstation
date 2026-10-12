"""Narration translation keeps one English line per Russian block."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from script_llm import translation_lines  # noqa: E402


class TranslationLinesTests(unittest.TestCase):
    def test_keeps_blanks_and_order(self):
        lines = translation_lines(
            ["Форма отправляет сообщение.", "", "Каталог открыт."],
            {"lines": ["The form sends a message.", "", "The catalog is open."]},
        )
        self.assertEqual(
            lines,
            ["The form sends a message.", "", "The catalog is open."],
        )

    def test_rejects_a_short_reply(self):
        self.assertIsNone(translation_lines(["Раз.", "Два."], {"lines": ["One."]}))


if __name__ == "__main__":
    unittest.main()
