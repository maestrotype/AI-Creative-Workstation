"""Compatibility shims for Coqui TTS 0.22 on PyTorch 2.6+ and headless CPML."""
from __future__ import annotations

import os

os.environ.setdefault("COQUI_TOS_AGREED", "1")


def patch_torch_load() -> None:
    """Coqui checkpoints need weights_only=False; PyTorch 2.6+ defaults to True."""
    import torch

    if getattr(torch.load, "_coqui_compat", False):
        return

    original = torch.load

    def load(*args, **kwargs):
        kwargs.setdefault("weights_only", False)
        return original(*args, **kwargs)

    load._coqui_compat = True  # type: ignore[attr-defined]
    torch.load = load  # type: ignore[method-assign]


def patch_torchaudio_load() -> None:
    """torchaudio 2.9+ needs torchcodec+FFmpeg; use soundfile for WAV/FLAC/OGG."""
    import torch
    import torchaudio

    if getattr(torchaudio, "_coqui_compat", False):
        return

    original = torchaudio.load

    def load(filepath, *args, **kwargs):
        path = str(filepath)
        if path.lower().endswith((".wav", ".flac", ".ogg")):
            import soundfile as sf

            data, sr = sf.read(path, dtype="float32", always_2d=True)
            if data.ndim == 1:
                tensor = torch.from_numpy(data).unsqueeze(0)
            else:
                tensor = torch.from_numpy(data.T)
            return tensor, sr
        return original(filepath, *args, **kwargs)

    torchaudio.load = load  # type: ignore[method-assign]
    torchaudio._coqui_compat = True  # type: ignore[attr-defined]


patch_torch_load()
patch_torchaudio_load()
