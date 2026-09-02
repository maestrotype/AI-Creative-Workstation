"""Speech-to-text for video analysis (optional faster-whisper)."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from typing import Any, Callable, Dict, List, Optional

ProgressFn = Optional[Callable[[str, int, str], None]]


def _ffmpeg_bin() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise RuntimeError("ffmpeg is not installed")
    return path


def whisper_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except ImportError:
        return False


def extract_audio_wav(video_path: str, dest_wav: str) -> None:
    cmd = [
        _ffmpeg_bin(),
        "-y",
        "-i",
        video_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        dest_wav,
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)


def transcribe_video(
    video_path: str,
    language: Optional[str] = None,
    model_size: str = "small",
    on_progress: ProgressFn = None,
) -> Dict[str, Any]:
    """Return transcript payload or empty segments with warnings."""
    warnings: List[str] = []

    if not whisper_available():
        warnings.append("WHISPER_NOT_INSTALLED")
        return {
            "segments": [],
            "language": language or "unknown",
            "full_text": "",
            "warnings": warnings,
        }

    if on_progress:
        on_progress("extract_audio", 15, "Extracting audio track")

    with tempfile.TemporaryDirectory() as tmp:
        wav_path = os.path.join(tmp, "analyze.wav")
        try:
            extract_audio_wav(video_path, wav_path)
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or exc.stdout or "ffmpeg extract failed")[:300]
            warnings.append(f"AUDIO_EXTRACT_FAILED: {detail}")
            return {
                "segments": [],
                "language": language or "unknown",
                "full_text": "",
                "warnings": warnings,
            }

        if on_progress:
            on_progress("transcribe", 35, f"Loading Whisper ({model_size})")

        try:
            from faster_whisper import WhisperModel
        except ImportError:
            warnings.append("WHISPER_NOT_INSTALLED")
            return {
                "segments": [],
                "language": language or "unknown",
                "full_text": "",
                "warnings": warnings,
            }

        try:
            model = WhisperModel(model_size, device="cpu", compute_type="int8")
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"WHISPER_LOAD_FAILED: {exc}")
            return {
                "segments": [],
                "language": language or "unknown",
                "full_text": "",
                "warnings": warnings,
            }

        if on_progress:
            on_progress("transcribe", 55, "Transcribing speech")

        lang = language if language and language != "auto" else None
        segments_iter, info = model.transcribe(
            wav_path,
            language=lang,
            beam_size=5,
            vad_filter=True,
        )

        segments: List[Dict[str, Any]] = []
        for seg in segments_iter:
            segments.append({
                "start": round(float(seg.start), 3),
                "end": round(float(seg.end), 3),
                "text": (seg.text or "").strip(),
            })
            if on_progress and segments:
                pct = min(92, 55 + len(segments))
                on_progress("transcribe", pct, f"Transcribing… {len(segments)} segments")

        detected = getattr(info, "language", None) or language or "unknown"
        full_text = " ".join(s["text"] for s in segments if s["text"]).strip()

        if on_progress:
            on_progress("transcribe", 95, "Transcript ready")

        return {
            "segments": segments,
            "language": detected,
            "full_text": full_text,
            "warnings": warnings,
        }
