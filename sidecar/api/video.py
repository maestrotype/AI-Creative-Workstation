from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
import re
import shutil
import subprocess
import tempfile
from typing import List

router = APIRouter()


class AssembleRequest(BaseModel):
    image_paths: List[str]
    durations: List[float]
    width: int = 1920
    height: int = 1080
    output_name: str = "youtube-video"


def _ffmpeg_bin() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise HTTPException(
            status_code=503,
            detail="ffmpeg is not installed. Install it (e.g. brew install ffmpeg) to assemble videos.",
        )
    return path


@router.post("/video/assemble")
def assemble_video(request: AssembleRequest):
    if not request.image_paths or len(request.image_paths) != len(request.durations):
        raise HTTPException(status_code=400, detail="image_paths and durations must be non-empty and the same length")

    for path in request.image_paths:
        if not os.path.isfile(path):
            raise HTTPException(status_code=400, detail=f"Missing image: {path}")

    ffmpeg = _ffmpeg_bin()
    out_dir = os.path.expanduser("~/Documents/Canvas/Generated/Video")
    os.makedirs(out_dir, exist_ok=True)
    output_path = os.path.join(out_dir, f"{request.output_name}.mp4")

    w, h = request.width, request.height
    scale = f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},fps=30,format=yuv420p"

    with tempfile.TemporaryDirectory() as tmp:
        list_path = os.path.join(tmp, "concat.txt")
        with open(list_path, "w", encoding="utf-8") as handle:
            for path, duration in zip(request.image_paths, request.durations):
                safe = path.replace("'", "'\\''")
                handle.write(f"file '{safe}'\n")
                handle.write(f"duration {max(0.5, float(duration))}\n")
            last = request.image_paths[-1].replace("'", "'\\''")
            handle.write(f"file '{last}'\n")

        cmd = [
            ffmpeg,
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", list_path,
            "-vf", scale,
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            output_path,
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as exc:
            raise HTTPException(
                status_code=500,
                detail=(exc.stderr or exc.stdout or "ffmpeg failed")[:500],
            ) from exc

    return {"status": "completed", "file_path": output_path}


class CleanScreencastRequest(BaseModel):
    input_path: str
    prompt: str = ""
    dry_run: bool = False


def _ffprobe_bin() -> str:
    path = shutil.which("ffprobe")
    if not path:
        ffmpeg = _ffmpeg_bin()
        sibling = os.path.join(os.path.dirname(ffmpeg), "ffprobe")
        if os.path.isfile(sibling):
            return sibling
        raise HTTPException(
            status_code=503,
            detail="ffprobe is not installed. Install ffmpeg (brew install ffmpeg).",
        )
    return path


def _video_duration_sec(path: str) -> float:
    probe = _ffprobe_bin()
    result = subprocess.run(
        [probe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        check=True,
        capture_output=True,
        text=True,
    )
    try:
        return float(result.stdout.strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Could not read video duration") from exc


def _has_audio(path: str) -> bool:
    probe = _ffprobe_bin()
    result = subprocess.run(
        [probe, "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path],
        capture_output=True,
        text=True,
    )
    return bool(result.stdout.strip())


def plan_screencast_cleanup(prompt: str) -> dict:
    """Map a prompt to crop fractions and end-trim.

    Screen recordings usually have a content region plus browser chrome, player
    controls, and a stop-click in the last seconds. Full generative inpaint of
    every frame is too slow for long captures; crop+trim matches this workflow.
    """
    text = (prompt or "").lower()
    notes: List[str] = []

    mentions_browser = bool(re.search(
        r"browser|chrome|safari|вкладк|браузер|адресн|tabs?|omnibox|url bar",
        text,
    ))
    mentions_player = bool(re.search(
        r"play|pause|воспроизвед|плеер|player|controls?|timeline|scrubber|кнопк",
        text,
    ))
    mentions_stop_end = bool(re.search(
        r"stop|стоп|конц[аеу]|в конце|last seconds|end of|останови|recording button",
        text,
    ))
    mentions_dock = bool(re.search(r"\bdock\b|док|menubar|menu bar|строк[аи] меню", text))
    mentions_extra = bool(re.search(r"лишн|extra|interface|интерфейс|ui |chrome|мусор|clean", text))

    if mentions_extra and not (mentions_browser or mentions_player or mentions_stop_end):
        mentions_browser = True
        mentions_player = True
        mentions_stop_end = True

    if not text.strip():
        mentions_browser = True
        mentions_player = True
        mentions_stop_end = True
        notes.append(
            "Empty prompt: using the screen-recording preset "
            "(browser chrome, player bar, trim stop click)."
        )

    crop_top = 0.0
    crop_bottom = 0.0
    crop_left = 0.0
    crop_right = 0.0
    trim_end = 0.0

    if mentions_browser:
        crop_top = 0.12
        notes.append("Crop top ~12% (browser chrome / tabs / address bar).")
    if mentions_player:
        crop_bottom = max(crop_bottom, 0.14)
        notes.append("Crop bottom ~14% (playback controls / YouTube bar).")
    if mentions_dock:
        crop_bottom = max(crop_bottom, 0.10)
        notes.append("Crop bottom for dock / menu bar.")
    if mentions_stop_end:
        trim_end = 2.8
        notes.append("Trim the last 2.8s (stop-recording click and lingering UI).")

    if not notes:
        notes.append("No matching UI hints; video will be remuxed without crop or trim.")

    return {
        "crop_top": crop_top,
        "crop_bottom": crop_bottom,
        "crop_left": crop_left,
        "crop_right": crop_right,
        "trim_end_sec": trim_end,
        "notes": notes,
    }


@router.post("/video/clean-screencast")
def clean_screencast(request: CleanScreencastRequest):
    src = os.path.expanduser(request.input_path)
    if not os.path.isfile(src):
        raise HTTPException(status_code=400, detail=f"File not found: {src}")

    plan = plan_screencast_cleanup(request.prompt)
    if request.dry_run:
        return {"status": "planned", "file_path": None, "plan": plan}

    ffmpeg = _ffmpeg_bin()
    duration = _video_duration_sec(src)
    keep = duration - plan["trim_end_sec"]
    if keep < 0.5:
        raise HTTPException(status_code=400, detail="Video is shorter than the planned end trim.")

    top, bottom = plan["crop_top"], plan["crop_bottom"]
    left, right = plan["crop_left"], plan["crop_right"]
    vf = (
        f"crop=floor(iw*(1-{left}-{right})/2)*2:floor(ih*(1-{top}-{bottom})/2)*2:"
        f"floor(iw*{left}/2)*2:floor(ih*{top}/2)*2,format=yuv420p"
    )

    out_dir = os.path.expanduser("~/Documents/Canvas/Generated/Video")
    os.makedirs(out_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(src))[0]
    output_path = os.path.join(out_dir, f"{base}-cleaned.mp4")

    cmd = [
        ffmpeg, "-y",
        "-i", src,
        "-t", f"{keep:.3f}",
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "18",
    ]
    if _has_audio(src):
        cmd += ["-c:a", "aac", "-b:a", "192k"]
    else:
        cmd += ["-an"]
    cmd += ["-movflags", "+faststart", output_path]

    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=500,
            detail=(exc.stderr or exc.stdout or "ffmpeg failed")[:500],
        ) from exc

    return {"status": "completed", "file_path": output_path, "plan": plan}
