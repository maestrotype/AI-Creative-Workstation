#!/usr/bin/env python3
"""Sequential 41 / 81 / 121 Wan TI2V runs on this Mac. One job at a time.

Records wall time, worker RSS peak, MLX peak, ffprobe, motion/identity, and
semantic camera adherence. Does not run three Wan jobs in parallel.
"""
from __future__ import annotations

import json
import os
import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import mlx_ti2v  # noqa: E402
from tests.run_ti2v_acceptance import (  # noqa: E402
    OUT_DIR,
    PROMPT_A,
    SNEAKER,
    _ffprobe,
    run_one,
)
from tests.ti2v_semantic import score_adherence  # noqa: E402

SCALE_FRAMES = (41, 81, 121)
SUMMARY = OUT_DIR / "scale_summary.json"


def _semantic(dest: str, intent: str, motion_mae: float | None) -> dict:
    frames = mlx_ti2v.extract_frames(dest)
    try:
        return score_adherence(intent=intent, frames=frames, motion_mae=motion_mae)
    finally:
        del frames


def _score_existing() -> list[dict]:
    rows = []
    cases = (
        ("prompt_a_41.mp4", "push", "existing A push+orbit"),
        ("prompt_b_41.mp4", "pull", "existing B pull-back"),
        ("prompt_orbit_41.mp4", "orbit", "existing orbit"),
        ("prompt_detail_41.mp4", "push", "existing detail/push"),
    )
    for name, intent, label in cases:
        path = OUT_DIR / name
        meta = OUT_DIR / name.replace(".mp4", ".json")
        if not path.is_file():
            rows.append({"name": label, "status": "MISSING", "path": str(path)})
            continue
        motion = None
        if meta.is_file():
            try:
                motion = json.loads(meta.read_text(encoding="utf-8")).get("quality", {}).get("motion_mae")
            except json.JSONDecodeError:
                motion = None
        try:
            scored = _semantic(str(path), intent, motion)
            scored["name"] = label
            scored["status"] = "TESTED"
            scored["path"] = str(path)
            rows.append(scored)
            print(json.dumps({k: scored[k] for k in ("name", "pass", "measured", "expected", "scale_delta", "shift_x")}, indent=2), flush=True)
        except Exception as err:  # noqa: BLE001
            rows.append({"name": label, "status": "ERROR", "error": str(err), "path": str(path)})
    return rows


def run_scale() -> dict:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cases = []
    for n in SCALE_FRAMES:
        name = f"scale_a_{n}"
        print(f"\n=== SCALE {n} frames ===", flush=True)
        t0 = time.time()
        try:
            report = run_one(name=name, prompt=PROMPT_A, num_frames=n, seed=42)
            report["peak_worker_rss_mb"] = mlx_ti2v.LAST_RUN.get("peak_worker_rss_mb")
            report["peak_mlx_gb"] = mlx_ti2v.LAST_RUN.get("peak_mlx_gb")
            dest = report["dest"]
            mae = (report.get("quality") or {}).get("motion_mae")
            report["semantic"] = _semantic(dest, "push", mae)
            report["status"] = "TESTED"
            report["wall_sec"] = round(time.time() - t0, 1)
            cases.append(report)
            print(
                json.dumps(
                    {
                        "name": name,
                        "status": "TESTED",
                        "elapsed_sec": report.get("elapsed_sec"),
                        "peak_worker_rss_mb": report.get("peak_worker_rss_mb"),
                        "peak_mlx_gb": report.get("peak_mlx_gb"),
                        "probe": report.get("probe"),
                        "quality": report.get("quality"),
                        "semantic": report.get("semantic"),
                    },
                    indent=2,
                ),
                flush=True,
            )
        except Exception as err:  # noqa: BLE001
            failed = {
                "name": name,
                "status": "FAILED",
                "num_frames_requested": n,
                "error": str(err)[-800:],
                "traceback": traceback.format_exc()[-1200:],
                "peak_worker_rss_mb": mlx_ti2v.LAST_RUN.get("peak_worker_rss_mb"),
                "peak_mlx_gb": mlx_ti2v.LAST_RUN.get("peak_mlx_gb"),
                "returncode": mlx_ti2v.LAST_RUN.get("returncode"),
                "wall_sec": round(time.time() - t0, 1),
            }
            cases.append(failed)
            print(json.dumps(failed, indent=2), flush=True)
            killed = mlx_ti2v.LAST_RUN.get("returncode") in (-9, 9, 137) or "OOM" in str(err).upper()
            if killed:
                print(f"SCALE_STOP after {n}: worker killed / OOM — not attempting longer clips", flush=True)
                break
    return {"cases": cases}


def main() -> int:
    which = (sys.argv[1] if len(sys.argv) > 1 else "all").lower()
    if not SNEAKER.is_file():
        print(f"missing still {SNEAKER}", file=sys.stderr)
        return 2
    summary: dict = {
        "machine": os.uname().machine if hasattr(os, "uname") else "",
        "max_frames_code": mlx_ti2v.MAX_FRAMES,
        "mapping_5s": mlx_ti2v.frames_for_duration(5.0),
        "mapping_1_7s": mlx_ti2v.frames_for_duration(1.7),
    }
    if which in ("semantic", "all"):
        print("=== SEMANTIC (existing 41-frame clips) ===", flush=True)
        summary["existing_semantic"] = _score_existing()
    if which in ("scale", "all"):
        if not mlx_ti2v.weights_ready():
            print("weights not ready", file=sys.stderr)
            return 2
        summary.update(run_scale())
    SUMMARY.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"SCALE_DONE {SUMMARY}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
