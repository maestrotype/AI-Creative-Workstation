"""Shared Ollama runtime helpers: endpoint + real model eviction.

Ollama keeps a model resident for ~5 minutes after a request by default. On a
64 GB unified-memory Mac a resident VLM + LLM can coexist with FLUX / XTTS / 3D,
which violates the "one heavy model at a time" policy. We release explicitly the
moment a job is done instead of relying on that timeout.
"""

import json
import urllib.error
import urllib.request

OLLAMA_URL = "http://127.0.0.1:11434"

# Short warm window so a burst of calls (e.g. script + per-segment shorten) does
# not reload between requests, while an idle model still evicts quickly.
KEEP_ALIVE_WARM = "30s"


def unload_model(model: str) -> bool:
    """Evict a model from Ollama memory now (keep_alive=0).

    This is a real release: Ollama frees the model weights from RAM. Returns True
    on a clean response, False if Ollama is unreachable (nothing to release).
    """
    name = (model or "").strip()
    if not name:
        return False
    payload = json.dumps({"model": name, "keep_alive": 0}).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            resp.read()
        return True
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def loaded_models() -> list[str]:
    """Model names Ollama currently holds resident (best-effort, for status UI)."""
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/ps", timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return []
    names: list[str] = []
    for item in data.get("models") or []:
        name = str(item.get("name") or item.get("model") or "").strip()
        if name:
            names.append(name)
    return names
