from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
import re
import shutil
import subprocess
from typing import List, Optional

router = APIRouter()

AUDIO_DIR = os.path.expanduser("~/Documents/Canvas/Generated/Audio")
VOICE_DIR = os.path.expanduser("~/Documents/Canvas/Voice")
VIDEO_DIR = os.path.expanduser("~/Documents/Canvas/Generated/Video")
SPEAKER_WAV = os.path.join(VOICE_DIR, "speaker.wav")


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


@router.get("/audio/voice")
def voice_status():
    return {
        "has_sample": os.path.isfile(SPEAKER_WAV),
        "file_path": SPEAKER_WAV if os.path.isfile(SPEAKER_WAV) else None,
        "tts_ready": _tts_available(),
    }


@router.post("/audio/voice")
def save_voice(request: SaveVoiceRequest):
    os.makedirs(VOICE_DIR, exist_ok=True)
    _convert(os.path.expanduser(request.input_path), SPEAKER_WAV, "wav")
    return {"status": "saved", "file_path": SPEAKER_WAV, "has_sample": True}


def _tts_available() -> bool:
    try:
        import TTS  # noqa: F401

        return True
    except ImportError:
        return False


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
    if not _tts_available():
        raise HTTPException(
            status_code=503,
            detail="Voice clone needs Coqui TTS in the sidecar: pip3 install TTS",
        )

    from TTS.api import TTS as CoquiTTS

    os.makedirs(AUDIO_DIR, exist_ok=True)
    dest = _audio_out(f"tts-{abs(hash(text)) % 10_000_000}", "wav")
    lang = "ru" if re.search(r"[а-яА-ЯёЁ]", text) else (request.language or "en")
    try:
        tts = CoquiTTS("tts_models/multilingual/multi-dataset/xtts_v2")
        tts.tts_to_file(
            text=text,
            speaker_wav=SPEAKER_WAV,
            language="ru" if lang.startswith("ru") else "en",
            file_path=dest,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)[:500]) from exc
    return {"status": "completed", "file_path": dest}


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
