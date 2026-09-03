from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

from media_probe import audio_duration_sec
from text_ru import (
    LEXICON_PATH,
    apply_pronunciation_fix,
    delete_lexicon_entry,
    list_lexicon_entries,
    load_lexicon,
    prepare_text,
    save_lexicon_entry,
    stress_status,
    to_spoken_text,
)

router = APIRouter()

AUDIO_DIR = os.path.expanduser("~/Documents/Canvas/Generated/Audio")
VOICE_DIR = os.path.expanduser("~/Documents/Canvas/Voice")
VIDEO_DIR = os.path.expanduser("~/Documents/Canvas/Generated/Video")
SPEAKER_WAV = os.path.join(VOICE_DIR, "speaker.wav")
SOURCE_META = os.path.join(VOICE_DIR, "source.json")

_tts_lock = threading.Lock()
_text_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="voice-text")
_clone_python_path: Optional[str] = None
_clone_python_checked = False
_tts_job: Dict[str, Any] = {
    "active": False,
    "stage": "idle",
    "percent": 0,
    "detail": "",
    "started_at": 0.0,
    "error": None,
}


def _reset_tts_job() -> None:
    _tts_job.update({
        "active": False,
        "stage": "idle",
        "percent": 0,
        "detail": "",
        "started_at": 0.0,
        "error": None,
    })


def _set_tts_job(**patch: Any) -> None:
    _tts_job.update(patch)


def _read_source_meta() -> Optional[dict]:
    try:
        with open(SOURCE_META, encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            return data
    except OSError:
        pass
    return None


def _write_source_meta(input_path: str, levels: Optional[Dict[str, Any]] = None) -> None:
    os.makedirs(VOICE_DIR, exist_ok=True)
    resolved = os.path.expanduser(input_path)
    payload: Dict[str, Any] = {
        "path": resolved,
        "name": os.path.basename(resolved),
    }
    if levels:
        payload["source_peak_db"] = levels.get("peak_db")
        payload["source_mean_db"] = levels.get("mean_db")
    with open(SOURCE_META, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)


def _ffmpeg_bin() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise HTTPException(
            status_code=503,
            detail="ffmpeg is not installed. Install it (e.g. brew install ffmpeg).",
        )
    return path


def _audio_out(name: str, ext: str) -> str:
    os.makedirs(AUDIO_DIR, exist_ok=True)
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "-", name).strip("-") or "audio"
    return os.path.join(AUDIO_DIR, f"{safe}.{ext}")


class ConvertAudioRequest(BaseModel):
    input_path: str
    format: str = "wav"
    output_name: str = "capture"


class SaveVoiceRequest(BaseModel):
    input_path: str


class PrepareTextRequest(BaseModel):
    text: str
    language: str = "auto"
    apply_stress: bool = True


class TtsRequest(BaseModel):
    text: str
    language: str = "ru"
    skip_prepare: bool = False
    prepared_text: Optional[str] = None


class TimelineRequest(BaseModel):
    prompt: str
    video_path: Optional[str] = None
    audio_path: Optional[str] = None
    dry_run: bool = False


class LexiconUpsertRequest(BaseModel):
    word: str
    spoken: str
    stress: Optional[str] = None
    note: Optional[str] = None


class LexiconFixRequest(BaseModel):
    prompt: str
    word: Optional[str] = None
    context_text: Optional[str] = None


class VoiceoverTrackPart(BaseModel):
    file_path: str
    start_sec: float = 0.0
    max_duration_sec: Optional[float] = None


class TtsBatchItem(BaseModel):
    text: str
    index: int = 0
    prepared_text: Optional[str] = None


class TtsBatchRequest(BaseModel):
    items: List[TtsBatchItem]
    language: str = "ru"
    seed: int = 1234
    skip_prepare: bool = False


class VoiceoverTrackRequest(BaseModel):
    parts: List[VoiceoverTrackPart]
    total_sec: Optional[float] = None
    output_name: str = "voiceover"


def _encode_args(fmt: str) -> List[str]:
    key = (fmt or "wav").lower().replace("flack", "flac")
    if key == "mp3":
        return ["-c:a", "libmp3lame", "-q:a", "2"]
    if key == "flac":
        return ["-c:a", "flac"]
    return ["-c:a", "pcm_s16le"]


def _convert(src: str, dest: str, fmt: str) -> None:
    if not os.path.isfile(src):
        raise HTTPException(status_code=400, detail=f"File not found: {src}")
    cmd = [_ffmpeg_bin(), "-y", "-i", src, "-vn", "-ar", "48000", "-ac", "2", *_encode_args(fmt), dest]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=500,
            detail=(exc.stderr or exc.stdout or "ffmpeg failed")[:500],
        ) from exc


@router.post("/audio/convert")
def convert_audio(request: ConvertAudioRequest):
    fmt = request.format.lower().replace("flack", "flac")
    if fmt not in {"wav", "mp3", "flac"}:
        raise HTTPException(status_code=400, detail="format must be wav, mp3, or flac")
    dest = _audio_out(request.output_name, fmt)
    _convert(os.path.expanduser(request.input_path), dest, fmt)
    return {"status": "completed", "file_path": dest, "format": fmt}


def _clone_python(*, refresh: bool = False) -> Optional[str]:
    global _clone_python_path, _clone_python_checked
    if _clone_python_checked and not refresh:
        return _clone_python_path

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    verify = os.path.join(here, "verify_xtts.py")
    candidates = [
        os.path.join(here, ".venv-tts", "bin", "python"),
        os.path.join(here, ".venv-tts", "bin", "python3"),
    ]
    env = {**os.environ, "COQUI_TOS_AGREED": "1"}
    found: Optional[str] = None
    for py in candidates:
        if not py or not os.path.isfile(py):
            continue
        if not os.path.isfile(verify):
            continue
        try:
            proc = subprocess.run(
                [py, verify],
                check=False,
                capture_output=True,
                text=True,
                timeout=60,
                env=env,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if proc.returncode == 0:
            found = py
            break
    _clone_python_path = found
    _clone_python_checked = True
    return found


def _xtts_venv_present() -> bool:
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.isfile(os.path.join(here, ".venv-tts", "bin", "python3")) or os.path.isfile(
        os.path.join(here, ".venv-tts", "bin", "python")
    )


def _coqui_available(*, refresh: bool = False) -> bool:
    return _clone_python(refresh=refresh) is not None


def _run_xtts_clone(text: str, dest: str, language: str) -> None:
    py = _clone_python()
    if not py:
        raise HTTPException(
            status_code=503,
            detail="Voice clone is not installed. The Mac system voice is no longer used as a stand-in.",
        )
    worker = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tts_clone.py")
    with _tts_lock:
        if _tts_job.get("active"):
            raise HTTPException(status_code=409, detail="Another voiceover is already running.")
        _set_tts_job(
            active=True,
            stage="starting",
            percent=3,
            detail="Starting voice clone",
            started_at=time.time(),
            error=None,
        )
    try:
        proc = subprocess.Popen(
            [py, worker, SPEAKER_WAV, dest, language, text],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        stderr = ""
        last_line = ""
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            if line.startswith("{") and '"progress"' in line:
                last_line = line
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if "progress" in payload:
                    _set_tts_job(
                        active=True,
                        stage=str(payload.get("stage") or "working"),
                        percent=int(payload.get("percent") or 0),
                        detail=str(payload.get("detail") or ""),
                        started_at=_tts_job.get("started_at") or time.time(),
                    )
                continue
            if line.startswith("{") and '"ok"' in line:
                last_line = line
        proc.wait()
        if proc.returncode != 0 or not os.path.isfile(dest):
            raw = last_line or stderr
            try:
                payload = json.loads(last_line)
                raw = str(payload.get("error") or raw)
            except json.JSONDecodeError:
                pass
            _set_tts_job(active=False, stage="error", error=str(raw)[:500])
            raise HTTPException(status_code=500, detail=str(raw)[:500])
        _set_tts_job(active=False, stage="done", percent=100, detail="Voiceover ready")
    except subprocess.TimeoutExpired as exc:
        _set_tts_job(active=False, stage="error", error="Voice clone timed out.")
        raise HTTPException(status_code=504, detail="Voice clone timed out.") from exc
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        _set_tts_job(active=False, stage="error", error=str(exc)[:500])
        raise


MIN_REFERENCE_SEC = 6.0


def _reference_info() -> Dict[str, Any]:
    """Duration + quality warnings for the cloning reference.

    XTTS clones from this sample, so a near-silent or very short recording is the
    single biggest cause of drifting timbre and noise in the output.
    """
    empty = {"sample_sec": None, "sample_warning": None, "sample_peak_db": None}
    if not os.path.isfile(SPEAKER_WAV):
        return empty
    try:
        seconds = audio_duration_sec(SPEAKER_WAV)
    except Exception:  # noqa: BLE001 — probe failure must not break status
        return empty

    meta = _read_source_meta() or {}
    peak = meta.get("source_peak_db")
    if not isinstance(peak, (int, float)):
        # Sample saved before level checks existed: measure it as-is (those files
        # were stored without gain, so the stored peak reflects the recording).
        peak = _measure_levels(SPEAKER_WAV).get("peak_db")

    warning = None
    if isinstance(peak, (int, float)) and peak < MIN_REFERENCE_PEAK_DB:
        warning = "SAMPLE_TOO_QUIET"
    elif seconds < MIN_REFERENCE_SEC:
        warning = "SAMPLE_TOO_SHORT"

    return {
        "sample_sec": round(seconds, 2),
        "sample_warning": warning,
        "sample_peak_db": round(peak, 1) if isinstance(peak, (int, float)) else None,
    }


@router.get("/audio/voice")
def voice_status(refresh: bool = False):
    # Status must stay cheap: verify_xtts.py imports torch and can stall the
    # whole sidecar. Real synthesis still runs the verify via _clone_python().
    if refresh:
        engine = "xtts" if _coqui_available(refresh=True) else "none"
    else:
        engine = "xtts" if _xtts_venv_present() else "none"
    meta = _read_source_meta()
    return {
        "has_sample": os.path.isfile(SPEAKER_WAV),
        "file_path": SPEAKER_WAV if os.path.isfile(SPEAKER_WAV) else None,
        "source_path": meta.get("path") if meta else None,
        "source_name": meta.get("name") if meta else None,
        "tts_ready": engine == "xtts",
        "engine": engine,
        **_reference_info(),
    }


@router.get("/audio/tts/progress")
def tts_progress():
    elapsed = 0.0
    if _tts_job.get("started_at"):
        elapsed = max(0.0, time.time() - float(_tts_job["started_at"]))
    return {
        "active": bool(_tts_job.get("active")),
        "stage": _tts_job.get("stage") or "idle",
        "percent": int(_tts_job.get("percent") or 0),
        "detail": _tts_job.get("detail") or "",
        "elapsed_sec": round(elapsed, 1),
        "error": _tts_job.get("error"),
    }


_PEAK_RE = re.compile(r"max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB")
_MEAN_RE = re.compile(r"mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB")

# A usable recording peaks near 0 dBFS. Below this the microphone captured
# essentially nothing, and XTTS then clones noise instead of a voice.
MIN_REFERENCE_PEAK_DB = -30.0
TARGET_REFERENCE_PEAK_DB = -3.0


def _measure_levels(path: str) -> Dict[str, Optional[float]]:
    """Peak and mean level in dBFS via ffmpeg volumedetect."""
    cmd = [_ffmpeg_bin(), "-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"]
    try:
        proc = subprocess.run(cmd, check=False, capture_output=True, text=True)
    except OSError:
        return {"peak_db": None, "mean_db": None}
    blob = f"{proc.stderr}\n{proc.stdout}"
    peak = _PEAK_RE.search(blob)
    mean = _MEAN_RE.search(blob)
    return {
        "peak_db": float(peak.group(1)) if peak else None,
        "mean_db": float(mean.group(1)) if mean else None,
    }


def _convert_reference(src: str, dest: str) -> Dict[str, Optional[float]]:
    """Write the cloning reference as mono 22.05 kHz, trimmed and level-matched.

    XTTS loads references at 22.05 kHz mono anyway; converting here (instead of
    handing it a 48 kHz stereo file) keeps the conditioning input identical every
    run. Silence is trimmed so the short reference budget holds actual speech,
    and gain is applied so quiet recordings still reach a usable level.

    Returns the levels measured on the *source*, so the caller can warn when the
    recording was too quiet to be worth cloning.
    """
    if not os.path.isfile(src):
        raise HTTPException(status_code=400, detail=f"File not found: {src}")

    levels = _measure_levels(src)
    peak = levels.get("peak_db")
    gain_db = 0.0
    if peak is not None and peak < TARGET_REFERENCE_PEAK_DB:
        gain_db = TARGET_REFERENCE_PEAK_DB - peak

    filters = [
        "silenceremove=start_periods=1:start_duration=0:start_threshold=-45dB",
        "areverse",
        "silenceremove=start_periods=1:start_duration=0:start_threshold=-45dB",
        "areverse",
    ]
    if gain_db > 0.1:
        filters.append(f"volume={gain_db:.1f}dB")

    cmd = [
        _ffmpeg_bin(), "-y", "-i", src, "-vn",
        "-af", ",".join(filters),
        "-ac", "1", "-ar", "22050", "-c:a", "pcm_s16le", dest,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError:
        # Trimming can fail on odd inputs; a plain mono conversion still works.
        _convert(src, dest, "wav")
    return levels


@router.post("/audio/voice")
def save_voice(request: SaveVoiceRequest):
    os.makedirs(VOICE_DIR, exist_ok=True)
    src = os.path.expanduser(request.input_path)
    levels = _convert_reference(src, SPEAKER_WAV)
    _write_source_meta(src, levels)
    meta = _read_source_meta()
    return {
        "status": "saved",
        "file_path": SPEAKER_WAV,
        "has_sample": True,
        "source_path": meta.get("path") if meta else src,
        "source_name": meta.get("name") if meta else os.path.basename(src),
        **_reference_info(),
    }


def _tts_language(text: str, hint: str) -> str:
    if re.search(r"[а-яА-ЯёЁ]", text):
        return "ru"
    return hint or "en"


def _resolve_tts_text(request: TtsRequest) -> tuple[str, dict]:
    raw = (request.text or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="text is required")

    if request.prepared_text and request.prepared_text.strip():
        spoken = to_spoken_text(request.prepared_text.strip())
        return spoken, {"skipped": True, "source": "prepared_text", "spoken": spoken}

    if request.skip_prepare:
        return raw, {"skipped": True, "source": "raw"}

    prepared = prepare_text(raw, language=request.language or "auto", apply_stress=True)
    return prepared["spoken"], {"skipped": False, "preparation": prepared}


@router.post("/audio/prepare-text")
async def prepare_voice_text(request: PrepareTextRequest):
    text = (request.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        _text_pool,
        lambda: prepare_text(text, language=request.language, apply_stress=request.apply_stress),
    )
    return {"status": "ok", **result}


@router.get("/audio/stress-status")
def get_stress_status():
    status = stress_status()
    lexicon = load_lexicon()
    return {
        "stress_available": bool(status.get("available")),
        "error": status.get("error"),
        "lexicon_path": LEXICON_PATH,
        "lexicon_count": len(lexicon),
    }


@router.get("/audio/lexicon")
def get_lexicon():
    return {
        "path": LEXICON_PATH,
        "entries": list_lexicon_entries(),
    }


@router.put("/audio/lexicon")
def upsert_lexicon(request: LexiconUpsertRequest):
    word = (request.word or "").strip()
    spoken = (request.spoken or "").strip()
    if not word or not spoken:
        raise HTTPException(status_code=400, detail="word and spoken are required")
    try:
        entry = save_lexicon_entry(word, spoken, stress=request.stress, note=request.note)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "status": "saved",
        "word": word.lower(),
        "entry": entry.to_dict(),
    }


@router.delete("/audio/lexicon")
def remove_lexicon(word: str):
    key = (word or "").strip().lower()
    if not key:
        raise HTTPException(status_code=400, detail="word is required")
    removed = delete_lexicon_entry(key)
    if not removed:
        raise HTTPException(status_code=404, detail="lexicon entry not found")
    return {"status": "deleted", "word": key}


@router.post("/audio/lexicon/fix")
async def fix_pronunciation(request: LexiconFixRequest):
    prompt = (request.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")
    loop = asyncio.get_running_loop()

    def _fix() -> Dict[str, Any]:
        result = apply_pronunciation_fix(prompt, default_word=request.word)
        payload: Dict[str, Any] = {"status": "saved", **result}
        context = (request.context_text or "").strip()
        if context:
            payload["prepared"] = prepare_text(context, language="auto", apply_stress=True)
        return payload

    try:
        return await loop.run_in_executor(_text_pool, _fix)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/audio/tts")
def synthesize_voice(request: TtsRequest):
    raw = (request.text or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="text is required")
    if not os.path.isfile(SPEAKER_WAV):
        raise HTTPException(
            status_code=400,
            detail="No voice sample yet. Record your voice first (10+ seconds, clear speech).",
        )
    if not _coqui_available():
        raise HTTPException(status_code=503, detail="CLONE_ENGINE_MISSING")

    tts_text, prep_meta = _resolve_tts_text(request)
    os.makedirs(AUDIO_DIR, exist_ok=True)
    dest = _audio_out(f"tts-{abs(hash(tts_text)) % 10_000_000}", "wav")
    lang = _tts_language(tts_text, request.language or "en")
    _run_xtts_clone(tts_text, dest, lang)
    return {
        "status": "completed",
        "file_path": dest,
        "engine": "xtts",
        "spoken_text": tts_text,
        "preparation": prep_meta,
    }


def _run_xtts_batch(job: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Synthesize every segment in one worker process (see tts_batch.py)."""
    py = _clone_python()
    if not py:
        raise HTTPException(status_code=503, detail="CLONE_ENGINE_MISSING")
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    worker = os.path.join(root, "tts_batch.py")

    with _tts_lock:
        if _tts_job.get("active"):
            raise HTTPException(status_code=409, detail="Another voiceover is already running.")
        _set_tts_job(
            active=True,
            stage="starting",
            percent=2,
            detail="Starting voice clone",
            started_at=time.time(),
            error=None,
        )

    # Not in AUDIO_DIR: that folder is scanned into the media library.
    fd, job_path = tempfile.mkstemp(prefix="tts-job-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(job, handle, ensure_ascii=False)

    try:
        proc = subprocess.Popen(
            [py, worker, job_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        assert proc.stdout is not None
        final_line = ""
        for line in proc.stdout:
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "progress" in payload:
                _set_tts_job(
                    active=True,
                    stage=str(payload.get("stage") or "working"),
                    percent=int(payload.get("percent") or 0),
                    detail=str(payload.get("detail") or ""),
                    started_at=_tts_job.get("started_at") or time.time(),
                )
            elif "ok" in payload:
                final_line = line
        proc.wait()

        payload: Dict[str, Any] = {}
        if final_line:
            try:
                payload = json.loads(final_line)
            except json.JSONDecodeError:
                payload = {}

        if proc.returncode != 0 or not payload.get("ok"):
            error = str(payload.get("error") or "Voice clone failed")[:500]
            _set_tts_job(active=False, stage="error", error=error)
            raise HTTPException(status_code=500, detail=error)

        _set_tts_job(active=False, stage="done", percent=100, detail="Voiceover ready")
        return list(payload.get("results") or [])
    finally:
        if _tts_job.get("active"):
            _set_tts_job(active=False)
        try:
            os.remove(job_path)
        except OSError:
            pass


@router.post("/audio/tts/batch")
def synthesize_batch(request: TtsBatchRequest):
    """Synthesize all voiceover segments with one shared speaker conditioning."""
    if not request.items:
        raise HTTPException(status_code=400, detail="items is required")
    if not os.path.isfile(SPEAKER_WAV):
        raise HTTPException(
            status_code=400,
            detail="No voice sample yet. Record your voice first (10+ seconds, clear speech).",
        )
    if not _coqui_available():
        raise HTTPException(status_code=503, detail="CLONE_ENGINE_MISSING")

    os.makedirs(AUDIO_DIR, exist_ok=True)
    stamp = int(time.time())
    items: List[Dict[str, Any]] = []
    spoken_texts: Dict[int, str] = {}
    for i, item in enumerate(request.items):
        raw = (item.text or "").strip()
        if not raw:
            continue
        if item.prepared_text and item.prepared_text.strip():
            spoken = to_spoken_text(item.prepared_text.strip())
        elif request.skip_prepare:
            spoken = raw
        else:
            spoken = prepare_text(raw, language=request.language, apply_stress=True)["spoken"]
        spoken_texts[item.index] = spoken
        items.append({
            "index": item.index,
            "text": spoken,
            "file_path": _audio_out(f"vo-{stamp}-{i:03d}", "wav"),
        })

    if not items:
        raise HTTPException(status_code=400, detail="all items are empty")

    language = "ru" if (request.language or "ru").startswith("ru") else "en"
    results = _run_xtts_batch({
        "speaker_wav": SPEAKER_WAV,
        "language": language,
        "seed": request.seed,
        "items": items,
    })
    for row in results:
        row["spoken_text"] = spoken_texts.get(row.get("index", -1), "")
    return {"status": "completed", "engine": "xtts", "results": results}


def _fit_speech_duration(
    src: str,
    dest: str,
    target_sec: float,
    *,
    min_tempo: float = 0.92,
    max_tempo: float = 1.20,
) -> Dict[str, Any]:
    """Speed up speech slightly so it fits a scene window (atempo > 1 shortens)."""
    source_sec = audio_duration_sec(src)
    window_sec = max(0.1, float(target_sec))
    if source_sec <= window_sec + 0.08:
        shutil.copy2(src, dest)
        return {
            "source_sec": round(source_sec, 3),
            "output_sec": round(source_sec, 3),
            "window_sec": round(window_sec, 3),
            "tempo": 1.0,
            "fitted": False,
        }

    tempo = min(max_tempo, max(min_tempo, source_sec / window_sec))
    cmd = [
        _ffmpeg_bin(), "-y", "-i", src,
        "-filter:a", f"atempo={tempo:.4f}",
        "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
        dest,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=500,
            detail=(exc.stderr or exc.stdout or "ffmpeg atempo failed")[:500],
        ) from exc
    output_sec = audio_duration_sec(dest)
    return {
        "source_sec": round(source_sec, 3),
        "output_sec": round(output_sec, 3),
        "window_sec": round(window_sec, 3),
        "tempo": round(tempo, 4),
        "fitted": True,
    }


@router.post("/audio/voiceover-track")
def mix_voiceover_track(request: VoiceoverTrackRequest):
    """Merge per-segment TTS clips into one continuous track.

    Each part is delayed to its absolute timeline position (adelay), the parts
    are mixed without loudness normalization (speech segments do not overlap),
    and the result is padded with silence to the full video duration. The
    editor then places a single clip on A1 instead of N fragments.
    """
    parts = [p for p in request.parts if (p.file_path or "").strip()]
    if not parts:
        raise HTTPException(status_code=400, detail="parts is required")
    resolved: List[tuple[str, float]] = []
    fit_stats: List[Dict[str, Any]] = []
    for idx, part in enumerate(parts):
        path = os.path.expanduser(part.file_path)
        if not os.path.isfile(path):
            raise HTTPException(status_code=400, detail=f"File not found: {part.file_path}")
        work_path = path
        if part.max_duration_sec and part.max_duration_sec > 0:
            fitted = _audio_out(f"fit-{idx}-{int(time.time())}", "wav")
            stat = _fit_speech_duration(path, fitted, part.max_duration_sec)
            stat["index"] = idx
            fit_stats.append(stat)
            work_path = fitted
        resolved.append((work_path, max(0.0, float(part.start_sec or 0.0))))
    resolved.sort(key=lambda item: item[1])

    dest = _audio_out(f"{request.output_name}-{int(time.time())}", "wav")
    cmd = [_ffmpeg_bin(), "-y"]
    for path, _start in resolved:
        cmd += ["-i", path]

    filters: List[str] = []
    labels: List[str] = []
    for i, (_path, start) in enumerate(resolved):
        delay_ms = int(round(start * 1000))
        # Unify rate/layout first: XTTS output may differ between segments,
        # and amix rejects mismatched inputs.
        filters.append(
            f"[{i}:a]aresample=48000,aformat=channel_layouts=mono,"
            f"adelay={delay_ms}:all=1[a{i}]"
        )
        labels.append(f"[a{i}]")
    filters.append(
        f"{''.join(labels)}amix=inputs={len(resolved)}:duration=longest:"
        f"dropout_transition=0:normalize=0[mix]"
    )
    out_label = "[mix]"
    if request.total_sec and request.total_sec > 0:
        filters.append(f"[mix]apad=whole_dur={request.total_sec}[out]")
        out_label = "[out]"

    cmd += [
        "-filter_complex", ";".join(filters),
        "-map", out_label,
        "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
        dest,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=500,
            detail=(exc.stderr or exc.stdout or "ffmpeg voiceover mix failed")[:500],
        ) from exc
    return {
        "status": "completed",
        "file_path": dest,
        "parts": len(resolved),
        "fit": fit_stats,
    }


def _parse_timestamp(raw: str) -> float:
    parts = [int(p) for p in raw.split(":")]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return float(parts[0])


def plan_video_timeline(prompt: str) -> dict:
    """Parse 'at 1:20 add audio / на 15 секунде озвучка: …' into overlay cues."""
    text = prompt or ""
    cues: List[dict] = []
    notes: List[str] = []

    line_re = re.compile(
        r"(?:^|\n)\s*(?:at|на)\s+"
        r"(?:"
        r"(?P<hms>\d{1,2}:\d{2}(?::\d{2})?)"
        r"|(?P<sec>\d+(?:[.,]\d+)?)\s*(?:s|sec|secs|сек|секунд[аыу]?)"
        r"|(?P<min>\d+(?:[.,]\d+)?)\s*(?:m|min|мин|минут[аыу]?)"
        r")"
        r"\s*[:\-–]?\s*(?P<body>[^\n]+)",
        re.IGNORECASE,
    )

    for match in line_re.finditer(text):
        if match.group("hms"):
            at_sec = _parse_timestamp(match.group("hms"))
        elif match.group("sec"):
            at_sec = float(match.group("sec").replace(",", "."))
        else:
            at_sec = float(match.group("min").replace(",", ".")) * 60
        body = match.group("body").strip()
        kind = "audio"
        tts_text = None
        if re.search(r"озвуч|голос|скажи|voiceover|tts|speak", body, re.IGNORECASE):
            kind = "tts"
            said = re.split(r"(?:озвуч[а-я]*|скажи|voiceover|tts|speak)\s*[:\-–]?\s*", body, maxsplit=1, flags=re.IGNORECASE)
            tts_text = said[-1].strip(" :\"'«»") if said else body
        elif re.search(r"музык|music|bed", body, re.IGNORECASE):
            kind = "music"
        cues.append({"at_sec": round(at_sec, 3), "kind": kind, "body": body, "tts_text": tts_text})
        notes.append(f"{at_sec:.1f}s — {kind}: {body}")

    if not cues:
        notes.append("No timestamps found. Use lines like: at 0:15 add captured audio / на 1:20 озвучка: текст")

    return {"cues": cues, "notes": notes}


@router.post("/video/timeline")
def apply_timeline(request: TimelineRequest):
    plan = plan_video_timeline(request.prompt)
    if request.dry_run:
        return {"status": "planned", "file_path": None, "plan": plan}

    video = os.path.expanduser(request.video_path or "")
    if not video or not os.path.isfile(video):
        raise HTTPException(status_code=400, detail="Choose a video file first.")

    cues = plan["cues"]
    if not cues:
        raise HTTPException(status_code=400, detail="Prompt has no timestamps to apply.")

    audio_clips: List[tuple[float, str]] = []
    for cue in cues:
        if cue["kind"] == "tts":
            tts = synthesize_voice(TtsRequest(text=cue.get("tts_text") or cue["body"]))
            audio_clips.append((cue["at_sec"], tts["file_path"]))
        else:
            src = os.path.expanduser(request.audio_path or "")
            if not src or not os.path.isfile(src):
                raise HTTPException(
                    status_code=400,
                    detail="Audio cue needs a captured/picked track. Record Mac audio first.",
                )
            audio_clips.append((cue["at_sec"], src))

    ffmpeg = _ffmpeg_bin()
    os.makedirs(VIDEO_DIR, exist_ok=True)
    base = os.path.splitext(os.path.basename(video))[0]
    output_path = os.path.join(VIDEO_DIR, f"{base}-mix.mp4")

    def build_cmd(with_base_audio: bool) -> list:
        cmd = [ffmpeg, "-y", "-i", video]
        for _, path in audio_clips:
            cmd += ["-i", path]
        heads = []
        labels = []
        for index, (at_sec, _) in enumerate(audio_clips, start=1):
            delay_ms = max(0, int(at_sec * 1000))
            heads.append(
                f"[{index}:a]aformat=sample_fmts=fltp:channel_layouts=stereo,"
                f"adelay={delay_ms}|{delay_ms}[a{index}]"
            )
            labels.append(f"[a{index}]")
        delayed = "".join(labels)
        n = len(audio_clips)
        if with_base_audio:
            graph = f"{';'.join(heads)};[0:a]{delayed}amix=inputs={n + 1}:duration=first:dropout_transition=2[aout]"
        else:
            graph = (
                f"anullsrc=channel_layout=stereo:sample_rate=48000[a0];{';'.join(heads)};"
                f"[a0]{delayed}amix=inputs={n + 1}:duration=longest:dropout_transition=2[aout]"
            )
        cmd += [
            "-filter_complex", graph,
            "-map", "0:v",
            "-map", "[aout]",
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            "-movflags", "+faststart",
            output_path,
        ]
        return cmd

    try:
        subprocess.run(build_cmd(True), check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError:
        try:
            subprocess.run(build_cmd(False), check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as exc:
            raise HTTPException(
                status_code=500,
                detail=(exc.stderr or exc.stdout or "ffmpeg mix failed")[:500],
            ) from exc

    return {"status": "completed", "file_path": output_path, "plan": plan}
