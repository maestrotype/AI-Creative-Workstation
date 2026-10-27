from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.audio import lock_speech_to_window  # noqa: E402


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg required")
class SpeechLockTests(unittest.TestCase):
    def test_short_speech_is_not_slowed_to_fill_the_picture(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = os.path.join(tmp, "source.wav")
            output = os.path.join(tmp, "output.wav")
            subprocess.run(
                [
                    shutil.which("ffmpeg") or "ffmpeg",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=220:duration=1",
                    source,
                ],
                check=True,
                capture_output=True,
            )

            result = lock_speech_to_window(source, output, 4.0, fill_window=True)

            self.assertTrue(result["needs_expand"])
            self.assertGreaterEqual(result["tempo"], 0.94)
            self.assertLess(result["output_sec"], 1.3)

    def test_small_tempo_correction_stays_natural(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = os.path.join(tmp, "source.wav")
            output = os.path.join(tmp, "output.wav")
            subprocess.run(
                [
                    shutil.which("ffmpeg") or "ffmpeg",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=220:duration=1",
                    source,
                ],
                check=True,
                capture_output=True,
            )

            result = lock_speech_to_window(source, output, 1.0, fill_window=True)

            self.assertGreaterEqual(result["tempo"], 0.94)
            self.assertLessEqual(result["tempo"], 1.08)


if __name__ == "__main__":
    unittest.main()
