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


class NormalizeMissingVlmTests(unittest.TestCase):
    def test_empty_window_is_not_recommended_speech(self):
        item = _normalize_analysis(None, {"index": 0, "start": 0, "end": 8, "frame_paths": []})
        self.assertEqual(item["visual_summary"], "")
        self.assertEqual(item["source"], "keyframe")
        self.assertFalse(item["narration_recommended"])


if __name__ == "__main__":
    unittest.main()
