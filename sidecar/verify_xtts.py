#!/usr/bin/env python3
"""Exit 0 when Coqui XTTS dependencies import cleanly."""
from __future__ import annotations

import sys

import coqui_compat  # noqa: F401 — patch torch.load before TTS import

try:
    from transformers import BeamSearchScorer  # noqa: F401
    from TTS.api import TTS  # noqa: F401
except ImportError as exc:
    print(str(exc), file=sys.stderr)
    raise SystemExit(1) from exc

raise SystemExit(0)
