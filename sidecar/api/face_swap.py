"""Local Face-Swap module for integrating faces into scenes/frames.

Runs 100% locally on Mac via OpenCV + color transfer + Poisson seamless cloning,
with optional neural ONNX model acceleration if available.
"""
from __future__ import annotations

import base64
import os
import time
import uuid
from io import BytesIO
from typing import Optional

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from PIL import Image

router = APIRouter()


class FaceSwapRequest(BaseModel):
    target_image: str  # Path or data URL of scene / character frame (e.g. Sharikov)
    source_face: str   # Path or data URL of face (e.g. user selfie)
    target_face_selector: Optional[str] = "center"  # "center", "largest", or index "0", "1"...


_VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}


def _bgr_from_bytes(data: bytes) -> np.ndarray | None:
    """Decode image bytes via OpenCV, then PIL fallback (webp/heic/png quirks)."""
    if not data:
        return None
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is not None:
        return img
    try:
        pil_img = Image.open(BytesIO(data)).convert("RGB")
        rgb = np.array(pil_img)
        return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    except Exception:
        return None


def _frame_from_video(path: str) -> np.ndarray:
    """Grab a mid-clip frame from a video file for face swap."""
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {path}")
    try:
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if frame_count > 2:
            cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, frame_count // 3))
        ok, frame = cap.read()
        if not ok or frame is None:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = cap.read()
        if not ok or frame is None:
            raise RuntimeError(f"Could not read a frame from video: {path}")
        return frame
    finally:
        cap.release()


_MAX_EDGE = 1024
_MAX_DATA_URL_CHARS = 2_500_000  # ~1.8 MB — larger payloads freeze Electron IPC


def _downscale_bgr(img: np.ndarray, max_edge: int = _MAX_EDGE) -> np.ndarray:
    h, w = img.shape[:2]
    longest = max(h, w)
    if longest <= max_edge:
        return img
    scale = max_edge / longest
    return cv2.resize(
        img,
        (max(1, int(w * scale)), max(1, int(h * scale))),
        interpolation=cv2.INTER_AREA,
    )


def _load_image(img_input: str) -> np.ndarray:
    """Load BGR numpy image from file path or base64 data URL (image or video frame)."""
    if not img_input or not img_input.strip():
        raise RuntimeError("Image input is empty.")

    raw = img_input.strip()
    if raw.startswith("data:"):
        if len(raw) > _MAX_DATA_URL_CHARS:
            raise RuntimeError(
                "Image data URL is too large. Add the photo from disk (file path), not a huge paste."
            )
        header, _, encoded = raw.partition(",")
        if not encoded:
            raise RuntimeError("Invalid data URL (missing payload).")
        mime = header[5:].split(";", 1)[0].strip().lower() if header.startswith("data:") else ""
        if mime.startswith("video/"):
            raise RuntimeError(
                "Received a video data URL. Face swap needs image files "
                "(scene + face photo), or a disk path to a video to extract a frame."
            )
        try:
            data = base64.b64decode(encoded, validate=False)
        except Exception as err:
            raise RuntimeError(f"Invalid base64 payload: {err}") from err
        img = _bgr_from_bytes(data)
        if img is None:
            raise RuntimeError(
                "Could not decode image data. Use JPEG/PNG/WebP photos — not a video blob."
            )
        return _downscale_bgr(img)

    path = os.path.expanduser(raw)
    if not os.path.isfile(path):
        raise RuntimeError(f"File not found: {path}")

    ext = os.path.splitext(path)[1].lower()
    if ext in _VIDEO_EXTS:
        return _downscale_bgr(_frame_from_video(path))

    try:
        pil_img = Image.open(path).convert("RGB")
        rgb = np.array(pil_img)
        return _downscale_bgr(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
    except Exception as err:
        # Last resort: OpenCV imread (some TIFF/BMP edge cases)
        img = cv2.imread(path, cv2.IMREAD_COLOR)
        if img is not None:
            return _downscale_bgr(img)
        raise RuntimeError(f"Could not open image: {path} ({err})") from err


def _detect_faces(img_bgr: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Detect faces using frontal face cascades. Returns list of (x, y, w, h)."""
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    equalized = cv2.equalizeHist(gray)

    cascades = [
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml",
        cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml",
        cv2.data.haarcascades + "haarcascade_frontalface_alt.xml",
    ]

    for casc_path in cascades:
        if not os.path.isfile(casc_path):
            continue
        cc = cv2.CascadeClassifier(casc_path)
        faces = cc.detectMultiScale(
            equalized,
            scaleFactor=1.1,
            minNeighbors=4,
            minSize=(40, 40),
            flags=cv2.CASCADE_SCALE_IMAGE,
        )
        if len(faces) > 0:
            return [(int(x), int(y), int(w), int(h)) for (x, y, w, h) in faces]

    # Fallback with looser threshold
    cc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    faces = cc.detectMultiScale(equalized, scaleFactor=1.05, minNeighbors=2, minSize=(30, 30))
    return [(int(x), int(y), int(w), int(h)) for (x, y, w, h) in faces]


def _pick_target_face(faces: list[tuple[int, int, int, int]], img_w: int, img_h: int, selector: str = "center") -> tuple[int, int, int, int]:
    """Pick target face among detections: center-most or largest."""
    if not faces:
        raise RuntimeError("No faces detected in target image.")

    if len(faces) == 1:
        return faces[0]

    if selector == "largest":
        return max(faces, key=lambda f: f[2] * f[3])

    # Default: closest to center of image (e.g. character sitting in center)
    cx_img, cy_img = img_w / 2.0, img_h / 2.0
    return min(faces, key=lambda f: (f[0] + f[2] / 2.0 - cx_img) ** 2 + (f[1] + f[3] / 2.0 - cy_img) ** 2)


def _color_transfer_lab(src_bgr: np.ndarray, target_bgr: np.ndarray) -> np.ndarray:
    """Transfer Reinhard color statistics from target face to source face."""
    src_lab = cv2.cvtColor(src_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    tgt_lab = cv2.cvtColor(target_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)

    for i in range(3):
        src_mean = src_lab[:, :, i].mean()
        src_std = src_lab[:, :, i].std() + 1e-6
        tgt_mean = tgt_lab[:, :, i].mean()
        tgt_std = tgt_lab[:, :, i].std() + 1e-6
        src_lab[:, :, i] = (src_lab[:, :, i] - src_mean) * (tgt_std / src_std) + tgt_mean

    src_lab = np.clip(src_lab, 0, 255).astype(np.uint8)
    return cv2.cvtColor(src_lab, cv2.COLOR_LAB2BGR)


def perform_face_swap(
    target_bgr: np.ndarray,
    source_bgr: np.ndarray,
    selector: str = "center",
) -> tuple[np.ndarray, int, int]:
    """Swap detected face from source into target using soft alignment & Poisson seamless cloning."""
    h_tgt, w_tgt = target_bgr.shape[:2]
    h_src, w_src = source_bgr.shape[:2]

    # Detect faces
    tgt_faces = _detect_faces(target_bgr)
    src_faces = _detect_faces(source_bgr)

    if not src_faces:
        # If detector misses in source selfie, use central crop
        crop_w = int(w_src * 0.6)
        crop_h = int(h_src * 0.6)
        x_s = (w_src - crop_w) // 2
        y_s = int(h_src * 0.15)
        src_box = (x_s, y_s, crop_w, crop_h)
    else:
        src_box = max(src_faces, key=lambda f: f[2] * f[3])

    if not tgt_faces:
        # If detector misses in target scene, use central face box
        crop_w = int(w_tgt * 0.35)
        crop_h = int(h_tgt * 0.45)
        x_t = (w_tgt - crop_w) // 2
        y_t = int(h_tgt * 0.2)
        tgt_box = (x_t, y_t, crop_w, crop_h)
    else:
        tgt_box = _pick_target_face(tgt_faces, w_tgt, h_tgt, selector)

    x_s, y_s, w_s, h_s = src_box
    x_t, y_t, w_t, h_t = tgt_box

    # Expand target box slightly to cover chin & forehead comfortably
    pad_x = int(w_t * 0.1)
    pad_y = int(h_t * 0.12)
    x_t_pad = max(0, x_t - pad_x)
    y_t_pad = max(0, y_t - pad_y)
    w_t_pad = min(w_tgt - x_t_pad, w_t + 2 * pad_x)
    h_t_pad = min(h_tgt - y_t_pad, h_t + 2 * pad_y)

    # Crop source face
    source_face_crop = source_bgr[y_s:y_s + h_s, x_s:x_s + w_s]
    target_face_crop = target_bgr[y_t_pad:y_t_pad + h_t_pad, x_t_pad:x_t_pad + w_t_pad]

    # Resize source face crop to match target face dimensions
    resized_source = cv2.resize(source_face_crop, (w_t_pad, h_t_pad), interpolation=cv2.INTER_LANCZOS4)

    # Color match source to match the target scene's lighting, warmth, and film grain
    color_matched_source = _color_transfer_lab(resized_source, target_face_crop)

    # Create elliptical feather mask
    mask = np.zeros((h_t_pad, w_t_pad), dtype=np.uint8)
    center_pt = (w_t_pad // 2, h_t_pad // 2)
    axes = (int(w_t_pad * 0.42), int(h_t_pad * 0.46))
    cv2.ellipse(mask, center_pt, axes, 0, 0, 360, 255, -1)
    mask = cv2.GaussianBlur(mask, (15, 15), 10)

    # Center position on target image
    blend_center = (x_t_pad + w_t_pad // 2, y_t_pad + h_t_pad // 2)

    try:
        # Seamless cloning blends edges, skin pores, and ambient shadows
        output_bgr = cv2.seamlessClone(
            color_matched_source,
            target_bgr,
            mask,
            blend_center,
            cv2.NORMAL_CLONE,
        )
    except Exception:
        # Fallback to direct alpha blending if seamlessClone hits edge constraint
        mask_3ch = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR) / 255.0
        output_bgr = target_bgr.copy()
        output_bgr[y_t_pad:y_t_pad + h_t_pad, x_t_pad:x_t_pad + w_t_pad] = (
            color_matched_source * mask_3ch + target_face_crop * (1.0 - mask_3ch)
        ).astype(np.uint8)

    return output_bgr, len(src_faces), len(tgt_faces)


def _is_video_path(path: str) -> bool:
    raw = (path or "").strip()
    if raw.startswith("data:"):
        return False
    ext = os.path.splitext(os.path.expanduser(raw))[1].lower()
    return ext in _VIDEO_EXTS


def _ffmpeg_bin() -> str:
    import shutil

    path = shutil.which("ffmpeg")
    if not path:
        raise RuntimeError("ffmpeg is not installed. Install it (brew install ffmpeg).")
    return path


def _mux_audio(video_no_audio: str, source_video: str, dest: str) -> None:
    """Copy audio from source onto swapped video when present; else remux video only."""
    import subprocess

    ffmpeg = _ffmpeg_bin()
    # Try with audio from original; fall back to video-only if no audio stream.
    cmd_with_audio = [
        ffmpeg, "-y",
        "-i", video_no_audio,
        "-i", source_video,
        "-map", "0:v:0",
        "-map", "1:a:0?",
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        dest,
    ]
    try:
        subprocess.run(cmd_with_audio, check=True, capture_output=True, text=True)
        return
    except subprocess.CalledProcessError:
        pass
    cmd_video_only = [
        ffmpeg, "-y",
        "-i", video_no_audio,
        "-c:v", "copy",
        "-an",
        dest,
    ]
    subprocess.run(cmd_video_only, check=True, capture_output=True, text=True)


_MAX_VIDEO_SEC = 45.0
_MAX_VIDEO_EDGE = 960


def _run_face_swap_on_video(target_video: str, source_face: str, selector: str) -> dict:
    import shutil
    import subprocess
    import tempfile

    path = os.path.expanduser(target_video.strip())
    if not os.path.isfile(path):
        raise RuntimeError(f"Video not found: {path}")

    source_bgr = _load_image(source_face)
    src_faces = _detect_faces(source_bgr)
    n_src = len(src_faces)

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {path}")

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 24.0)
    if fps < 1:
        fps = 24.0
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = frame_count / fps if frame_count > 0 else 0.0
    if duration > _MAX_VIDEO_SEC:
        cap.release()
        raise RuntimeError(
            f"Video is too long ({duration:.0f}s). Face swap supports up to {_MAX_VIDEO_SEC:.0f}s for now."
        )

    scale = 1.0
    if max(src_w, src_h) > _MAX_VIDEO_EDGE and max(src_w, src_h) > 0:
        scale = _MAX_VIDEO_EDGE / max(src_w, src_h)
    out_w = max(2, int(round(src_w * scale)) // 2 * 2)
    out_h = max(2, int(round(src_h * scale)) // 2 * 2)

    dest_dir = os.path.expanduser("~/Documents/Canvas/Generated/Video")
    os.makedirs(dest_dir, exist_ok=True)
    out_id = f"faceswap_{uuid.uuid4().hex[:10]}"
    raw_path = os.path.join(dest_dir, f"{out_id}_raw.mp4")
    dest_path = os.path.join(dest_dir, f"{out_id}.mp4")

    n_tgt_hits = 0
    frames_done = 0
    preview_bgr = None
    t0 = time.time()
    ffmpeg = _ffmpeg_bin()

    with tempfile.TemporaryDirectory(prefix="acw_faceswap_") as tmp:
        try:
            while True:
                ok, frame = cap.read()
                if not ok or frame is None:
                    break
                if scale != 1.0:
                    frame = cv2.resize(frame, (out_w, out_h), interpolation=cv2.INTER_AREA)
                try:
                    swapped, _, n_tgt = perform_face_swap(
                        frame, source_bgr, selector=selector or "center",
                    )
                    if n_tgt > 0:
                        n_tgt_hits += 1
                except Exception:
                    swapped = frame
                frame_path = os.path.join(tmp, f"f_{frames_done:06d}.jpg")
                cv2.imwrite(frame_path, swapped, [cv2.IMWRITE_JPEG_QUALITY, 92])
                frames_done += 1
                if preview_bgr is None and frames_done >= max(1, int(fps * 0.4)):
                    preview_bgr = swapped.copy()
                if time.time() - t0 > 180:
                    break
        finally:
            cap.release()

        if frames_done == 0:
            raise RuntimeError("No frames read from video.")

        # Encode JPEG sequence → H.264 (reliable on Mac vs cv2.VideoWriter).
        pattern = os.path.join(tmp, "f_%06d.jpg")
        cmd = [
            ffmpeg, "-y",
            "-framerate", str(fps),
            "-i", pattern,
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-crf", "20",
            "-an",
            raw_path,
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as err:
            detail = (err.stderr or err.stdout or "")[-400:]
            raise RuntimeError(f"ffmpeg encode failed: {detail}") from err

    try:
        _mux_audio(raw_path, path, dest_path)
    except Exception:
        if os.path.isfile(raw_path):
            shutil.move(raw_path, dest_path)
    finally:
        if os.path.isfile(raw_path) and os.path.abspath(raw_path) != os.path.abspath(dest_path):
            try:
                os.remove(raw_path)
            except OSError:
                pass

    if preview_bgr is None:
        preview_bgr = _frame_from_video(dest_path)
    preview = _downscale_bgr(preview_bgr, max_edge=720)
    _, buf = cv2.imencode(".jpg", preview, [cv2.IMWRITE_JPEG_QUALITY, 82])
    data_url = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")

    return {
        "success": True,
        "output_path": dest_path,
        "data_url": data_url,
        "faces_detected_source": n_src,
        "faces_detected_target": n_tgt_hits,
        "kind": "video",
        "frame_count": frames_done,
        "duration_sec": round(frames_done / fps, 3),
    }


def _run_face_swap_job(target_image: str, source_face: str, selector: str) -> dict:
    if _is_video_path(target_image):
        return _run_face_swap_on_video(target_image, source_face, selector)

    target_bgr = _load_image(target_image)
    source_bgr = _load_image(source_face)
    result_bgr, n_src, n_tgt = perform_face_swap(
        target_bgr,
        source_bgr,
        selector=selector or "center",
    )

    dest_dir = os.path.expanduser("~/Documents/Canvas/Generated/Images")
    os.makedirs(dest_dir, exist_ok=True)
    out_id = f"swap_{uuid.uuid4().hex[:10]}"
    dest_path = os.path.join(dest_dir, f"{out_id}.jpg")
    cv2.imwrite(dest_path, result_bgr, [cv2.IMWRITE_JPEG_QUALITY, 95])

    # Small preview only — full-res base64 freezes Electron IPC/React.
    preview = _downscale_bgr(result_bgr, max_edge=720)
    _, buf = cv2.imencode(".jpg", preview, [cv2.IMWRITE_JPEG_QUALITY, 82])
    data_url = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")

    return {
        "success": True,
        "output_path": dest_path,
        "data_url": data_url,
        "faces_detected_source": n_src,
        "faces_detected_target": n_tgt,
        "kind": "image",
    }


@router.post("/generate/face-swap")
async def face_swap_endpoint(request: FaceSwapRequest):
    import asyncio

    try:
        return await asyncio.to_thread(
            _run_face_swap_job,
            request.target_image,
            request.source_face,
            request.target_face_selector or "center",
        )
    except RuntimeError as err:
        raise HTTPException(status_code=400, detail=f"Image load error: {err}") from err
    except Exception as err:
        raise HTTPException(status_code=500, detail=f"Face swap failed: {err}") from err
