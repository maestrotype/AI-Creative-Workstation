#!/usr/bin/env python3
"""Pre-download Coqui XTTS v2 weights with JSON progress on stdout."""
from __future__ import annotations

import json
import sys

import coqui_compat  # noqa: F401 — patch torch.load before TTS import


def emit(stage: str, percent: int, detail: str = "") -> None:
    print(json.dumps({"progress": percent, "stage": stage, "detail": detail}), flush=True)


def main() -> int:
    try:
        emit("import", 5, "Loading Coqui TTS")
        from TTS.api import TTS as CoquiTTS
    except ImportError:
        print(json.dumps({"ok": False, "error": "missing-tts"}))
        return 3
    emit(
        "loading_model",
        20,
        "Downloading XTTS v2 weights (~2 GB) — first run only",
    )
    try:
        CoquiTTS("tts_models/multilingual/multi-dataset/xtts_v2")
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)[:500]}))
        return 1
    emit("done", 100, "XTTS weights ready")
    print(json.dumps({"ok": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
