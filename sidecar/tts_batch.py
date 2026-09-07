#!/usr/bin/env python3
"""Batch XTTS synthesis for voiceover: one model load, one speaker conditioning.

Why this exists (vs calling tts_clone.py per segment):

* XTTS samples speech tokens (``do_sample=True``). Without a fixed seed every
  process produces a different realization of the voice, which is why
  per-segment synthesis drifted between male and female timbre.
* Conditioning latents are computed once here and reused for every segment, so
  all segments share the exact same speaker embedding.
* Loading the ~2 GB model once instead of N times is also much faster.

Input is a JSON job on argv[1]; progress lines go to stdout as JSON.
"""
from __future__ import annotations

import json
import os
import sys

import coqui_compat  # noqa: F401 — patch torch.load before TTS import

# Reference conditioning: XTTS loads references at 22.05 kHz and uses at most
# ``max_ref_len`` seconds of it.
REF_LOAD_SR = 22050
GPT_COND_LEN = 30
MAX_REF_LEN = 30

# XTTS v2 config defaults, measured to give speech close to the intended length.
# Lowering repetition_penalty makes the model ramble; raising it truncates.
TEMPERATURE = 0.75
REPETITION_PENALTY = 5.0
TOP_K = 50
TOP_P = 0.85

OUTPUT_SR = 24000  # XTTS native output rate
TRIM_TOP_DB = 40
TRIM_PAD_SEC = 0.06


def emit(stage: str, percent: int, detail: str = "") -> None:
    print(json.dumps({"progress": percent, "stage": stage, "detail": detail}), flush=True)


def _trim_silence(wav, sr: int):
    """Drop leading/trailing silence and XTTS artifact tails, keep a short pad."""
    try:
        import librosa
        import numpy as np
    except ImportError:
        return wav

    arr = np.asarray(wav, dtype="float32")
    if arr.size == 0:
        return wav
    trimmed, _ = librosa.effects.trim(arr, top_db=TRIM_TOP_DB)
    if trimmed.size == 0:
        return arr
    pad = int(TRIM_PAD_SEC * sr)
    return np.pad(trimmed, (0, pad), mode="constant")


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: tts_batch.py job.json"}))
        return 2

    with open(sys.argv[1], encoding="utf-8") as handle:
        job = json.load(handle)

    speaker = job["speaker_wav"]
    language = "ru" if str(job.get("language", "ru")).startswith("ru") else "en"
    seed = int(job.get("seed", 1234))
    items = job.get("items") or []
    if not items:
        print(json.dumps({"ok": False, "error": "no items"}))
        return 2

    try:
        emit("import", 4, "Loading Coqui TTS")
        import torch
        from TTS.tts.configs.xtts_config import XttsConfig
        from TTS.tts.models.xtts import Xtts
        from TTS.utils.manage import ModelManager
    except ImportError:
        print(json.dumps({"ok": False, "error": "missing-tts"}))
        return 3

    try:
        import numpy as np
        import soundfile as sf
    except ImportError:
        print(json.dumps({"ok": False, "error": "missing-soundfile"}))
        return 3

    emit("loading_model", 12, "Loading XTTS model — first run downloads ~2 GB")
    model_name = "tts_models/multilingual/multi-dataset/xtts_v2"
    manager = ModelManager()
    model_path, _, _ = manager.download_model(model_name)

    config = XttsConfig()
    config.load_json(os.path.join(model_path, "config.json"))
    model = Xtts.init_from_config(config)
    model.load_checkpoint(config, checkpoint_dir=model_path, eval=True)
    model.eval()

    emit("conditioning", 22, "Analyzing your voice sample")
    gpt_cond_latent, speaker_embedding = model.get_conditioning_latents(
        audio_path=[speaker],
        gpt_cond_len=GPT_COND_LEN,
        max_ref_length=MAX_REF_LEN,
        sound_norm_refs=True,
        load_sr=REF_LOAD_SR,
    )

    results = []
    total = len(items)
    for i, item in enumerate(items):
        text = (item.get("text") or "").strip()
        dest = item["file_path"]
        percent = 25 + int(70 * i / max(1, total))
        emit("synthesizing", percent, f"Segment {i + 1} of {total}")

        if not text:
            results.append({"index": item.get("index", i), "file_path": dest, "skipped": True})
            continue

        # Same seed for every segment: identical sampling trajectory start, so
        # the cloned timbre stays consistent across the whole voiceover.
        torch.manual_seed(seed)

        out = model.inference(
            text=text,
            language=language,
            gpt_cond_latent=gpt_cond_latent,
            speaker_embedding=speaker_embedding,
            temperature=TEMPERATURE,
            repetition_penalty=REPETITION_PENALTY,
            top_k=TOP_K,
            top_p=TOP_P,
            enable_text_splitting=True,
        )
        wav = np.asarray(out["wav"], dtype="float32")
        wav = _trim_silence(wav, OUTPUT_SR)

        peak = float(np.abs(wav).max()) if wav.size else 0.0
        if peak > 0:
            wav = wav / peak * 0.89

        os.makedirs(os.path.dirname(dest), exist_ok=True)
        sf.write(dest, wav, OUTPUT_SR, subtype="PCM_16")
        results.append({
            "index": item.get("index", i),
            "file_path": dest,
            "duration_sec": round(len(wav) / OUTPUT_SR, 3),
            "skipped": False,
        })

    emit("done", 100, "Voiceover ready")
    print(json.dumps({"ok": True, "results": results}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)[:500]}))
        raise SystemExit(1)
