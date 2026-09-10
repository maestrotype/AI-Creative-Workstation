"""JSON next to a generated still so Create / Assets can recover the prompt."""
from __future__ import annotations

import json
import os
from typing import Any


def sidecar_path(media_path: str) -> str:
    root, _ext = os.path.splitext(media_path)
    return f"{root}.json"


def write_still_sidecar(
    path: str,
    *,
    prompt: str,
    job: str = "title",
    fmt: str = "square",
    style: str = "subtle",
    model_id: str = "",
    english_prompt: str | None = None,
) -> str:
    side = sidecar_path(path)
    payload: dict[str, Any] = {
        "prompt": prompt,
        "job": job,
        "format": fmt,
        "style": style,
        "model_id": model_id,
        "kind": "image",
    }
    if english_prompt:
        payload["english_prompt"] = english_prompt
    directory = os.path.dirname(side)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(side, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    return side
