from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from typing import List, Optional
from urllib.parse import unquote

router = APIRouter()


def _video_draft_dir() -> str:
    """Working copies only. The app copies out via Save As, like 3D mesh drafts."""
    path = os.path.expanduser("~/Documents/Canvas/Generated/Video/drafts")
    os.makedirs(path, exist_ok=True)
    return path


def _disk_image_path(path: str) -> str:
    """asset:// URLs may include a cache-buster query; ffmpeg needs the real file."""
    cleaned = (path or "").split("?", 1)[0]
    if cleaned.startswith("asset://"):
        cleaned = cleaned[len("asset://") :]
    return unquote(cleaned)


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

    image_paths = [_disk_image_path(p) for p in request.image_paths]
    for path in image_paths:
        if not os.path.isfile(path):
            raise HTTPException(status_code=400, detail=f"Missing image: {path}")

    ffmpeg = _ffmpeg_bin()
    output_path = os.path.join(_video_draft_dir(), f"draft-{uuid.uuid4().hex[:12]}.mp4")

    w, h = request.width, request.height
    # Even sizes required by libx264 / zoompan.
    w = max(2, w - (w % 2))
    h = max(2, h - (h % 2))

    with tempfile.TemporaryDirectory() as tmp:
        clips = []
        for idx, (path, duration) in enumerate(zip(image_paths, request.durations)):
            frames = max(45, int(round(max(1.0, float(duration)) * 30)))
            clip = os.path.join(tmp, f"clip_{idx:03d}.mp4")
            vf = _ken_burns_filter(idx, w, h, frames)
            cmd = [
                ffmpeg, "-y",
                "-loop", "1",
                "-i", path,
                "-frames:v", str(frames),
                "-vf", vf,
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                "-an",
                clip,
            ]
            try:
                subprocess.run(cmd, check=True, capture_output=True, text=True)
            except subprocess.CalledProcessError as exc:
                raise HTTPException(
                    status_code=500,
                    detail=(exc.stderr or exc.stdout or "ffmpeg still clip failed")[:500],
                ) from exc
            clips.append(clip)

        _concat_with_xfade(ffmpeg, clips, request.durations, output_path)

    return {"status": "completed", "file_path": output_path}


def _ken_burns_filter(index: int, w: int, h: int, frames: int) -> str:
    """Visible camera move on a still. Not generative motion — just Ken Burns."""
    last = max(1, frames - 1)
    # Scale large so zoom/pan has pixels to travel.
    prep = f"scale={w * 2}:{h * 2}:force_original_aspect_ratio=increase,crop={w * 2}:{h * 2}"
    kind = index % 6
    if kind == 0:
        z, x, y = "min(1+0.0018*on,1.32)", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    elif kind == 1:
        z, x, y = "min(1+0.0014*on,1.28)", f"min((iw-iw/zoom)*on/{last},iw-iw/zoom)", "ih/2-(ih/zoom/2)"
    elif kind == 2:
        z, x, y = "min(1+0.0014*on,1.28)", f"max((iw-iw/zoom)*(1-on/{last}),0)", "ih/2-(ih/zoom/2)"
    elif kind == 3:
        z, x, y = "if(lte(on,1),1.28,max(1.28-0.0015*on,1.02))", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    elif kind == 4:
        z, x, y = "min(1+0.0013*on,1.24)", "iw/2-(iw/zoom/2)", f"min((ih-ih/zoom)*on/{last},ih-ih/zoom)"
    else:
        z, x, y = "min(1+0.0016*on,1.3)", "iw/2-(iw/zoom/2)", f"max((ih-ih/zoom)*(1-on/{last}),0)"
    return (
        f"{prep},zoompan=z='{z}':x='{x}':y='{y}':d={frames}:s={w}x{h}:fps=30,format=yuv420p"
    )


def _concat_with_xfade(ffmpeg: str, clips: list, durations: list, output_path: str) -> None:
    """Crossfade still-clips so cuts are not a hard slideshow."""
    if len(clips) == 1:
        cmd = [
            ffmpeg, "-y", "-i", clips[0],
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            output_path,
        ]
        _run_ffmpeg(cmd, "ffmpeg assemble failed")
        return

    fade = 0.7
    inputs: list[str] = []
    for clip in clips:
        inputs.extend(["-i", clip])

    parts = ["[0]setpts=PTS-STARTPTS[v0]"]
    last = "[v0]"
    offset = max(0.2, float(durations[0]) - fade)
    for i in range(1, len(clips)):
        cur = f"v{i}"
        nxt = f"x{i}"
        parts.append(f"[{i}]setpts=PTS-STARTPTS[{cur}]")
        parts.append(
            f"{last}[{cur}]xfade=transition=fade:duration={fade}:offset={offset:.3f}[{nxt}]"
        )
        last = f"[{nxt}]"
        offset += max(0.2, float(durations[i]) - fade)

    graph = ";".join(parts)
    cmd = [
        ffmpeg, "-y", *inputs,
        "-filter_complex", graph,
        "-map", last,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path,
    ]
    _run_ffmpeg(cmd, "ffmpeg xfade failed")


def _run_ffmpeg(cmd: list, fallback: str) -> None:
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        # The tail of stderr carries the actual error; the head is the banner.
        raise HTTPException(
            status_code=500,
            detail=(exc.stderr or exc.stdout or fallback)[-600:],
        ) from exc


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

    output_path = os.path.join(_video_draft_dir(), f"draft-{uuid.uuid4().hex[:12]}.mp4")

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


# ── Timeline render: the single "make MP4" for the director desk ──────────────


class TimelineClipModel(BaseModel):
    kind: str  # video | image | audio | text
    track: str  # v1 | v2 | a1 | t1
    path: Optional[str] = None
    text: Optional[str] = None
    start_sec: float
    duration_sec: float
    source_in_sec: float = 0.0


class RenderTimelineRequest(BaseModel):
    clips: List[TimelineClipModel]
    width: int = 1920
    height: int = 1080
    fps: int = 30


_SEG_AUDIO = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"]


def _caption_font() -> Optional[str]:
    for candidate in (
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if os.path.isfile(candidate):
            return candidate
    return None


def _render_caption_png(text: str, video_w: int, video_h: int, out: str) -> None:
    """Captions as PNG overlays: many ffmpeg builds ship without drawtext."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="Pillow is required for captions (pip install pillow).",
        ) from exc

    size = max(18, video_h // 18)
    font_path = _caption_font()
    font = ImageFont.truetype(font_path, size) if font_path else ImageFont.load_default()
    pad = size // 2

    probe = ImageDraw.Draw(Image.new("RGBA", (8, 8)))
    box = probe.textbbox((0, 0), text, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    img = Image.new("RGBA", (min(video_w - 16, tw + pad * 2), th + pad * 2), (0, 0, 0, 115))
    draw = ImageDraw.Draw(img)
    draw.text((pad - box[0], pad - box[1]), text, font=font, fill=(255, 255, 255, 255))
    img.save(out)


def _fit_filter(w: int, h: int, fps: int) -> str:
    return (
        f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
        f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,fps={fps},format=yuv420p"
    )


def _encode_segment(ffmpeg: str, clip: TimelineClipModel, dur: float, index: int,
                    w: int, h: int, fps: int, out: str) -> None:
    """Uniform WxH/fps/aac segments so the base track can be concat-copied."""
    src = _disk_image_path(clip.path or "")
    if not os.path.isfile(src):
        raise HTTPException(status_code=400, detail=f"Missing source: {src}")
    silence = ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
    if clip.kind == "image":
        frames = max(2, int(round(dur * fps)))
        cmd = [
            ffmpeg, "-y", "-loop", "1", "-t", f"{dur:.3f}", "-i", src, *silence,
            "-frames:v", str(frames),
            "-vf", _ken_burns_filter(index, w, h, frames),
            "-map", "0:v", "-map", "1:a",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", *_SEG_AUDIO,
            out,
        ]
    else:
        audio_map = ["-map", "0:a"] if _has_audio(src) else ["-map", "1:a"]
        cmd = [
            ffmpeg, "-y",
            "-ss", f"{max(0.0, clip.source_in_sec):.3f}", "-t", f"{dur:.3f}", "-i", src,
            *silence,
            "-vf", _fit_filter(w, h, fps),
            "-map", "0:v", *audio_map,
            "-t", f"{dur:.3f}",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", *_SEG_AUDIO,
            out,
        ]
    _run_ffmpeg(cmd, "ffmpeg segment failed")


def _encode_gap(ffmpeg: str, dur: float, w: int, h: int, fps: int, out: str) -> None:
    cmd = [
        ffmpeg, "-y",
        "-f", "lavfi", "-t", f"{dur:.3f}", "-i", f"color=black:s={w}x{h}:r={fps}",
        "-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo",
        "-vf", "format=yuv420p",
        "-c:v", "libx264", *_SEG_AUDIO,
        out,
    ]
    _run_ffmpeg(cmd, "ffmpeg gap failed")


@router.post("/video/render-timeline")
def render_timeline(request: RenderTimelineRequest):
    if not request.clips:
        raise HTTPException(status_code=400, detail="Timeline is empty")

    ffmpeg = _ffmpeg_bin()
    w = max(2, request.width - (request.width % 2))
    h = max(2, request.height - (request.height % 2))
    fps = max(10, min(60, request.fps))
    total = max(c.start_sec + c.duration_sec for c in request.clips)
    if total <= 0.1:
        raise HTTPException(status_code=400, detail="Timeline is too short")

    v1 = sorted([c for c in request.clips if c.track == "v1"], key=lambda c: c.start_sec)
    overlays = sorted(
        [c for c in request.clips if c.track.startswith("v") and c.track != "v1"],
        key=lambda c: (c.track, c.start_sec),
    )
    if not v1 and overlays:
        first = min(overlays, key=lambda c: int(c.track[1:]) if c.track[1:].isdigit() else 99).track
        v1 = sorted([c for c in overlays if c.track == first], key=lambda c: c.start_sec)
        overlays = [c for c in overlays if c.track != first]
    audio_clips = [c for c in request.clips if c.track.startswith("a") and c.path]
    title_clips = [c for c in request.clips if c.track.startswith("t") and (c.text or "").strip()]

    OVERLAY_POSITIONS = [
        ("W-w-32", "32"),
        ("32", "32"),
        ("W-w-32", "H-h-32"),
        ("32", "H-h-32"),
    ]

    def overlay_xy(track: str) -> tuple[str, str]:
        try:
            idx = max(0, int(track[1:]) - 2)
        except ValueError:
            idx = 0
        return OVERLAY_POSITIONS[idx % len(OVERLAY_POSITIONS)]

    output_path = os.path.join(_video_draft_dir(), f"draft-{uuid.uuid4().hex[:12]}.mp4")

    with tempfile.TemporaryDirectory() as tmp:
        # Pass 1: main track (V1) into one uniform base file, gaps become black.
        segments: List[str] = []
        cursor = 0.0
        for idx, clip in enumerate(v1):
            start = max(clip.start_sec, cursor)
            dur = clip.duration_sec - (start - clip.start_sec)
            if dur <= 0.05:
                continue
            if start - cursor > 0.05:
                gap = os.path.join(tmp, f"gap_{idx:03d}.mp4")
                _encode_gap(ffmpeg, start - cursor, w, h, fps, gap)
                segments.append(gap)
            seg = os.path.join(tmp, f"seg_{idx:03d}.mp4")
            shifted = TimelineClipModel(
                **{**clip.dict(), "source_in_sec": clip.source_in_sec + (start - clip.start_sec)}
            )
            _encode_segment(ffmpeg, shifted, dur, idx, w, h, fps, seg)
            segments.append(seg)
            cursor = start + dur
        if total - cursor > 0.05:
            tail = os.path.join(tmp, "gap_tail.mp4")
            _encode_gap(ffmpeg, total - cursor, w, h, fps, tail)
            segments.append(tail)
        if not segments:
            raise HTTPException(status_code=400, detail="Main track (V1) is empty")

        base = os.path.join(tmp, "base.mp4")
        if len(segments) == 1:
            shutil.copyfile(segments[0], base)
        else:
            listing = os.path.join(tmp, "concat.txt")
            with open(listing, "w", encoding="utf-8") as fh:
                for seg in segments:
                    fh.write(f"file '{seg}'\n")
            _run_ffmpeg(
                [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", listing, "-c", "copy", base],
                "ffmpeg concat failed",
            )

        # Pass 2: overlays (V2), captions (T1), extra audio (A1) on top of the base.
        if not overlays and not audio_clips and not title_clips:
            _run_ffmpeg(
                [ffmpeg, "-y", "-i", base, "-c", "copy", "-movflags", "+faststart", output_path],
                "ffmpeg finalize failed",
            )
            return {"status": "completed", "file_path": output_path, "duration_sec": total}

        inputs: List[str] = ["-i", base]
        parts: List[str] = []
        input_idx = 1

        vcur = "[0:v]"
        pip_w = int(w * 0.38) // 2 * 2
        for k, clip in enumerate(overlays):
            src = _disk_image_path(clip.path or "")
            if not os.path.isfile(src):
                raise HTTPException(status_code=400, detail=f"Missing overlay source: {src}")
            end = clip.start_sec + clip.duration_sec
            ox, oy = overlay_xy(clip.track)
            if clip.kind == "image":
                inputs += ["-loop", "1", "-t", f"{clip.duration_sec:.3f}", "-i", src]
            else:
                inputs += [
                    "-ss", f"{max(0.0, clip.source_in_sec):.3f}",
                    "-t", f"{clip.duration_sec:.3f}", "-i", src,
                ]
            parts.append(
                f"[{input_idx}:v]scale={pip_w}:-2,"
                f"setpts=PTS-STARTPTS+{clip.start_sec:.3f}/TB[ov{k}]"
            )
            parts.append(
                f"{vcur}[ov{k}]overlay=x={ox}:y={oy}:eof_action=pass:"
                f"enable='between(t,{clip.start_sec:.3f},{end:.3f})'[vo{k}]"
            )
            vcur = f"[vo{k}]"
            input_idx += 1

        for k, clip in enumerate(title_clips):
            end = clip.start_sec + clip.duration_sec
            png = os.path.join(tmp, f"caption_{k:02d}.png")
            _render_caption_png((clip.text or "").strip(), w, h, png)
            inputs += ["-loop", "1", "-t", f"{clip.duration_sec:.3f}", "-i", png]
            parts.append(
                f"[{input_idx}:v]setpts=PTS-STARTPTS+{clip.start_sec:.3f}/TB[cap{k}]"
            )
            parts.append(
                f"{vcur}[cap{k}]overlay=x=(W-w)/2:y=H-h-H*0.08:eof_action=pass:"
                f"enable='between(t,{clip.start_sec:.3f},{end:.3f})'[tx{k}]"
            )
            vcur = f"[tx{k}]"
            input_idx += 1

        audio_labels = ["[0:a]"]
        for k, clip in enumerate(audio_clips):
            src = _disk_image_path(clip.path or "")
            if not os.path.isfile(src):
                raise HTTPException(status_code=400, detail=f"Missing audio source: {src}")
            inputs += [
                "-ss", f"{max(0.0, clip.source_in_sec):.3f}",
                "-t", f"{clip.duration_sec:.3f}", "-i", src,
            ]
            ms = int(round(clip.start_sec * 1000))
            parts.append(
                f"[{input_idx}:a]aresample=48000,adelay={ms}:all=1[au{k}]"
            )
            audio_labels.append(f"[au{k}]")
            input_idx += 1

        if len(audio_labels) > 1:
            parts.append(
                f"{''.join(audio_labels)}amix=inputs={len(audio_labels)}:"
                f"duration=first:dropout_transition=0:normalize=0[aout]"
            )
            amap = "[aout]"
        else:
            amap = "0:a"

        graph = ";".join(parts)
        vmap = vcur if vcur != "[0:v]" else "0:v"
        cmd = [
            ffmpeg, "-y", *inputs,
            "-filter_complex", graph,
            "-map", vmap,
            "-map", amap,
            "-t", f"{total:.3f}",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
            output_path,
        ]
        _run_ffmpeg(cmd, "ffmpeg timeline render failed")

    return {"status": "completed", "file_path": output_path, "duration_sec": total}
