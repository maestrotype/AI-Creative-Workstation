"""Internal pauses in one spoken line are collapsed to a breath."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tts_audio import clean_speech  # noqa: E402


class CleanSpeechTests(unittest.TestCase):
    def test_a_long_hole_inside_one_line_shrinks_to_a_breath(self):
        sr = 24000
        tone = 0.4 * np.sin(2 * np.pi * 180 * np.arange(int(0.4 * sr)) / sr).astype("float32")
        hole = np.zeros(int(3.0 * sr), dtype="float32")
        wav = np.concatenate([tone, hole, tone])
        cleaned = clean_speech(wav, sr)
        self.assertLess(cleaned.size / sr, 1.2)
        self.assertGreater(cleaned.size / sr, 0.7)

    def test_a_short_breath_stays(self):
        sr = 24000
        tone = 0.4 * np.sin(2 * np.pi * 180 * np.arange(int(0.3 * sr)) / sr).astype("float32")
        breath = np.zeros(int(0.12 * sr), dtype="float32")
        wav = np.concatenate([tone, breath, tone])
        cleaned = clean_speech(wav, sr)
        self.assertGreater(cleaned.size / sr, 0.6)


if __name__ == "__main__":
    unittest.main()
