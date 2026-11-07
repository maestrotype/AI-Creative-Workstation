"""Long TI2V shot: segments chain on the last frame and join without a repeated seam frame."""
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

from api.motion import SEAM_SKIP_FRAMES, handoff_frame, join_segments, last_frame  # noqa: E402


def _frames(path: str) -> int:
    probe = subprocess.run(
        [
            "ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
            "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path,
        ],
        capture_output=True, text=True, check=True,
    )
    return int(probe.stdout.strip())


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg is required")
class ChainJoinTests(unittest.TestCase):
    def _clip(self, folder: str, name: str, color: str) -> str:
        path = os.path.join(folder, name)
        subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error", "-f", "lavfi",
                "-i", f"color=c={color}:s=64x48:r=24:d=0.4167",
                "-frames:v", "10", "-pix_fmt", "yuv420p", path,
            ],
            check=True,
        )
        return path

    def test_segments_join_without_the_repeated_seam_frames(self):
        with tempfile.TemporaryDirectory() as tmp:
            first = self._clip(tmp, "a.mp4", "red")
            second = self._clip(tmp, "b.mp4", "blue")
            dest = join_segments([first, second], os.path.join(tmp, "out.mp4"), 24)
            self.assertEqual(_frames(first), 10)
            self.assertEqual(_frames(dest), 10 + 10 - SEAM_SKIP_FRAMES)

    def test_a_smeared_tail_hands_off_the_last_sharp_frame(self):
        with tempfile.TemporaryDirectory() as tmp:
            clip = os.path.join(tmp, "smear.mp4")
            subprocess.run(
                [
                    "ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=s=128x96:r=24",
                    "-vf", "boxblur=8:enable='gte(n,7)'", "-frames:v", "10", "-pix_fmt", "yuv420p", clip,
                ],
                check=True,
            )
            png = os.path.join(tmp, "handoff.png")
            kept = handoff_frame(clip, 10, png)
            self.assertEqual(kept, 7)
            self.assertTrue(os.path.getsize(png) > 0)
            dest = join_segments([clip, clip], os.path.join(tmp, "out.mp4"), 24, [kept, None])
            self.assertEqual(_frames(dest), 7 + 10 - SEAM_SKIP_FRAMES)

    def test_last_frame_is_a_still_for_the_next_segment(self):
        with tempfile.TemporaryDirectory() as tmp:
            clip = self._clip(tmp, "a.mp4", "green")
            png = last_frame(clip, os.path.join(tmp, "last.png"))
            self.assertTrue(os.path.getsize(png) > 0)


if __name__ == "__main__":
    unittest.main()
