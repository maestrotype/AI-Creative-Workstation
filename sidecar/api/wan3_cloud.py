"""Wan 3.0 image→video via Alibaba DashScope / Qwen Cloud (API-only, no local weights)."""
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

# International Qwen Cloud MaaS (no workspace id). Override with WAN3_BASE_URL if needed.
DEFAULT_BASE = "https://ap-southeast-1.maas.qwencloudapi.com/api/v1"
CN_BASE = "https://dashscope.aliyuncs.com/api/v1"


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


def _base_url() -> str:
    custom = (os.environ.get("WAN3_BASE_URL") or "").strip().rstrip("/")
    if custom:
        return custom
    region = (os.environ.get("DASHSCOPE_REGION") or "intl").strip().lower()
    if region in ("cn", "beijing", "china"):
        return CN_BASE
    return DEFAULT_BASE


def _request(method: str, url: str, api_key: str, body: dict | None = None, timeout: int = 120) -> Any:
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if method.upper() == "POST":
        headers["X-DashScope-Async"] = "enable"
    req = urllib.request.Request(url, data=payload, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", "replace")[:600]
        if err.code in (401, 403):
            raise RuntimeError("WAN3_AUTH: Check the DashScope / Qwen Cloud API key in Settings.") from err
        if err.code == 429:
            raise RuntimeError("WAN3_RATE: Wan 3.0 rate limit — wait and retry.") from err
        raise RuntimeError(f"WAN3_HTTP_{err.code}: {raw}") from err


def _download(url: str, dest: str) -> None:
    req = urllib.request.Request(url, method="GET", headers={"Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=180) as resp, open(dest, "wb") as out:
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            out.write(chunk)


def run_wan3(
    *,
    image_path: str,
    prompt: str,
    fmt: str,
    duration_sec: float,
    api_key: str,
    job_id: str,
    model_name: str = "wan3.0-video",
) -> str:
    key = (api_key or "").strip()
    if not key:
        raise RuntimeError("WAN3_KEY_REQUIRED: Add a DashScope / Qwen Cloud API key in Settings (DASHSCOPE_API_KEY).")

    generation.set_runtime_job(
        model_id="alibaba/wan3.0-video",
        stage="upload",
        prompt=prompt,
        format=fmt,
        job_id=job_id,
    )

    image_uri = _image_data_uri(image_path)
    ratio = "9:16" if fmt in ("portrait", "shorts") else ("1:1" if fmt == "square" else "16:9")
    duration = max(2, min(30, int(round(duration_sec or 5))))
    base = _base_url()
    submit_url = f"{base}/services/aigc/video-generation/video-synthesis"

    body = {
        "model": model_name or "wan3.0-video",
        "input": {
            "prompt": campaign_prompt(prompt),
            "media": [{"type": "first_frame", "url": image_uri}],
        },
        "parameters": {
            "resolution": "720P",
            "ratio": ratio,
            "duration": duration,
            "prompt_extend": True,
            "audio": False,
        },
    }

    try:
        res = _request("POST", submit_url, key, body=body)
    except Exception as err:
        generation.clear_runtime_job(error=str(err)[:240])
        raise

    output = res.get("output") if isinstance(res.get("output"), dict) else {}
    task_id = output.get("task_id") or res.get("task_id")
    if not task_id:
        msg = res.get("message") or res.get("code") or "WAN3_SUBMIT_FAILED"
        generation.clear_runtime_job(error=str(msg)[:240])
        raise RuntimeError(f"WAN3_SUBMIT_FAILED: {msg}")

    generation.set_runtime_job(stage="infer", percent=15, detail=f"Wan 3.0 task {task_id[:8]}")
    poll_url = f"{base}/tasks/{task_id}"
    deadline = time.time() + 60 * 20
    video_url = None

    while time.time() < deadline:
        time.sleep(3.0)
        try:
            status_res = _request("GET", poll_url, key)
        except Exception:
            continue
        out = status_res.get("output") if isinstance(status_res.get("output"), dict) else {}
        st = (out.get("task_status") or status_res.get("task_status") or "").upper()
        if st in ("PENDING", "RUNNING", "UNKNOWN", ""):
            generation.set_runtime_job(stage="infer", percent=35, detail=f"Wan 3.0 {st or '…'}")
            continue
        if st == "SUCCEEDED":
            video_url = (
                out.get("video_url")
                or out.get("url")
                or (out.get("results") or [{}])[0].get("url")
                or (out.get("video") or {}).get("url")
            )
            if not video_url and isinstance(out.get("results"), list):
                for item in out["results"]:
                    if isinstance(item, dict) and item.get("url"):
                        video_url = item["url"]
                        break
            break
        if st in ("FAILED", "CANCELED"):
            msg = out.get("message") or status_res.get("message") or st
            generation.clear_runtime_job(error=str(msg)[:240])
            raise RuntimeError(f"WAN3_FAILED: {msg}")

    if not video_url:
        generation.clear_runtime_job(error="WAN3_TIMEOUT")
        raise RuntimeError("WAN3_TIMEOUT: Wan 3.0 did not return a video in time.")

    dest_dir = os.path.expanduser("~/Documents/Canvas/Generated/Video")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, f"{job_id}.mp4")
    generation.set_runtime_job(stage="download", percent=90, detail="Wan 3.0 download")
    _download(video_url, dest)
    generation.clear_runtime_job()
    return dest
