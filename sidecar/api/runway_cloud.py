"""Runway Dev Gen-4.5 image→video. This is the ad-quality path, not local SVD/Wan."""
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

RUNWAY_API = "https://api.dev.runwayml.com"
RUNWAY_VERSION = "2024-11-06"
RUNWAY_MODEL = "gen4.5"

AD_LOCK = (
    "Cinematic luxury product commercial, advertising film, not a slideshow. "
    "Keep the product from the reference image as the hero — same silhouette, materials, color. "
    "Slow dolly-in and a slight orbit, premium studio or boutique light, tactile close detail. "
    "No invented people, no faces, no offices, no laptops, no on-screen text, no watermark, no morphing."
)


def campaign_prompt(user: str) -> str:
    body = (user or "").strip()
    text = f"{AD_LOCK}\n\n{body}" if body else AD_LOCK
    return text[:980]


def _ratio(fmt: str) -> str:
    if fmt in ("portrait", "shorts"):
        return "720:1280"
    return "1280:720"


def _duration(sec: float) -> int:
    return max(5, min(10, int(round(float(sec) or 5))))


def _image_data_uri(path: str) -> str:
    from PIL import Image

    if not path or not os.path.isfile(path):
        raise RuntimeError("IMAGE_REQUIRED: Import a product photo into the scene first.")
    image = Image.open(path).convert("RGB")
    w, h = image.size
    longest = max(w, h)
    if longest > 1280:
        scale = 1280 / longest
        image = image.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    buf = BytesIO()
    image.save(buf, format="JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _request(method: str, path: str, api_key: str, body: dict | None = None, timeout: int = 120) -> Any:
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        f"{RUNWAY_API}{path}",
        data=payload,
        method=method,
        headers={
            "Authorization": f"Bearer {api_key}",
            "X-Runway-Version": RUNWAY_VERSION,
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
            raise RuntimeError("RUNWAY_AUTH: Check the Runway API key in Settings.") from err
        if err.code == 429:
            raise RuntimeError("RUNWAY_RATE: Runway rate limit — wait and retry.") from err
        raise RuntimeError(f"RUNWAY_HTTP_{err.code}: {raw}") from err


def _failure_text(task: dict) -> str:
    fail = task.get("failure") or task.get("error") or task.get("failureCode") or "RUNWAY_FAILED"
    if isinstance(fail, dict):
        return str(fail.get("message") or fail.get("detail") or fail)[:240]
    return str(fail)[:240]


def _progress_pct(task: dict) -> int:
    prog = task.get("progress")
    if prog is None:
        return 12
    try:
        value = float(prog)
    except (TypeError, ValueError):
        return 12
    if value <= 1.0:
        value *= 100
    return max(8, min(90, int(value)))


def _download(url: str, dest: str) -> None:
    req = urllib.request.Request(url, method="GET", headers={"Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=180) as resp, open(dest, "wb") as out:
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            out.write(chunk)


def run_runway(*, image_path: str, prompt: str, fmt: str, duration_sec: float, api_key: str, job_id: str) -> str:
    key = (api_key or "").strip()
    if not key:
        raise RuntimeError("RUNWAY_KEY_REQUIRED: Add a Runway API key in Settings.")

    generation.set_runtime_job(
        active=True,
        kind="video",
        stage="upload",
        percent=4,
        detail="Runway Gen-4.5",
        model_id="runwayml/gen4.5",
        started_at=time.time(),
        error=None,
        cancel=False,
    )
    image = _image_data_uri(image_path)
    body = {
        "model": RUNWAY_MODEL,
        "promptImage": image,
        "promptText": campaign_prompt(prompt),
        "ratio": _ratio(fmt),
        "duration": _duration(duration_sec),
    }
    generation.set_runtime_job(stage="queue", percent=8, detail="Runway")
    created = _request("POST", "/v1/image_to_video", key, body)
    task_id = created.get("id")
    if not task_id:
        raise RuntimeError("RUNWAY_FAILED: No task id from Runway.")

    while True:
        if generation.runtime_should_cancel():
            try:
                _request("DELETE", f"/v1/tasks/{task_id}", key, None)
            except Exception:
                pass
            raise RuntimeError("CANCELLED")
        task = _request("GET", f"/v1/tasks/{task_id}", key)
        status = str(task.get("status") or "").upper()
        generation.set_runtime_job(stage="infer", percent=_progress_pct(task), detail=f"Runway {status}")
        if status == "SUCCEEDED":
            outputs = task.get("output") or []
            url = outputs[0] if outputs else None
            if isinstance(url, dict):
                url = url.get("uri") or url.get("url")
            if not url:
                raise RuntimeError("RUNWAY_FAILED: Task succeeded without a video URL.")
            dest_dir = os.path.expanduser("~/Documents/Canvas/Generated/Video")
            os.makedirs(dest_dir, exist_ok=True)
            dest = os.path.join(dest_dir, f"{job_id}.mp4")
            generation.set_runtime_job(stage="download", percent=94, detail="Runway")
            _download(str(url), dest)
            if not os.path.isfile(dest) or os.path.getsize(dest) < 1000:
                raise RuntimeError("RUNWAY_FAILED: Downloaded file is empty.")
            generation.set_runtime_job(active=False, stage="idle", percent=100, detail="done")
            print(f"[{job_id}] Runway saved {dest}", flush=True)
            return dest
        if status in ("FAILED", "CANCELLED", "CANCELED"):
            raise RuntimeError(_failure_text(task))
        time.sleep(2)
