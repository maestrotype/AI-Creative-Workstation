"""Read on-screen text from screencast frames when no vision model is installed."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Any

_SWIFT = os.path.join(os.path.dirname(__file__), "ocr_frames.swift")


def read_frames(paths: list[str]) -> dict[str, list[dict[str, Any]]]:
    unique = []
    seen: set[str] = set()
    for path in paths:
        if not path or path in seen or not os.path.isfile(path):
            continue
        seen.add(path)
        unique.append(path)
    if not unique or not shutil.which("swift") or not os.path.isfile(_SWIFT):
        return {}
    try:
        proc = subprocess.run(
            ["swift", _SWIFT, *unique],
            capture_output=True,
            timeout=180,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {}
    if proc.returncode != 0 or not proc.stdout:
        return {}
    try:
        parsed = json.loads(proc.stdout.decode("utf-8"))
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    out: dict[str, list[dict[str, Any]]] = {}
    for path, lines in parsed.items():
        if isinstance(lines, list):
            out[str(path)] = [line for line in lines if isinstance(line, dict)]
    return out
