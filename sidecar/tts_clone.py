#!/usr/bin/env python3
"""Clone TTS with Coqui XTTS. Emits JSON progress lines on stdout."""
from __future__ import annotations

import json
import sys

import coqui_compat  # noqa: F401 — patch torch.load before TTS import


def emit(stage: str, percent: int, detail: str = "") -> None:
    print(json.dumps({"progress": percent, "stage": stage, "detail": detail}), flush=True)


def main() -> int:
    if len(sys.argv) < 5:
        print(json.dumps({"ok": False, "error": "usage: tts_clone.py speaker.wav dest.wav lang text"}))
        return 2
    speaker, dest, lang, text = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    try:
        emit("import", 8, "Loading Coqui TTS")
        from TTS.api import TTS as CoquiTTS
    except ImportError:
        print(json.dumps({"ok": False, "error": "missing-tts"}))
        return 3
    language = "ru" if str(lang).startswith("ru") else "en"
    emit(
        "loading_model",
        25,
        "Loading XTTS model — first run may download ~2 GB and take several minutes",
    )
    tts = CoquiTTS("tts_models/multilingual/multi-dataset/xtts_v2")
    emit("synthesizing", 72, "Generating speech in your voice")
    tts.tts_to_file(
        text=text,
        speaker_wav=speaker,
        language=language,
        file_path=dest,
    )
    emit("done", 100, "Voiceover ready")
    print(json.dumps({"ok": True, "file_path": dest}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)[:500]}))
        raise SystemExit(1)
