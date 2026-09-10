"""Discrete Wan TI2V frame counts: 4n+1, 5s → 121, not 41."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import mlx_ti2v  # noqa: E402


class Ti2vFrameTests(unittest.TestCase):
    def test_snap_is_nearest_4n_plus_1(self):
        self.assertEqual(mlx_ti2v.snap_frame_count(40), 41)
        self.assertEqual(mlx_ti2v.snap_frame_count(41), 41)
        self.assertEqual(mlx_ti2v.snap_frame_count(80), 81)
        self.assertEqual(mlx_ti2v.snap_frame_count(81), 81)
        self.assertEqual(mlx_ti2v.snap_frame_count(120), 121)
        self.assertEqual(mlx_ti2v.snap_frame_count(121), 121)
        self.assertEqual(mlx_ti2v.snap_frame_count(200), 121)
        self.assertEqual(mlx_ti2v.snap_frame_count(1), 17)

    def test_unspecified_duration_stays_short(self):
        self.assertEqual(mlx_ti2v.frames_for_duration(None), 41)
        self.assertEqual(mlx_ti2v.frames_for_duration(0), 41)

    def test_duration_maps_to_24fps_4n_plus_1(self):
        self.assertEqual(mlx_ti2v.frames_for_duration(1.7), 41)
        self.assertEqual(mlx_ti2v.frames_for_duration(3.4), 81)
        self.assertEqual(mlx_ti2v.frames_for_duration(5.0), 121)
        self.assertEqual(mlx_ti2v.frames_for_duration(10.0), 121)

    def test_num_frames_wins(self):
        self.assertEqual(mlx_ti2v.frames_for_duration(5.0, 81), 81)
        self.assertEqual(mlx_ti2v.frames_for_duration(3.4, 41), 41)
        self.assertEqual(mlx_ti2v.frames_for_duration(5.0, 121), 121)


if __name__ == "__main__":
    unittest.main()
