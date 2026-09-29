"""Narration pipeline: VLM detection, OCR-as-evidence, event beats."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scene_understand import _normalize_analysis, is_vision_model  # noqa: E402
from script_llm import (  # noqa: E402
    _build_director_prompt,
    _speech_beats,
    _with_frame_captions,
)


class VisionModelNameTests(unittest.TestCase):
    def test_text_qwen_is_not_vision(self):
        self.assertFalse(is_vision_model("qwen2.5:7b"))
        self.assertFalse(is_vision_model("qwen2.5:14b"))
        self.assertFalse(is_vision_model("gemma3:12b"))
        self.assertFalse(is_vision_model("nomic-embed-text"))

    def test_image_models_are_vision(self):
        self.assertTrue(is_vision_model("qwen2.5vl:7b"))
        self.assertTrue(is_vision_model("qwen2.5-vl:7b"))
        self.assertTrue(is_vision_model("llava:13b"))
        self.assertTrue(is_vision_model("llama3.2-vision:11b"))
        self.assertTrue(is_vision_model("minicpm-v"))


class OcrIsEvidenceTests(unittest.TestCase):
    def test_ocr_does_not_overwrite_empty_vlm_summary(self):
        ctx = {
            "duration_sec": 20,
            "warnings": ["VISION_MODEL_MISSING"],
            "visual_quality": "degraded",
            "scene_analysis": [
                {
                    "index": 0,
                    "start": 0,
                    "end": 10,
                    "visual_summary": "",
                    "source": "keyframe",
                    "ui_elements": [],
                    "frame_path": "",
                    "narration_recommended": False,
                }
            ],
        }
        out = _with_frame_captions(ctx, "ru")
        row = out["scene_analysis"][0]
        self.assertEqual(row.get("visual_summary"), "")
        self.assertEqual(row.get("source"), "keyframe")


class EventBeatTests(unittest.TestCase):
    def test_missing_vlm_does_not_make_one_speech_slot_per_window(self):
        ctx = {
            "duration_sec": 62,
            "visual_quality": "degraded",
            "warnings": ["VISION_MODEL_MISSING"],
            "chapters": [
                {"title": "A", "start": 0, "end": 28, "intent": "", "draft": "", "said": ""},
                {"title": "B", "start": 28, "end": 62, "intent": "", "draft": "", "said": ""},
            ],
            "scene_analysis": [
                {
                    "index": i,
                    "start": i * 9,
                    "end": (i + 1) * 9,
                    "visual_summary": "",
                    "source": "keyframe",
                    "ocr_labels": ["ADMIN", "Bags"] if i == 0 else ["Add to Cart"],
                    "ui_elements": ["ADMIN"] if i == 0 else ["Add to Cart"],
                    "narration_recommended": False,
                    "pause_ok": True,
                }
                for i in range(7)
            ],
        }
        beats = _speech_beats(ctx)
        self.assertEqual(len(beats), 2)
        self.assertTrue(all(beat.get("degraded") for beat in beats))
        self.assertIn("ADMIN", beats[0]["ui"])

    def test_vlm_events_become_beats_not_empty_windows(self):
        ctx = {
            "duration_sec": 30,
            "visual_quality": "vlm",
            "scene_analysis": [
                {
                    "index": 0,
                    "start": 0,
                    "end": 10,
                    "visual_summary": "Catalog grid is open; a product card is selected.",
                    "source": "vlm",
                    "user_doing": "Cursor clicks a card",
                    "actions": ["click"],
                    "changes_from_previous": "",
                    "screen_type": "catalog",
                    "narration_recommended": True,
                    "pause_ok": False,
                    "ocr_labels": ["Bags", "$65"],
                },
                {
                    "index": 1,
                    "start": 10,
                    "end": 20,
                    "visual_summary": "",
                    "source": "keyframe",
                    "narration_recommended": False,
                    "pause_ok": True,
                },
                {
                    "index": 2,
                    "start": 20,
                    "end": 30,
                    "visual_summary": "Product page opens; the model is rotated in 3D.",
                    "source": "vlm",
                    "user_doing": "Orbit the model",
                    "actions": ["3D orbit"],
                    "changes_from_previous": "Left the catalog for a product card",
                    "screen_type": "product",
                    "narration_recommended": True,
                    "pause_ok": False,
                    "visible_product": "Saddle bag",
                },
            ],
        }
        beats = _speech_beats(ctx)
        self.assertEqual(len(beats), 2)
        self.assertEqual(beats[0]["screen_type"], "catalog")
        self.assertEqual(beats[1]["screen_type"], "product")
        self.assertIn("Orbit the model", beats[1]["user"])

    def test_identical_vlm_copy_does_not_force_a_new_speech_slot(self):
        copied = "The catalog grid is open with category chips."
        ctx = {
            "duration_sec": 30,
            "visual_quality": "vlm",
            "scene_analysis": [
                {
                    "index": 0,
                    "start": 0,
                    "end": 10,
                    "visual_summary": copied,
                    "source": "vlm",
                    "screen_type": "catalog",
                    "user_doing": "looking at the grid",
                    "actions": ["view"],
                    "changes_from_previous": "opened catalog",
                    "narration_recommended": True,
                },
                {
                    "index": 1,
                    "start": 10,
                    "end": 20,
                    "visual_summary": copied,
                    "source": "vlm",
                    "screen_type": "catalog",
                    "user_doing": "переход на страницу категорий",
                    "actions": ["переход"],
                    "changes_from_previous": "изменение экрана с предыдущего кадра",
                    "narration_recommended": True,
                },
                {
                    "index": 2,
                    "start": 20,
                    "end": 30,
                    "visual_summary": copied,
                    "source": "vlm",
                    "screen_type": "catalog",
                    "user_doing": "Clicks the Bags category chip",
                    "actions": ["click"],
                    "changes_from_previous": "The Bags category becomes selected",
                    "narration_recommended": True,
                },
            ],
        }
        beats = _speech_beats(ctx)
        self.assertEqual(len(beats), 3)
        self.assertEqual(beats[0]["end"], 10)
        self.assertEqual(beats[2]["start"], 20)
        self.assertIn("Bags", beats[2]["user"])

    def test_pause_flag_does_not_drop_a_described_screen_change(self):
        ctx = {
            "duration_sec": 20,
            "visual_quality": "vlm",
            "scene_analysis": [
                {
                    "index": 0,
                    "start": 0,
                    "end": 10,
                    "visual_summary": "The catalog opens on a product grid.",
                    "source": "vlm",
                    "screen_type": "catalog",
                    "user_doing": "Opens categories",
                    "changes_from_previous": "Left the home page",
                    "narration_recommended": False,
                    "pause_ok": True,
                },
                {
                    "index": 1,
                    "start": 10,
                    "end": 20,
                    "visual_summary": "A product card opens with a 3D model.",
                    "source": "vlm",
                    "screen_type": "product",
                    "user_doing": "Opens the card",
                    "changes_from_previous": "Opened the product",
                    "narration_recommended": False,
                    "pause_ok": False,
                },
            ],
        }
        beats = _speech_beats(ctx)
        self.assertEqual(len(beats), 2)
        self.assertEqual(beats[0]["screen_type"], "catalog")
        self.assertEqual(beats[1]["screen_type"], "product")

    def test_long_picture_is_split_into_short_narration_windows(self):
        ctx = {
            "duration_sec": 28,
            "visual_quality": "vlm",
            "scene_analysis": [
                {
                    "index": 0,
                    "start": 0,
                    "end": 14,
                    "visual_summary": "The catalog grid is on screen.",
                    "source": "vlm",
                    "screen_type": "catalog",
                    "user_doing": "Scrolls the grid",
                    "narration_recommended": True,
                    "changes_from_previous": "Opened the catalog",
                },
                {
                    "index": 1,
                    "start": 14,
                    "end": 28,
                    "visual_summary": "A product card is open and the model rotates.",
                    "source": "vlm",
                    "screen_type": "product",
                    "user_doing": "Orbits the model",
                    "narration_recommended": True,
                    "changes_from_previous": "Opened the product card",
                },
            ],
        }
        beats = _speech_beats(ctx)
        self.assertGreaterEqual(len(beats), 4)
        self.assertTrue(all(float(beat["end"]) - float(beat["start"]) <= 12 for beat in beats))
        self.assertEqual(beats[0]["start"], 0)
        self.assertEqual(beats[-1]["end"], 28)

    def test_director_prompt_marks_degraded_and_keeps_ocr_as_labels(self):
        ctx = {
            "duration_sec": 20,
            "visual_quality": "degraded",
            "warnings": ["VISION_MODEL_MISSING"],
            "chapters": [{"title": "A", "start": 0, "end": 20, "intent": "", "draft": "", "said": ""}],
            "scene_analysis": [
                {
                    "index": 0,
                    "start": 0,
                    "end": 20,
                    "visual_summary": "",
                    "source": "keyframe",
                    "ocr_labels": ["Bags", "ADMIN"],
                    "ui_elements": ["Bags", "ADMIN"],
                    "narration_recommended": False,
                }
            ],
        }
        prompt = _build_director_prompt(ctx, "", "ru", 130, "")
        self.assertIn("VISUAL UNDERSTANDING IS DEGRADED", prompt)
        self.assertIn("Bags", prompt)
        self.assertNotIn("max ~", prompt)
        self.assertNotIn("Открыта админка", prompt)

    def test_director_prompt_uses_vlm_events(self):
        ctx = {
            "duration_sec": 12,
            "visual_quality": "vlm",
            "scene_analysis": [
                {
                    "index": 0,
                    "start": 0,
                    "end": 12,
                    "visual_summary": "The shopper opens a product card and switches to 3D.",
                    "source": "vlm",
                    "user_doing": "Clicks Turn it in 3D",
                    "actions": ["3D orbit"],
                    "screen_type": "product",
                    "narration_recommended": True,
                    "ocr_labels": ["Turn it in 3D"],
                }
            ],
        }
        prompt = _build_director_prompt(ctx, "", "en", 130, "Marketplace template")
        self.assertIn("vision model that compared", prompt)
        self.assertIn("opens a product card", prompt)
        self.assertIn("Turn it in 3D", prompt)
        self.assertIn("EVENT 0", prompt)

    def test_screen_caption_is_not_spoken_and_not_replaced_by_the_frame_note(self):
        from script_llm import _align_segments_to_beats

        caption = "Пользователь перешел на следующую страницу магазина."
        beats = [
            {
                "start": 0, "end": 9, "visuals": [caption], "user": caption, "ui": [],
                "actions": [], "change": "переход", "draft_slice": "", "features": ["список разделов"],
            },
        ]
        aligned = _align_segments_to_beats(
            [{"start_sec": 0, "end_sec": 9, "text": caption, "speak": True}],
            beats, "ru", 130, "",
        )
        self.assertEqual(aligned, [])

    def test_repeated_fact_is_dropped_and_a_new_capability_is_kept(self):
        from script_llm import _align_segments_to_beats

        first = "Сетка разделов помогает выбрать нужную группу товаров."
        repeat = "Сетка разделов снова помогает выбрать нужную группу товаров."
        nxt = "Карточка показывает цену и даёт повернуть товар перед заказом."
        beats = [
            {"start": 0, "end": 9, "visuals": ["разделы"], "user": "", "ui": [], "actions": [], "change": "", "draft_slice": ""},
            {"start": 9, "end": 18, "visuals": ["разделы"], "user": "", "ui": [], "actions": [], "change": "", "draft_slice": ""},
            {"start": 18, "end": 27, "visuals": ["карточка"], "user": "", "ui": [], "actions": [], "change": "", "draft_slice": ""},
        ]
        segments = [
            {"start_sec": 0, "end_sec": 9, "text": first},
            {"start_sec": 9, "end_sec": 18, "text": repeat},
            {"start_sec": 18, "end_sec": 27, "text": nxt},
        ]
        aligned = _align_segments_to_beats(segments, beats, "ru", 130, "")
        self.assertEqual([item["text"] for item in aligned], [first if first.endswith(".") else first + ".", nxt if nxt.endswith(".") else nxt + "."])
        self.assertEqual(aligned[0]["start_sec"], 0)
        self.assertEqual(aligned[1]["start_sec"], 18)

    def test_navigation_is_not_the_fact_and_a_command_is_dropped(self):
        from script_llm import _align_segments_to_beats, _moment_to_tell

        moment = _moment_to_tell(
            {"features": ["переход на следующую страницу", "показ брендов", "переход"], "product": ""},
            [],
        )
        self.assertEqual(moment["primary"], "показ брендов")
        repeated = _moment_to_tell(
            {"features": ["показ брендов"], "product": ""},
            ["Раздел показывает бренды магазина и их товары."],
        )
        self.assertIsNone(repeated)
        moved = _moment_to_tell(
            {"features": ["3D модель товара"], "product": "обувь"},
            ["Объёмная модель показывает сумку со всех сторон."],
        )
        self.assertEqual(moved["primary"], "3D модель товара")
        beats = [{
            "start": 0, "end": 8, "visuals": ["кадр"], "user": "", "ui": [],
            "actions": [], "change": "", "draft_slice": "",
            "features": ["показ брендов"],
        }]
        aligned = _align_segments_to_beats(
            [{"start_sec": 0, "end_sec": 8, "text": "Переходите между страницами магазина."}],
            beats, "ru", 130, "",
        )
        self.assertEqual(aligned, [])

    def test_caption_salvage_keeps_the_action_and_drops_the_page_frame(self):
        from script_llm import _salvage_caption

        compared = _salvage_caption(
            "На странице раздела вы можете сравнить две модели и сохранить выбор.",
            {"primary": "сравнение моделей"},
        )
        self.assertTrue(compared.lower().startswith("можно "))
        self.assertNotIn("на странице", compared.lower())
        listed = _salvage_caption(
            "Эта страница подборки позволяет сузить список.",
            {"primary": "сужение списка"},
        )
        self.assertTrue(listed.lower().startswith("сужение списка позволяет"))
        priced = _salvage_caption(
            "На странице витрины теперь отображается стоимость позиции.",
            {"primary": "показ стоимости"},
        )
        self.assertTrue(priced.lower().startswith("можно увидеть"))
        self.assertIn("стоимость", priced.lower())
        self.assertNotIn("—", priced)
        from script_llm import _repair_opening
        self.assertTrue(
            _repair_opening("Отображения новых позиций и обновления меню можно изучить модель.").lower().startswith("можно изучить")
        )
        self.assertTrue(
            _repair_opening("В разделе подборки с фильтром можно сузить список.").lower().startswith("в разделе")
        )

    def test_a_line_occupies_its_speech_and_the_next_waits(self):
        from script_llm import _accept_tour_line, _place_by_speech

        placed = _place_by_speech([
            {"anchor_sec": 0, "text": "Каталог начинается с разделов.", "estimated_sec": 4.5},
            {"anchor_sec": 9, "text": "Дальше видны марки.", "estimated_sec": 4},
        ])
        self.assertEqual(placed[0]["end_sec"], 4.5)
        self.assertLess(placed[0]["end_sec"], 9)
        self.assertAlmostEqual(placed[1]["start_sec"], 4.9, places=1)
        overlap = _place_by_speech([
            {"anchor_sec": 0, "text": "Длинная реплика занимает больше окна.", "estimated_sec": 12},
            {"anchor_sec": 9, "text": "Следующая мысль.", "estimated_sec": 4},
        ])
        self.assertGreaterEqual(overlap[1]["start_sec"], 12)
        self.assertEqual(
            _accept_tour_line(
                "Этот фрагмент шаблона предоставляет покупателю удобный доступ к категориям.",
                {"primary": "отображение категорий товаров", "product": "", "section": "", "also": []},
                [],
                "ru",
            ),
            "",
        )
        self.assertEqual(
            _accept_tour_line(
                "Возможность выбора товаров по категориям позволяет вам выбирать товары по категориям.",
                {"primary": "выбор по категориям", "product": "", "section": "категории", "also": []},
                [],
                "ru",
            ),
            "",
        )
        self.assertEqual(
            _accept_tour_line(
                "Теперь перейдите к странице брендов, где можно выбрать товары от известных брендов.",
                {"primary": "показ брендов", "product": "", "section": "бренды", "also": []},
                [],
                "ru",
            ),
            "Можно выбрать товары от известных брендов.",
        )
        self.assertEqual(
            _accept_tour_line(
                "Каталог открывается, позволяя сразу.",
                {"primary": "каталог товаров", "product": "", "section": "разделы", "also": []},
                [],
                "ru",
            ),
            "",
        )

    def test_related_events_become_one_thought_not_a_caption_each(self):
        from script_llm import _accept_tour_line, _compose_unit_line, _narrative_units, _unit_capabilities

        beats = [
            {"start": 0, "end": 4, "screen_type": "catalog", "features": ["отображение категорий товаров", "переход на страницу"], "product": "", "change": ""},
            {"start": 4, "end": 8, "screen_type": "catalog", "features": ["3D модель товара"], "product": "сумка", "change": ""},
            {"start": 8, "end": 12, "screen_type": "catalog", "features": ["кнопка Add to Cart"], "product": "сумка", "change": ""},
            {"start": 20, "end": 28, "screen_type": "contact", "features": ["форма сообщения"], "product": "", "change": ""},
        ]
        units = _narrative_units(beats)
        self.assertEqual(len(units), 2)
        self.assertEqual(units[0]["end"], 12)
        self.assertEqual(units[1]["start"], 20)
        caps = _unit_capabilities(units[0]["beats"], [])
        self.assertGreaterEqual(len(caps), 2)
        self.assertNotIn("переход на страницу", caps)
        self.assertNotIn("форма для отправки сообщения", _unit_capabilities(
            [{"start": 9, "end": 18, "screen_type": "catalog", "features": ["отображение категорий товаров", "форма для отправки сообщения"], "product": ""}],
            [],
        ))
        self.assertEqual(
            _accept_tour_line(
                "Можно увидеть 3D модель товара.",
                {"primary": caps[0], "also": caps[1:], "product": "сумка", "section": "", "capabilities": caps},
                [],
                "ru",
            ),
            "",
        )
        line = _compose_unit_line(caps)
        self.assertGreaterEqual(len(line.split()), 6)
        self.assertFalse(line.lower().startswith("можно увидеть"))
        drill = _narrative_units([
            {"start": 44, "end": 53, "screen_type": "catalog", "features": ["просмотр коллекции"], "product": ""},
            {"start": 53, "end": 62, "screen_type": "product", "features": ["3D-представление товара"], "product": "сумка"},
        ])
        self.assertEqual(len(drill), 2)
        sneaker = _narrative_units([
            {"start": 18.69, "end": 27.99, "screen_type": "catalog", "features": ["просмотр товара"], "product": "кроссовок"},
            {"start": 27.99, "end": 37.29, "screen_type": "catalog", "features": ["3D модель кроссовка"], "product": "кроссовок"},
        ])
        self.assertEqual(len(sneaker), 2)
        self.assertTrue(_compose_unit_line(["переход между категориями", "3D модель кроссовка"]).startswith("Покупатель может переходить"))

    def test_prompt_asks_for_a_tour_and_prefers_the_demonstrated_action(self):
        ctx = {
            "duration_sec": 10,
            "visual_quality": "vlm",
            "scene_analysis": [
                {
                    "index": 0,
                    "start": 0,
                    "end": 10,
                    "visual_summary": "A product card is open.",
                    "source": "vlm",
                    "actions": ["rotate the item"],
                    "product_features": ["printed price"],
                    "demonstrated_feature": "rotate the item",
                    "screen_type": "product",
                    "narration_recommended": True,
                    "ocr_labels": ["Price"],
                }
            ],
        }
        prompt = _build_director_prompt(ctx, "", "en", 130, "")
        self.assertIn("what the viewer learns", prompt.lower())
        self.assertIn("prefer an action over a label", prompt.lower())
        self.assertIn("rotate the item", prompt)
        self.assertLess(prompt.lower().index("rotate the item"), prompt.lower().index("price"))


class NormalizeMissingVlmTests(unittest.TestCase):
    def test_empty_window_is_not_recommended_speech(self):
        item = _normalize_analysis(None, {"index": 0, "start": 0, "end": 8, "frame_paths": []})
        self.assertEqual(item["visual_summary"], "")
        self.assertEqual(item["source"], "keyframe")
        self.assertFalse(item["narration_recommended"])


if __name__ == "__main__":
    unittest.main()
