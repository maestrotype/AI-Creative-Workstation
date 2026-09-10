"""Capability routing: SVD is animation, not AI video."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import video_capability as vc  # noqa: E402


SVD = "stabilityai/stable-video-diffusion-img2vid-xt"
RUNWAY = "runwayml/gen4.5"
H3 = "MiniMaxAI/MiniMax-H3"
TI2V = "Anes1032/Wan2.2-TI2V-5B-mlx-q8"
WAN = "Wan-AI/Wan2.1-T2V-1.3B-Diffusers"


class CapabilityTests(unittest.TestCase):
    def test_svd_is_image_animation_not_i2v(self):
        spec = vc.spec_for(SVD)
        self.assertIsNotNone(spec)
        self.assertEqual(spec["capability"], vc.IMAGE_ANIMATION)
        self.assertFalse(spec["supports_text_prompt"])
        self.assertFalse(spec["prompt_consumed"])
        self.assertTrue(spec["supports_image_conditioning"])
        self.assertFalse(spec["supports_camera_motion"])
        self.assertFalse(spec["supports_scene_description"])

    def test_runway_and_h3_are_prompt_driven_i2v(self):
        for model_id in (RUNWAY, H3):
            spec = vc.spec_for(model_id)
            self.assertEqual(spec["capability"], vc.IMAGE_TO_VIDEO)
            self.assertTrue(spec["supports_text_prompt"])
            self.assertTrue(spec["prompt_consumed"])
            self.assertTrue(spec["supports_image_conditioning"])

    def test_wan_is_t2v_not_product_i2v(self):
        spec = vc.spec_for(WAN)
        self.assertEqual(spec["capability"], vc.TEXT_TO_VIDEO)
        self.assertFalse(spec["supports_image_conditioning"])

    def test_ai_video_rejects_svd(self):
        with self.assertRaises(RuntimeError) as caught:
            vc.assert_mode_allowed("ai_video", SVD)
        self.assertIn("VIDEO_CAPABILITY_UNSUPPORTED", str(caught.exception))
        self.assertIn("IMAGE_ANIMATION", str(caught.exception))

    def test_ai_video_rejects_wan(self):
        with self.assertRaises(RuntimeError) as caught:
            vc.assert_mode_allowed("ai_video", WAN)
        self.assertIn("VIDEO_CAPABILITY_UNSUPPORTED", str(caught.exception))

    def test_ti2v_is_local_prompt_i2v(self):
        spec = vc.spec_for(TI2V)
        self.assertEqual(spec["capability"], vc.IMAGE_TO_VIDEO)
        self.assertTrue(spec["supports_text_prompt"])
        self.assertTrue(spec["supports_image_conditioning"])
        self.assertTrue(spec["prompt_consumed"])
        self.assertTrue(spec["supports_duration_control"])
        vc.assert_mode_allowed("ai_video", TI2V)

    def test_normalize_does_not_collapse_ti2v_to_t2v(self):
        self.assertEqual(vc.normalize_model_id(TI2V), TI2V)
        self.assertEqual(vc.normalize_model_id("Wan-AI/Wan2.2-TI2V-5B"), TI2V)
        self.assertEqual(vc.normalize_model_id(WAN), WAN)

    def test_ai_video_allows_runway_and_h3(self):
        vc.assert_mode_allowed("ai_video", RUNWAY)
        vc.assert_mode_allowed("ai_video", H3)

    def test_animation_allows_svd_only(self):
        vc.assert_mode_allowed("image_animation", SVD)
        with self.assertRaises(RuntimeError):
            vc.assert_mode_allowed("image_animation", RUNWAY)

    def test_explicit_mode_wins_over_prompt_needles(self):
        mode = vc.resolve_mode(
            "image_animation",
            prompt="cinematic camera orbit around the sneaker",
            model_id=SVD,
        )
        self.assertEqual(mode, "image_animation")

    def test_unspecified_mode_with_cinematic_prompt_is_ai_video(self):
        mode = vc.resolve_mode(
            None,
            prompt="Create a commercial shot with a smooth camera push-in",
            model_id=SVD,
        )
        self.assertEqual(mode, "ai_video")
        with self.assertRaises(RuntimeError):
            vc.assert_mode_allowed(mode, SVD)

    def test_http_ai_video_rejects_svd_without_loading_weights(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.motion import router

        app = FastAPI()
        app.include_router(router, prefix="/api")
        client = TestClient(app)
        response = client.post("/api/generate/video", json={
            "prompt": "Create a commercial shot with a smooth camera push-in",
            "format": "wide",
            "model_id": SVD,
            "mode": "ai_video",
            "image_path": "/tmp/unused.png",
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("VIDEO_CAPABILITY_UNSUPPORTED", response.json()["detail"])

    def test_http_runway_without_key_is_capability_error(self):
        import tempfile
        from PIL import Image
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.motion import router

        app = FastAPI()
        app.include_router(router, prefix="/api")
        client = TestClient(app)
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as handle:
            Image.new("RGB", (64, 64), (8, 8, 8)).save(handle.name)
            still = handle.name
        response = client.post("/api/generate/video", json={
            "prompt": "slow cinematic camera push-in",
            "format": "wide",
            "model_id": RUNWAY,
            "mode": "ai_video",
            "image_path": still,
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("VIDEO_CAPABILITY_UNSUPPORTED", response.json()["detail"])
        self.assertIn("Runway", response.json()["detail"])

    def test_http_ti2v_without_image_is_image_required(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.motion import router

        app = FastAPI()
        app.include_router(router, prefix="/api")
        client = TestClient(app)
        response = client.post("/api/generate/video", json={
            "prompt": "Slow cinematic push-in toward the sneaker",
            "format": "wide",
            "model_id": TI2V,
            "mode": "ai_video",
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("IMAGE_REQUIRED", response.json()["detail"])

    def test_http_unknown_model_is_capability_error(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.motion import router

        app = FastAPI()
        app.include_router(router, prefix="/api")
        client = TestClient(app)
        response = client.post("/api/generate/video", json={
            "prompt": "orbit",
            "format": "wide",
            "model_id": "not-a-real-video-model",
            "mode": "ai_video",
            "image_path": "/tmp/unused.png",
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("VIDEO_CAPABILITY_UNSUPPORTED", response.json()["detail"])


class Ti2vProviderTests(unittest.TestCase):
    def test_model_dir_is_canvas_models(self):
        from api import mlx_ti2v

        path = mlx_ti2v.model_dir()
        self.assertEqual(path.name, "Anes1032__Wan2.2-TI2V-5B-mlx-q8")
        self.assertIn("Canvas", str(path))
        self.assertIn("Models", str(path))

    def test_weights_ready_matches_disk(self):
        from api import mlx_ti2v

        self.assertEqual(mlx_ti2v.weights_ready(), mlx_ti2v.weights_ready(TI2V))

    def test_backend_snapshot_not_installed_or_available(self):
        from api import mlx_ti2v

        snap = mlx_ti2v.backend_snapshot(
            job_active=False,
            job_stage="idle",
            job_model_id="",
            job_error=None,
        )
        self.assertEqual(snap["id"], TI2V)
        self.assertIn(snap["state"], ("NOT_INSTALLED", "AVAILABLE"))
        if snap["installed"]:
            self.assertEqual(snap["state"], "AVAILABLE")
            self.assertGreater(snap["approx_bytes"], 0)
        else:
            self.assertEqual(snap["state"], "NOT_INSTALLED")
            self.assertEqual(snap["approx_bytes"], 0)

    def test_backend_snapshot_generating(self):
        from api import mlx_ti2v

        snap = mlx_ti2v.backend_snapshot(
            job_active=True,
            job_stage="infer",
            job_model_id=TI2V,
            job_error=None,
        )
        self.assertEqual(snap["state"], "GENERATING")

    def test_run_ti2v_unloads_pytorch_before_worker(self):
        from unittest.mock import patch
        from PIL import Image, ImageDraw
        from api.motion import VideoGenRequest, _run_ti2v

        frames = []
        for i in range(8):
            img = Image.new("RGB", (64, 64), (20, 20, 20))
            draw = ImageDraw.Draw(img)
            draw.rectangle((i * 4, 16, i * 4 + 20, 48), fill=(200, 40, 40))
            frames.append(img)
        request = VideoGenRequest(
            prompt="orbit",
            model_id=TI2V,
            image_path="/tmp/sneaker.png",
            mode="ai_video",
        )
        with patch("api.generation._unload_all_models", return_value=2) as unload, \
             patch("api.mlx_ti2v.run_ti2v") as run, \
             patch("api.mlx_ti2v.extract_frames", return_value=frames), \
             patch("os.path.isfile", return_value=True), \
             patch("PIL.Image.open", return_value=frames[0]):
            dest, quality = _run_ti2v(request, "vid_test")
        unload.assert_called_once()
        run.assert_called_once()
        self.assertFalse(quality["low_motion"])
        self.assertTrue(dest.endswith("vid_test.mp4"))

    def test_missing_weights_does_not_start_worker(self):
        from unittest.mock import patch
        from api import mlx_ti2v

        with patch.object(mlx_ti2v, "weights_ready", return_value=False), \
             patch.object(mlx_ti2v, "mlx_python") as python:
            with self.assertRaises(RuntimeError) as caught:
                mlx_ti2v.run_ti2v(
                    image_path=__file__,
                    prompt="orbit",
                    dest="/tmp/out.mp4",
                )
        python.assert_not_called()
        self.assertIn("VIDEO_MODEL_MISSING", str(caught.exception))

    def test_percent_from_log(self):
        from api.mlx_ti2v import _percent_from_log

        self.assertEqual(_percent_from_log("Loading T5 encoder...", 12), 16)
        self.assertGreaterEqual(_percent_from_log("Diffusion:  50%|", 42), 60)


class MotionQualityTests(unittest.TestCase):
    def test_static_frames_are_low_motion(self):
        from PIL import Image
        from api.motion import _identity_vs_source, _motion_report

        still = Image.new("RGB", (64, 64), (12, 40, 90))
        frames = [still.copy() for _ in range(14)]
        report = _motion_report(frames, fps=7)
        self.assertEqual(report["frame_count"], 14)
        self.assertEqual(report["fps"], 7)
        self.assertAlmostEqual(report["duration_sec"], 2.0)
        self.assertTrue(report["low_motion"])
        identity = _identity_vs_source(still, frames)
        self.assertFalse(identity["identity_warning"])

    def test_moving_frames_are_not_low_motion(self):
        from PIL import Image, ImageDraw
        from api.motion import _motion_report

        frames = []
        for i in range(14):
            img = Image.new("RGB", (64, 64), (20, 20, 20))
            draw = ImageDraw.Draw(img)
            draw.rectangle((i * 3, 20, i * 3 + 18, 44), fill=(220, 40, 40))
            frames.append(img)
        report = _motion_report(frames, fps=7)
        self.assertFalse(report["low_motion"])
        self.assertGreater(report["motion_mae"], 4.0)

    def test_identity_warning_when_first_frame_is_a_different_object(self):
        from PIL import Image
        from api.motion import _identity_vs_source

        source = Image.new("RGB", (64, 64), (10, 10, 10))
        other = Image.new("RGB", (64, 64), (240, 240, 240))
        identity = _identity_vs_source(source, [other, other])
        self.assertTrue(identity["identity_warning"])

    def test_identity_warning_when_last_frame_collapses(self):
        from PIL import Image
        from api.motion import _identity_vs_source

        source = Image.new("RGB", (64, 64), (12, 40, 90))
        first = source.copy()
        last = Image.new("RGB", (64, 64), (240, 240, 240))
        identity = _identity_vs_source(source, [first, first, last])
        self.assertTrue(identity["identity_warning"])
        self.assertGreaterEqual(identity["identity_mae_last"], 32.0)


if __name__ == "__main__":
    unittest.main()
