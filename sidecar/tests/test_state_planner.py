"""Story map, claim checks, and placement — no demo-specific topics."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from state_planner import (  # noqa: E402
    line_problems,
    place,
    plan_units,
    speech_sec,
    visual_map,
    _fill_timeline,
)


def _frame(time_sec, change_at, state, evidence, **extra):
    return {
        "time": time_sec,
        "change_at": change_at,
        "state": state,
        "evidence": evidence,
        "popup": extra.pop("popup", ""),
        "seen_text": extra.pop("seen_text", []),
        "language": extra.pop("language", "en"),
        "luma": extra.pop("luma", 200.0),
        **extra,
    }


def _shop_states():
    return [
        _frame(0.4, 0.0, "Главная с баннером коллекции.", ["баннер коллекции", "SHOP NOW"]),
        _frame(3.4, 3.2, "Карточка с вращением модели и кнопкой корзины.",
               ["вращение модели", "кнопка корзины", "Turn it in 3D"]),
        _frame(8.0, 7.5, "Раздел категорий: обувь, одежда и сумки.",
               ["категории товаров", "обувь", "одежда", "сумки", "Featured Categories"]),
        _frame(10.5, 9.5, "Форма сообщения с полями имени и почты.",
               ["форма", "Your Name", "Your Email"]),
        _frame(14.5, 14.0, "Блок с логотипами марок.", ["логотипы марок", "Nike", "Puma"]),
        _frame(25.5, 24.5, "Снова логотипы марок.", ["логотипы марок", "Nike", "Puma"]),
        _frame(18.0, 17.5, "Снова главная с баннером коллекции.", ["баннер коллекции", "SHOP NOW"]),
        _frame(38.0, 37.5, "Та же главная.", ["баннер коллекции"], luma=40.0),
        _frame(49.0, 48.5, "Главная с баннером коллекции.", ["баннер коллекции"],
               language="ru", seen_text=["Откройте коллекцию"]),
    ]


class VisualMapTests(unittest.TestCase):
    def test_brightness_and_language_are_measured_facts(self):
        frames = visual_map(_shop_states(), 62.0)
        dark = next(f for f in frames if abs(f["start"] - 37.5) < 0.05)
        self.assertTrue(any("тёмное" in item for item in dark["measured"]))
        russian = next(f for f in frames if abs(f["start"] - 48.5) < 0.05)
        self.assertTrue(any("русский" in item for item in russian["measured"]))

    def test_other_domain_needs_no_shop_vocabulary(self):
        states = [
            _frame(0.4, 0.0, "Меню ресторана: паста и салаты.", ["меню ресторана", "паста", "салаты"]),
            _frame(6.0, 5.5, "Форма брони столика.", ["бронь столика", "форма"]),
        ]
        frames = visual_map(states, 12.0)
        self.assertEqual(len(frames), 2)
        self.assertIn("столик", " ".join(frames[1]["facts"] + [frames[1]["state"]]))


def _unit(start, limit, meaning, facts, topic="тема"):
    frames = [{
        "start": start, "end": limit, "state": meaning, "facts": facts,
        "measured": [], "popup": "", "meaning": meaning, "new": "",
    }]
    return {
        "start": start,
        "limit": limit,
        "budget": limit - start,
        "topics": [{"topic": topic, "meaning": meaning}],
        "frames": [0],
    }, frames


class LineCheckTests(unittest.TestCase):
    def setUp(self):
        self.unit, self.frames = _unit(
            3.2, 8.0,
            "Карточка позволяет повернуть модель и положить товар в корзину.",
            ["вращение модели", "кнопка корзины", "Turn it in 3D"],
            topic="карточка товара",
        )

    def test_rejects_ukrainian_and_caption(self):
        self.assertTrue(line_problems("Поверні модель в 3D.", self.unit, self.frames, [], "", first=False))
        self.assertTrue(line_problems("Страница магазина с 3D-моделями сумок.", self.unit, self.frames, [], "", first=False))

    def test_rejects_evaluation_claim_not_the_word(self):
        text = "Карточка позволяет повернуть модель и сразу положить её в корзину."
        claims = [{"claim": "удобная карточка", "evidence": "вращение модели", "type": "оценка"}]
        problems = line_problems(text, self.unit, self.frames, [], "", claims, first=False)
        self.assertTrue(any("оценка" in item for item in problems))

    def test_allows_interpretation_words_not_on_screen(self):
        text = "Карточка товара позволяет открыть поворот модели и положить её в корзину."
        claims = [{
            "claim": "карточку можно повернуть",
            "evidence": "вращение модели",
            "type": "толкование",
        }]
        problems = line_problems(text, self.unit, self.frames, [], "", claims, first=False)
        self.assertFalse(problems, problems)

    def test_rejects_unsupported_evidence_citation(self):
        text = "Карточка товара позволяет открыть поворот модели и положить её в корзину."
        claims = [{
            "claim": "есть поиск по каталогу",
            "evidence": "строка поиска",
            "type": "видно",
        }]
        problems = line_problems(text, self.unit, self.frames, [], "", claims, first=False)
        self.assertTrue(any("опора" in item for item in problems))


class UnitPlanTests(unittest.TestCase):
    def test_short_first_showing_uses_the_later_one(self):
        frames = visual_map(_shop_states(), 62.0)
        for frame, topic, meaning, importance in [
            (0, "главная", "Открывается новая коллекция.", "high"),
            (1, "карточка", "Модель можно повернуть.", "high"),
            (2, "категории", "Товары разложены по категориям.", "high"),
            (3, "форма", "Можно написать магазину через форму.", "medium"),
            (4, "бренды", "В витрине собраны марки.", "high"),
            (5, "бренды", "В витрине собраны марки.", "high"),
            (6, "главная", "Открывается новая коллекция.", "low"),
            (7, "оформление", "Оформление стало тёмным.", "high"),
            (8, "язык", "Интерфейс переведён на русский.", "high"),
        ]:
            frames[frame]["topic"] = topic
            frames[frame]["meaning"] = meaning
            frames[frame]["importance"] = importance
            frames[frame]["new"] = meaning
        from state_planner import story_map as _story

        original = __import__("state_planner", fromlist=["label_frames"]).label_frames

        def _reuse(labeled, model, context):
            del model, context
            for src, dest in zip(frames, labeled):
                dest["topic"] = src["topic"]
                dest["meaning"] = src["meaning"]
                dest["importance"] = src["importance"]
                dest["new"] = src["new"]

        import state_planner as sp
        sp.label_frames = _reuse
        try:
            topics = _story(frames, "none", "")
        finally:
            sp.label_frames = original
        units, silent = plan_units(topics, frames)
        brands = next(u for u in units if any(t["topic"] == "бренды" for t in u["topics"]))
        self.assertGreaterEqual(brands["start"], 14.0)
        self.assertGreaterEqual(brands["budget"], 2.8)
        self.assertFalse(any(item["topic"] == "бренды" for item in silent))

    def test_timeline_has_no_holes(self):
        filled = _fill_timeline([
            {"start_sec": 0.0, "end_sec": 3.0, "text": "a", "role": "body"},
            {"start_sec": 10.0, "end_sec": 14.0, "text": "", "role": "body"},
        ], 20.0)
        self.assertEqual(filled[0]["start_sec"], 0.0)
        self.assertAlmostEqual(filled[1]["start_sec"], 3.0, places=1)
        self.assertAlmostEqual(filled[1]["end_sec"], 10.0, places=1)
        self.assertEqual(filled[1]["text"], "")
        self.assertEqual(filled[-1]["end_sec"], 20.0)

    def test_speech_stays_inside_its_window(self):
        unit, frames = _unit(
            7.5, 13.0,
            "Товары разложены по категориям.",
            ["категории товаров", "обувь"],
            topic="категории",
        )
        text = "Каталог разложен по категориям, и по ним можно перейти к нужному разделу."
        self.assertLessEqual(speech_sec(text), unit["budget"] + 0.25)
        written = [{"unit": unit, "text": text, "claims": [], "problems": [], "draft": text}]
        placed = place(written)
        self.assertEqual(len(placed), 1)
        self.assertGreaterEqual(placed[0]["start_sec"], unit["start"])
        self.assertLessEqual(placed[0]["end_sec"], unit["limit"] + 0.25)


if __name__ == "__main__":
    unittest.main()
