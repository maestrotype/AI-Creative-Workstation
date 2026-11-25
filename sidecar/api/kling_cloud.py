"""Kling AI (kling-4.0) image→video cloud provider."""
from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request
from io import BytesIO
from typing import Any

from api import generation
from api.runway_cloud import campaign_prompt

KLING_API = "https://api.klingai.com/v1"


def _image_base64(path: str) -> str:
    from PIL import Image

    if not path or not os.path.isfile(path):
        raise RuntimeError("IMAGE_REQUIRED: Import a product photo first.")
    image = Image.open(path).convert("RGB")
    w, h = image.size
    longest = max(w, h)
    if longest > 1920:
        scale = 1920 / longest
        image = image.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    buf = BytesIO()
    image.save(buf, format="JPEG", quality=92)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _request(method: str, path: str, api_key: str, body: dict | None = None, timeout: int = 120) -> Any:
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    url = f"{KLING_API}{path}"
    req = urllib.request.Request(
        url,
        data=payload,
        method=method,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", "replace")[:600]
        if err.code in (401, 403):
            raise RuntimeError("KLING_AUTH: Check the Kling API key in Settings.") from err
        if err.code == 429:
            raise RuntimeError("KLING_RATE: Kling rate limit — wait and retry.") from err
        raise RuntimeError(f"KLING_HTTP_{err.code}: {raw}") from err


def _download(url: str, dest: str) -> None:
    req = urllib.request.Request(url, method="GET", headers={"Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=180) as resp, open(dest, "wb") as out:
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            out.write(chunk)


def run_kling(*, image_path: str, prompt: str, fmt: str, duration_sec: float, api_key: str, job_id: str) -> str:
    key = (api_key or "").strip()
    if not key:
        raise RuntimeError("KLING_KEY_REQUIRED: Add a Kling API key in Settings.")

    generation.set_runtime_job(
        model_id="kling-ai/kling-4.0",
        stage="upload",
        prompt=prompt,
        format=fmt,
        job_id=job_id,
    )
    image_b64 = _image_base64(image_path)
    dur = "10" if (duration_sec or 5) > 6 else "5"

    body = {
        "model_name": "kling-v1-6",
        "image": image_b64,
        "prompt": campaign_prompt(prompt),
        "duration": dur,
        "mode": "std",
        "cfg_scale": 0.5,
    }

    try:
        res = _request("POST", "/videos/image2video", key, body=body)
    except Exception as err:
        generation.clear_runtime_job(error=str(err)[:240])
        raise

    data = res.get("data") or {}
    task_id = data.get("task_id") or res.get("task_id")
    if not task_id:
        msg = res.get("message") or "KLING_SUBMIT_FAILED"
        generation.clear_runtime_job(error=str(msg)[:240])
        raise RuntimeError(f"KLING_SUBMIT_FAILED: {msg}")

    deadline = time.time() + 60 * 20
    poll_sec = 4.0
    video_url = None

    while time.time() < deadline:
        time.sleep(poll_sec)
        try:
            status_res = _request("GET", f"/videos/image2video/{task_id}", key)
        except Exception:
            continue

        st_data = status_res.get("data") or {}
        st = (st_data.get("task_status") or "").lower()

        if st == "succeed":
            videos = (st_data.get("task_result") or {}).get("videos") or []
            if videos and isinstance(videos, list):
                video_url = videos[0].get("url")
            break
        elif st in ("failed", "error"):
            msg = st_data.get("task_status_msg") or "Task failed on Kling"
            generation.clear_runtime_job(error=str(msg)[:240])
            raise RuntimeError(f"KLING_FAILED: {msg}")

        generation.set_runtime_job(
            model_id="kling-ai/kling-4.0",
            stage="sampling",
            percent=45,
            prompt=prompt,
            format=fmt,
            job_id=job_id,
        )

    if not video_url:
        generation.clear_runtime_job(error="Kling timed out")
        raise RuntimeError("KLING_TIMEOUT: Generation did not complete in 20 minutes.")

    from canvas_paths import canvas_join
    dest = canvas_join("Generated", "Video", f"{job_id}.mp4")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    _download(video_url, dest)
    generation.clear_runtime_job()
    return dest
