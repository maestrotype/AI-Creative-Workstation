"""Prompt fallback used when Create opens a still named job_*."""
from __future__ import annotations

import re
import unittest

JOB_LIKE = re.compile(r"^(job|vid|mesh)_[a-f0-9]+$", re.I)
DEFAULT_MOTION = (
    "Slow cinematic camera push-in with a slight orbit, keep the product recognizable."
)


def is_job_like_id(text: str) -> bool:
    return bool(JOB_LIKE.match((text or "").strip()))


def prompt_for_video_action(store_prompt: str, result_prompt: str, medium: str) -> str:
    real = ""
    for raw in (store_prompt, result_prompt):
        trimmed = (raw or "").strip()
        if trimmed and not is_job_like_id(trimmed):
            real = trimmed
            break
    if medium == "animate":
        return real or "Short animation of this still."
    if not real:
        return DEFAULT_MOTION
    if re.search(r"\b(camera|orbit|push-in|push in|dolly|pan|tilt|zoom|наезд|облёт|камер)", real, re.I):
        return real
    return f"{DEFAULT_MOTION} Subject: {real}"


class ResultStillPromptTests(unittest.TestCase):
    def test_job_id_is_not_a_prompt(self):
        self.assertTrue(is_job_like_id("job_b71ccddaab98"))
        self.assertTrue(is_job_like_id("vid_abc123def456"))
        self.assertFalse(is_job_like_id("white leather sneakers"))

    def test_empty_library_still_gets_camera_prompt(self):
        self.assertEqual(
            prompt_for_video_action("", "job_b71ccddaab98", "video"),
            DEFAULT_MOTION,
        )

    def test_image_caption_is_wrapped_with_camera(self):
        out = prompt_for_video_action("White leather sneakers, studio light", "", "video")
        self.assertIn("push-in", out)
        self.assertIn("White leather sneakers", out)

    def test_existing_camera_prompt_is_kept(self):
        motion = "Slow orbit around the product, keep the shoe sharp."
        self.assertEqual(prompt_for_video_action(motion, "job_x", "video"), motion)


if __name__ == "__main__":
    unittest.main()
