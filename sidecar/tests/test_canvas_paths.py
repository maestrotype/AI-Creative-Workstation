"""Writable Canvas root and analysis folder."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import canvas_paths as paths  # noqa: E402


class CanvasPathsTests(unittest.TestCase):
    def tearDown(self):
        paths.canvas_root.cache_clear()
        os.environ.pop("ACW_CANVAS_ROOT", None)

    def test_env_root_wins(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["ACW_CANVAS_ROOT"] = tmp
            paths.canvas_root.cache_clear()
            self.assertEqual(paths.canvas_root(), tmp)
            folder = paths.analysis_dir()
            self.assertTrue(folder.startswith(tmp))
            self.assertTrue(os.path.isdir(folder))

    def test_permission_message_is_russian(self):
        err = OSError(1, "Operation not permitted")
        err.errno = 1
        text = paths.access_denied_message(err)
        self.assertIn("Документам", text)


if __name__ == "__main__":
    unittest.main()
