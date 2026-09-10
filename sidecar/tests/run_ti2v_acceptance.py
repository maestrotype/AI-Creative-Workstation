#!/usr/bin/env python3
"""Real Wan 2.2 TI2V acceptance run. Slow. Writes JSON + MP4 under Canvas/Generated."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import mlx_ti2v  # noqa: E402

SNEAKER = Path.home() / "Documents/Canvas/PocI2V/sneaker.png"
OUT_DIR = Path.home() / "Documents/Canvas/Generated/Video/acceptance"
PROMPT_A = (
    "Create a premium ecommerce commercial shot. Slowly push the camera toward the sneaker "
    "with a subtle cinematic orbit. Preserve the exact product shape, colors, materials and "
    "proportions. Keep the product as the visual focus. No additional products or unrelated objects."
)
PROMPT_B = (
    "Slowly pull the camera back from the sneaker, revealing more negative space around the product. "
    "Preserve the exact product shape, colors, materials and proportions."
)
PROMPT_DETAIL = (
    "Close-up emphasizing material texture of the product. Slow, stable camera. "
    "Preserve the exact product shape, colors, materials and proportions."
)
PROMPT_ORBIT = (
    "Subtle cinematic orbit showing the side profile of the product. "
    "Preserve the exact product shape, colors, materials and proportions. "
    "Keep the product as the visual focus."
)


def _rss_mb() -> float:
    try:
        out = subprocess.check_output(["ps", "-A", "-o", "rss="], text=True)
        return round(sum(int(x) for x in out.split() if x.strip().isdigit()) / 1024, 1)
    except Exception:
        return 0.0


def _ffprobe(path: str) -> dict:
    raw = subprocess.check_output(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,r_frame_rate,nb_frames,codec_name",
            "-show_entries", "format=duration,size", "-of", "json", path,
        ],
        text=True,
    )
    data = json.loads(raw)
    stream = (data.get("streams") or [{}])[0]
    fmt = data.get("format") or {}
    fps = stream.get("r_frame_rate") or "0/1"
    if "/" in str(fps):
        n, d = str(fps).split("/", 1)
        fps_n = float(n) / max(1.0, float(d))
    else:
        fps_n = float(fps or 0)
    return {
        "codec": stream.get("codec_name"),
        "width": stream.get("width"),
        "height": stream.get("height"),
        "fps": round(fps_n, 3),
        "nb_frames": int(stream.get("nb_frames") or 0),
        "duration_sec": round(float(fmt.get("duration") or 0), 4),
        "size_bytes": int(fmt.get("size") or 0),
    }


def run_one(*, name: str, prompt: str, num_frames: int, seed: int) -> dict:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dest = str(OUT_DIR / f"{name}.mp4")
    rss_before = _rss_mb()
    t0 = time.time()
    logs: list[str] = []

    def on_log(line: str, percent: int) -> None:
        logs.append(f"{percent:03d} {line}")

    mlx_ti2v.run_ti2v(
        image_path=str(SNEAKER),
        prompt=prompt,
        dest=dest,
        num_frames=num_frames,
        seed=seed,
        on_log=on_log,
    )
    elapsed = round(time.time() - t0, 1)
    rss_after = _rss_mb()
    probe = _ffprobe(dest)
    from api.motion import _identity_vs_source, _motion_report
    from PIL import Image

    frames = mlx_ti2v.extract_frames(dest)
    quality = _motion_report(frames, fps=mlx_ti2v.FPS)
    quality.update(_identity_vs_source(Image.open(SNEAKER), frames))
    report = {
        "name": name,
        "prompt": prompt,
        "num_frames_requested": num_frames,
        "elapsed_sec": elapsed,
        "rss_mb_before": rss_before,
        "rss_mb_after_worker_exit": rss_after,
        "probe": probe,
        "quality": quality,
        "dest": dest,
        "log_tail": logs[-12:],
    }
    (OUT_DIR / f"{name}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("name", "elapsed_sec", "probe", "quality")}, indent=2), flush=True)
    return report


def main() -> int:
    if not SNEAKER.is_file():
        print(f"missing still {SNEAKER}", file=sys.stderr)
        return 2
    if not mlx_ti2v.weights_ready():
        print("weights not ready", file=sys.stderr)
        return 2
    which = (sys.argv[1] if len(sys.argv) > 1 else "a41").lower()
    if which == "a41":
        run_one(name="prompt_a_41", prompt=PROMPT_A, num_frames=41, seed=42)
    elif which == "b41":
        run_one(name="prompt_b_41", prompt=PROMPT_B, num_frames=41, seed=42)
    elif which == "a81":
        run_one(name="prompt_a_81", prompt=PROMPT_A, num_frames=81, seed=42)
    elif which == "d41":
        run_one(name="prompt_detail_41", prompt=PROMPT_DETAIL, num_frames=41, seed=43)
    elif which == "orbit41":
        run_one(name="prompt_orbit_41", prompt=PROMPT_ORBIT, num_frames=41, seed=44)
    else:
        print("usage: run_ti2v_acceptance.py [a41|b41|a81|d41|orbit41]", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
