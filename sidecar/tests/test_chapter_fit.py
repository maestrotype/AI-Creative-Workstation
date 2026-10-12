"""Chapter fit writes one line per beat and lengthens a short line from the chapter text."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from chapter_fit import chapter_prompt, fit_chapters, line_gap, word_count  # noqa: E402

FULL = "Корзина показывает имя товара, цену и итог, а дальше открывается оформление заказа."


def chapter() -> dict:
    return {
        "title": "Корзина и оплата",
        "script": "Дальше корзина и оформление. Stripe и LiqPay в тестовом режиме.",
        "beats": [
            {"start": 79.3, "end": 93.0, "target_words": 12, "brief": "Дальше корзина и оформление.", "seen": "окно корзины"},
            {"start": 93.0, "end": 108.0, "target_words": 12, "brief": "Stripe и LiqPay в тестовом режиме.", "seen": "способы оплаты"},
        ],
    }


class ChapterFitTests(unittest.TestCase):
    def test_a_short_line_is_not_enough_for_its_beat(self):
        self.assertTrue(line_gap("Корзина открыта.", 30))
        self.assertEqual(line_gap(FULL, 12), [])

    def test_lines_keep_the_beat_times(self):
        def ask(_prompt: str):
            return {"lines": [FULL, FULL]}

        segments = fit_chapters([chapter()], "qwen", ask=ask)
        self.assertEqual([row["start_sec"] for row in segments], [79.3, 93.0])
        self.assertEqual(segments[0]["role"], "hook")
        self.assertEqual(segments[-1]["role"], "cta")
        self.assertGreater(segments[0]["estimated_sec"], 4)

    def test_a_short_first_answer_is_asked_again(self):
        calls = {"n": 0}

        def ask(prompt: str):
            calls["n"] += 1
            if calls["n"] == 1:
                return {"lines": ["Корзина открыта.", "Оплата на экране."]}
            self.assertIn("коротко", prompt)
            return {"lines": [FULL, FULL]}

        segments = fit_chapters([chapter()], "qwen", ask=ask)
        self.assertEqual(calls["n"], 2)
        self.assertEqual(len(segments), 2)

    def test_prompt_carries_the_ready_script_and_the_word_budget(self):
        prompt = chapter_prompt(chapter(), [])
        self.assertIn("Stripe и LiqPay", prompt)
        self.assertIn("12 слов", prompt)
        self.assertIn("окно корзины", prompt)

    def test_a_short_model_line_is_filled_from_the_chapter_and_kept(self):
        def ask(_prompt: str):
            return {"lines": ["Корзина открыта.", "Оплата на экране."]}

        segments = fit_chapters([chapter()], "qwen", ask=ask)
        self.assertEqual(len(segments), 2)
        self.assertGreaterEqual(word_count(segments[0]["text"]), 9)
        self.assertFalse(segments[0]["short"])

    def test_a_line_that_stays_shorter_than_the_chapter_is_still_returned(self):
        thin = chapter()
        thin["script"] = "Корзина."
        thin["beats"][0]["brief"] = "Корзина."
        thin["beats"][0]["target_words"] = 30
        thin["beats"][1]["brief"] = "Оплата."
        thin["beats"][1]["target_words"] = 30

        def ask(_prompt: str):
            return {"lines": ["Корзина.", "Оплата."]}

        segments = fit_chapters([thin], "qwen", ask=ask)
        self.assertEqual(len(segments), 2)
        self.assertTrue(segments[0]["short"])
        self.assertIn("Корзина", segments[0]["text"])


if __name__ == "__main__":
    unittest.main()
