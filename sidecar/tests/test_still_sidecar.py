"""Still JSON sidecar so Create can animate a library photo."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.still_meta import sidecar_path, write_still_sidecar  # noqa: E402


class StillSidecarTests(unittest.TestCase):
    def test_sidecar_sits_next_to_png(self):
        self.assertEqual(sidecar_path("/tmp/job_abc.png"), "/tmp/job_abc.json")

    def test_write_roundtrip_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            still = str(Path(tmp) / "job_b71ccddaab98.png")
            Path(still).write_bytes(b"x")
            side = write_still_sidecar(
                still,
                prompt="White leather sneakers, studio light",
                job="product",
                fmt="square",
                style="subtle",
                model_id="black-forest-labs/FLUX.1-schnell",
                english_prompt="White leather sneakers, studio light",
            )
            data = json.loads(Path(side).read_text(encoding="utf-8"))
            self.assertEqual(data["prompt"], "White leather sneakers, studio light")
            self.assertEqual(data["kind"], "image")
            self.assertEqual(data["job"], "product")


if __name__ == "__main__":
    unittest.main()
