#!/usr/bin/env python3
"""MLX subprocess worker. Must run under the Python 3.11 mlx-video venv."""
from __future__ import annotations

import argparse
import gc
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--negative-prompt", default="")
    parser.add_argument("--output", required=True)
    parser.add_argument("--width", type=int, default=832)
    parser.add_argument("--height", type=int, default=480)
    parser.add_argument("--num-frames", type=int, default=41)
    parser.add_argument("--steps", type=int, default=20)
    parser.add_argument("--guide-scale", type=float, default=5.0)
    parser.add_argument("--shift", type=float, default=5.0)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    from mlx_video.models.wan_2.generate import generate_video
    import mlx.core as mx

    if hasattr(mx, "reset_peak_memory"):
        mx.reset_peak_memory()

    generate_video(
        model_dir=args.model_dir,
        prompt=args.prompt,
        negative_prompt=args.negative_prompt or None,
        image=args.image,
        width=args.width,
        height=args.height,
        num_frames=args.num_frames,
        steps=args.steps,
        guide_scale=args.guide_scale,
        shift=args.shift,
        seed=args.seed,
        output_path=args.output,
        tiling="auto",
    )
    del generate_video
    gc.collect()
    mx.clear_cache()
    peak_gb = mx.get_peak_memory() / (1024 ** 3)
    print(f"PEAK_MLX_GB {peak_gb:.2f}", flush=True)
    print(f"OK {args.output}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
