from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from typing import Any, Dict, List, Optional

router = APIRouter()

AUDIO_DIR = os.path.expanduser("~/Documents/Canvas/Generated/Audio")
VOICE_DIR = os.path.expanduser("~/Documents/Canvas/Voice")
VIDEO_DIR = os.path.expanduser("~/Documents/Canvas/Generated/Video")
SPEAKER_WAV = os.path.join(VOICE_DIR, "speaker.wav")
SOURCE_META = os.path.join(VOICE_DIR, "source.json")

_tts_lock = threading.Lock()
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


def _write_source_meta(input_path: str) -> None:
    os.makedirs(VOICE_DIR, exist_ok=True)
    resolved = os.path.expanduser(input_path)
    payload = {
        "path": resolved,
        "name": os.path.basename(resolved),
    }
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


class TtsRequest(BaseModel):
    text: str
    language: str = "ru"


class TimelineRequest(BaseModel):
    prompt: str
    video_path: Optional[str] = None
    audio_path: Optional[str] = None
    dry_run: bool = False


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


def _clone_python() -> Optional[str]:
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    verify = os.path.join(here, "verify_xtts.py")
    candidates = [
        os.path.join(here, ".venv-tts", "bin", "python"),
        os.path.join(here, ".venv-tts", "bin", "python3"),
    ]
    env = {**os.environ, "COQUI_TOS_AGREED": "1"}
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
            return py
    return None


def _coqui_available() -> bool:
    return _clone_python() is not None


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


@router.get("/audio/voice")
def voice_status():
    engine = "xtts" if _coqui_available() else "none"
    meta = _read_source_meta()
    return {
        "has_sample": os.path.isfile(SPEAKER_WAV),
        "file_path": SPEAKER_WAV if os.path.isfile(SPEAKER_WAV) else None,
        "source_path": meta.get("path") if meta else None,
        "source_name": meta.get("name") if meta else None,
        "tts_ready": engine == "xtts",
        "engine": engine,
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


@router.post("/audio/voice")
def save_voice(request: SaveVoiceRequest):
    os.makedirs(VOICE_DIR, exist_ok=True)
    src = os.path.expanduser(request.input_path)
    _convert(src, SPEAKER_WAV, "wav")
    _write_source_meta(src)
    meta = _read_source_meta()
    return {
        "status": "saved",
        "file_path": SPEAKER_WAV,
        "has_sample": True,
        "source_path": meta.get("path") if meta else src,
        "source_name": meta.get("name") if meta else os.path.basename(src),
    }


@router.post("/audio/tts")
def synthesize_voice(request: TtsRequest):
    text = (request.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if not os.path.isfile(SPEAKER_WAV):
        raise HTTPException(
            status_code=400,
            detail="No voice sample yet. Record your voice first (10+ seconds, clear speech).",
        )
    if not _coqui_available():
        raise HTTPException(status_code=503, detail="CLONE_ENGINE_MISSING")

    os.makedirs(AUDIO_DIR, exist_ok=True)
    dest = _audio_out(f"tts-{abs(hash(text)) % 10_000_000}", "wav")
    lang = "ru" if re.search(r"[а-яА-ЯёЁ]", text) else (request.language or "en")
    _run_xtts_clone(text, dest, lang)
    return {"status": "completed", "file_path": dest, "engine": "xtts"}


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
