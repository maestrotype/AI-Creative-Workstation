"""Second and third pass over narration: rules, rewrite, editor."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from narration_review import clean_line, line_issues, review_script, target_words  # noqa: E402
from script_llm import _fit_spoken  # noqa: E402

LONG_GOOD = (
    "Каталог открывается тремя разделами: обувь, одежда и сумки. "
    "В каждом разделе карточки показывают фото, цену и кнопку покупки. "
    "Фильтр слева сужает выбор по размеру и цвету."
)


class CleanLineTests(unittest.TestCase):
    def test_fixes_broken_punctuation_and_drops_dangling_fragment(self):
        raw = (
            "Главная страница предлагает интерактивный каталог товаров.,. "
            "Экран показывает категории и баннер с сумкой. Пользователь может."
        )
        self.assertEqual(
            clean_line(raw),
            "Главная страница предлагает интерактивный каталог товаров. Экран показывает категории и баннер с сумкой.",
        )

    def test_drops_repeated_clause(self):
        self.assertEqual(
            clean_line("новые товары. новые товары. На странице магазина новые модели кроссовок."),
            "новые товары. На странице магазина новые модели кроссовок.",
        )


class SharedOpeningTests(unittest.TestCase):
    def test_a_topic_heading_is_not_spoken_on_every_line(self):
        heading = "Главная страница + 3D-каталог обуви."
        segments = [
            {
                "start_sec": 0, "end_sec": 7,
                "text": heading + " На главной новые модели и кнопка перехода в каталог обуви.",
                "purpose": "Главная страница + 3D-каталог обуви",
            },
            {
                "start_sec": 7, "end_sec": 17,
                "text": heading + " Просмотрите новую коллекцию на главной странице и откройте модель кроссовка.",
                "purpose": "Главная страница + 3D-каталог обуви",
            },
        ]
        reviewed = review_script(segments, ask=lambda _prompt, _temperature: None, critic=False)
        texts = [row["text"] for row in reviewed["segments"]]
        self.assertNotIn("+", texts[0])
        self.assertNotIn("+", texts[1])
        self.assertIn("новые модели", texts[0])
        self.assertIn("Просмотрите", texts[1])


class RepeatedThoughtTests(unittest.TestCase):
    def test_a_paraphrase_is_replaced_with_a_new_fact(self):
        heading = "Главная страница + 3D-моделирование. "
        first = (
            heading
            + "Сайт 3D Store предлагает просматривать коллекцию обуви в 3D, "
            + "и с помощью кнопок можно добавить понравившийся кроссовок прямо в корзину."
        )
        second = (
            heading
            + "Просматривайте коллекцию обуви в 3D и добавляйте понравившиеся кроссовки "
            + "прямо в корзину с помощью удобных кнопок на сайте 3D Store."
        )
        fresh = "Дальше на главной открыт баннер новой коллекции и три категории: обувь, одежда и сумки."

        def ask(prompt: str, _temperature: float):
            if "снят" in prompt or "(пусто)" in prompt:
                return {"text": fresh}
            return {"text": second}

        reviewed = review_script(
            [
                {"start_sec": 0, "end_sec": 10, "text": first, "visual_summary": "главная, кроссовки"},
                {"start_sec": 10, "end_sec": 21, "text": second, "visual_summary": "баннер коллекции"},
            ],
            ask=ask,
            critic=False,
        )
        texts = [row["text"] for row in reviewed["segments"]]
        self.assertNotIn("+", texts[0])
        self.assertIn("корзину", texts[0])
        self.assertNotIn("+", texts[1])
        self.assertNotIn("корзину", texts[1])
        self.assertIn("баннер", texts[1])


class CoverageTests(unittest.TestCase):
    def test_an_empty_window_is_seeded_instead_of_left_silent(self):
        reviewed = review_script(
            [
                {
                    "start_sec": 0, "end_sec": 10,
                    "text": "",
                    "brief": "Сумку можно повернуть и рассмотреть со всех сторон в каталоге.",
                    "visual_summary": "сумка вращается",
                },
            ],
            ask=lambda _prompt, _temperature: None,
            critic=False,
        )
        text = reviewed["segments"][0]["text"]
        self.assertTrue(text)
        self.assertNotIn("Демонстрирует", text)


class CaptionTests(unittest.TestCase):
    def test_a_stage_direction_is_rewritten_as_speech(self):
        caption = "Демонстрирует возможность просмотра коллекции сумок и их вращения в 3D."
        spoken = (
            "Сумку можно повернуть и рассмотреть со всех сторон. "
            "Вращение показывает форму, фурнитуру и как она сидит на плече."
        )

        def ask(prompt: str, _temperature: float):
            self.assertIn("подпись", prompt)
            return {"text": spoken}

        reviewed = review_script(
            [{"start_sec": 1, "end_sec": 11, "text": caption, "visual_summary": "сумка вращается в 3D"}],
            ask=ask,
            critic=False,
        )
        text = reviewed["segments"][0]["text"]
        self.assertNotIn("Демонстрирует", text)
        self.assertIn("Сумку можно повернуть", text)


class LineIssueTests(unittest.TestCase):
    def test_flags_absence_and_repeat_of_previous_line(self):
        said = ["Это полноценный интернет-магазин с готовым дизайном и функционалом."]
        issues = line_issues(
            "Это полноценный интернет-магазин с готовым дизайном и функционалом. Главная страница не содержит слайдера.",
            20,
            said,
        )
        self.assertTrue(any("чего нет" in issue for issue in issues))
        self.assertTrue(any("прошл" in issue for issue in issues))

    def test_accepts_a_clean_line_of_the_right_length(self):
        self.assertEqual(line_issues(LONG_GOOD, target_words(0, 13.5), []), [])


class FitSpokenTests(unittest.TestCase):
    def test_cuts_on_a_sentence_boundary(self):
        text = LONG_GOOD + " Корзина собирает выбранные товары и считает итог."
        fitted = _fit_spoken(text, 13.0, 130)
        self.assertTrue(fitted.endswith("цвету.") or fitted.endswith("покупки."))


class ReviewScriptTests(unittest.TestCase):
    def test_rewrites_a_broken_line_and_keeps_a_good_one(self):
        segments = [
            {"start_sec": 0, "end_sec": 13.5, "text": LONG_GOOD, "visual_summary": "каталог"},
            {"start_sec": 13.5, "end_sec": 27, "text": "новые товары. новые товары.", "visual_summary": "новинки"},
        ]
        fixed = (
            "Раздел новинок собирает свежие модели кроссовок в одну ленту. "
            "Каждая карточка открывает подробное описание и отзывы покупателей. "
            "Кнопка рядом сразу отправляет вопрос продавцу."
        )
        prompts: list[str] = []

        def ask(prompt: str, _temperature: float):
            prompts.append(prompt)
            if "редактор" in prompt:
                return {"issues": []}
            return {"text": fixed}

        result = review_script(segments, ask=ask)
        self.assertEqual(result["segments"][0]["text"], LONG_GOOD)
        self.assertEqual(result["segments"][1]["text"], fixed)
        self.assertEqual(result["report"]["rewritten"], [1])
        self.assertEqual(result["report"]["remaining"], [])
        self.assertIn("Каталог открывается", prompts[0])


if __name__ == "__main__":
    unittest.main()
