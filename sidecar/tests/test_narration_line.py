"""Reject model chatter that is not spoken narration."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from script_llm import valid_narration_line  # noqa: E402

GLITCH = (
    "现有句子已经是中文，按照要求需要保持原样不变并提供俄文翻译。"
    "以下是翻译后的俄文版本: {"
)
GOOD = (
    "В комплекте исходники Angular и NestJS, демо-фото и два GLB, "
    "сид каталога, Docker Compose и хаб документации."
)


class NarrationLineTests(unittest.TestCase):
    def test_rejects_chinese_translator_chatter(self):
        self.assertFalse(valid_narration_line(GLITCH, "ru"))

    def test_accepts_russian_chapter_copy(self):
        self.assertTrue(valid_narration_line(GOOD, "ru"))


if __name__ == "__main__":
    unittest.main()
