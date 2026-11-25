"""Seedance 2.5 image→video cloud provider via fal.ai / direct API."""
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

FAL_QUEUE_API = "https://queue.fal.run"


def _image_data_uri(path: str) -> str:
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
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _request(method: str, url: str, api_key: str, body: dict | None = None, timeout: int = 120) -> Any:
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=payload,
        method=method,
        headers={
            "Authorization": f"Key {api_key}",
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
            raise RuntimeError("SEEDANCE_AUTH: Check the fal.ai / Seedance API key in Settings.") from err
        if err.code == 429:
            raise RuntimeError("SEEDANCE_RATE: Rate limit reached — wait and retry.") from err
        raise RuntimeError(f"SEEDANCE_HTTP_{err.code}: {raw}") from err


def _download(url: str, dest: str) -> None:
    req = urllib.request.Request(url, method="GET", headers={"Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=180) as resp, open(dest, "wb") as out:
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            out.write(chunk)


def run_seedance(*, image_path: str, prompt: str, fmt: str, duration_sec: float, api_key: str, job_id: str) -> str:
    key = (api_key or "").strip()
    if not key:
        raise RuntimeError("SEEDANCE_KEY_REQUIRED: Add a fal.ai / Seedance key in Settings.")

    generation.set_runtime_job(
        model_id="seedance/seedance-2.5",
        stage="upload",
        prompt=prompt,
        format=fmt,
        job_id=job_id,
    )
    image_uri = _image_data_uri(image_path)
    aspect = "9:16" if fmt in ("portrait", "shorts") else "16:9"

    # fal-ai Seedance endpoint
    endpoint = f"{FAL_QUEUE_API}/fal-ai/bytedance/seedance-2.5"
    body = {
        "prompt": campaign_prompt(prompt),
        "image_url": image_uri,
        "duration": max(4, min(15, int(round(duration_sec or 5)))),
        "aspect_ratio": aspect,
    }

    try:
        res = _request("POST", endpoint, key, body=body)
    except Exception as err:
        generation.clear_runtime_job(error=str(err)[:240])
        raise

    req_id = res.get("request_id")
    status_url = res.get("status_url") or (f"{endpoint}/requests/{req_id}/status" if req_id else None)
    response_url = res.get("response_url") or (f"{endpoint}/requests/{req_id}" if req_id else None)

    if not status_url:
        msg = res.get("detail") or "SEEDANCE_SUBMIT_FAILED"
        generation.clear_runtime_job(error=str(msg)[:240])
        raise RuntimeError(f"SEEDANCE_SUBMIT_FAILED: {msg}")

    deadline = time.time() + 60 * 15
    poll_sec = 3.0
    video_url = None

    while time.time() < deadline:
        time.sleep(poll_sec)
        try:
            status_res = _request("GET", status_url, key)
        except Exception:
            continue

        st = (status_res.get("status") or "").upper()
        if st == "COMPLETED":
            resp_data = _request("GET", response_url or status_url, key)
            video = resp_data.get("video") or {}
            video_url = video.get("url") if isinstance(video, dict) else resp_data.get("video_url")
            break
        elif st in ("FAILED", "ERROR"):
            msg = status_res.get("error") or "Task failed on Seedance"
            generation.clear_runtime_job(error=str(msg)[:240])
            raise RuntimeError(f"SEEDANCE_FAILED: {msg}")

        generation.set_runtime_job(
            model_id="seedance/seedance-2.5",
            stage="sampling",
            percent=50,
            prompt=prompt,
            format=fmt,
            job_id=job_id,
        )

    if not video_url:
        generation.clear_runtime_job(error="Seedance timed out")
        raise RuntimeError("SEEDANCE_TIMEOUT: Generation did not complete in 15 minutes.")

    from canvas_paths import canvas_join
    dest = canvas_join("Generated", "Video", f"{job_id}.mp4")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    _download(video_url, dest)
    generation.clear_runtime_job()
    return dest
