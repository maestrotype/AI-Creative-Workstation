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

from api.video import CalloutModel, RenderTimelineRequest, TimelineClipModel, render_timeline  # noqa: E402


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg required")
class RenderTimelineSmokeTests(unittest.TestCase):
    def test_video_audio_title_and_hint_render(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = os.path.join(tmp, "source.mp4")
            subprocess.run([
                shutil.which("ffmpeg") or "ffmpeg", "-y",
                "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24:d=1",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                source,
            ], check=True, capture_output=True)
            request = RenderTimelineRequest(
                width=320,
                height=180,
                fps=24,
                clips=[
                    TimelineClipModel(
                        kind="video", track="v1", path=source,
                        start_sec=0, duration_sec=1, source_in_sec=0,
                    ),
                    TimelineClipModel(
                        kind="text", track="t1", text="Demo",
                        start_sec=0.1, duration_sec=0.7, source_in_sec=0,
                    ),
                ],
                callouts=[CalloutModel(
                    id="hint", start_sec=0.2, duration_sec=0.5,
                    target_x=30, target_y=30, box_x=35, box_y=35,
                    text="Click", type="accent",
                )],
            )
            result = render_timeline(request)
            output = result["file_path"]
            self.assertTrue(os.path.isfile(output))
            duration = float(subprocess.check_output([
                shutil.which("ffprobe") or "ffprobe", "-v", "error",
                "-show_entries", "format=duration", "-of", "csv=p=0", output,
            ], text=True).strip())
            self.assertGreater(duration, 0.8)
            os.remove(output)


if __name__ == "__main__":
    unittest.main()
