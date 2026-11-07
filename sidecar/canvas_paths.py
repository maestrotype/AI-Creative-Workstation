"""Where Canvas stores projects, analysis caches and generated media.

Prefer ~/Documents/Canvas. When macOS denies that folder to the Electron app
(TCC EPERM), fall back to Application Support so analysis and TTS can still run.
Override with ACW_CANVAS_ROOT.
"""
from __future__ import annotations

import os
from functools import lru_cache


def _writable(root: str) -> bool:
    probe = os.path.join(root, ".acw-write-test")
    try:
        os.makedirs(root, exist_ok=True)
        with open(probe, "w", encoding="utf-8") as handle:
            handle.write("ok")
        os.remove(probe)
        return True
    except OSError:
        try:
            if os.path.isfile(probe):
                os.remove(probe)
        except OSError:
            pass
        return False


@lru_cache(maxsize=1)
def canvas_root() -> str:
    env = (os.environ.get("ACW_CANVAS_ROOT") or "").strip()
    if env:
        path = os.path.expanduser(env)
        os.makedirs(path, exist_ok=True)
        return path
    preferred = os.path.expanduser("~/Documents/Canvas")
    if _writable(preferred):
        return preferred
    for fallback in (
        os.path.expanduser("~/Library/Application Support/canvas/Canvas"),
        os.path.expanduser("~/Library/Application Support/ai-creative-workstation/Canvas"),
    ):
        if _writable(fallback) or not os.path.exists(os.path.dirname(fallback)):
            try:
                os.makedirs(fallback, exist_ok=True)
                if _writable(fallback):
                    print(f"[canvas] Documents unavailable — using {fallback}", flush=True)
                    return fallback
            except OSError:
                continue
    os.makedirs(preferred, exist_ok=True)
    return preferred


def canvas_join(*parts: str) -> str:
    return os.path.join(canvas_root(), *parts)


def analysis_dir() -> str:
    path = canvas_join("Generated", "Video", "analysis")
    os.makedirs(path, exist_ok=True)
    return path


def generated_video_dir() -> str:
    path = canvas_join("Generated", "Video")
    os.makedirs(path, exist_ok=True)
    return path


def generated_audio_dir() -> str:
    path = canvas_join("Generated", "Audio")
    os.makedirs(path, exist_ok=True)
    return path


def voice_dir() -> str:
    path = canvas_join("Voice")
    os.makedirs(path, exist_ok=True)
    return path


def access_denied_message(exc: BaseException) -> str:
    text = str(exc)
    if "Operation not permitted" in text or getattr(exc, "errno", None) == 1:
        return (
            "Нет доступа к папке данных Canvas. "
            "Откройте Системные настройки → Конфиденциальность и безопасность → "
            "Файлы и папки (или Полный доступ к диску), разрешите AI Creative Workstation "
            "доступ к Документам и перезапустите приложение."
        )
    return text
