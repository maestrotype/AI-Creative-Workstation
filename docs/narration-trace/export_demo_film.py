#!/usr/bin/env python3
"""Export VIDEO → TTS intermediates for one real Film (Демо проект)."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SIDECAR = ROOT / "sidecar"
sys.path.insert(0, str(SIDECAR))

from frame_ocr import read_frames  # noqa: E402
from script_llm import (  # noqa: E402
    _align_segments_to_beats,
    _build_director_prompt,
    _finalize_segments,
    _speech_beats,
    _try_ollama,
    _with_frame_captions,
    generate_voiceover_script,
)

FILM_ID = "8cd095b2-7f44-4e38-ac81-709d5080ad7a"
PROJECT = Path.home() / "Documents/Canvas/Projects" / FILM_ID / "project.json"
OUT = Path(__file__).resolve().parent / "demo-проект"


def dump(name: str, payload) -> Path:
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(payload, str):
        path.write_text(payload, encoding="utf-8")
    else:
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def v1_spans(doc: dict) -> list[dict]:
    tl = doc.get("timeline") or {}
    bins = {b["id"]: b for b in (tl.get("bins") or [])}
    out = []
    for clip in tl.get("clips") or []:
        if clip.get("track") != "v1" or not clip.get("binId"):
            continue
        bin_item = bins.get(clip["binId"]) or {}
        if bin_item.get("kind") != "video":
            continue
        dur = max(0.5, float(clip.get("durationSec") or bin_item.get("durationSec") or 0))
        out.append({
            "title": (clip.get("label") or bin_item.get("name") or "Глава").strip(),
            "start": float(clip.get("startSec") or 0),
            "end": float(clip.get("startSec") or 0) + dur,
            "bin_path": bin_item.get("path"),
            "bin_name": bin_item.get("name"),
        })
    return sorted(out, key=lambda row: row["start"])


def chapters_payload(spans: list[dict], transcript_segs: list) -> list[dict]:
    """Mirror chapterNarration.buildChapterPlan + withTranscript for this Film.

    2 V1 clips ≠ 8 marketplace blocks, and 5 script segs ≠ 2 spans,
    so drafts stay empty — same as the live generateScript path.
    """
    rows = []
    for span in spans:
        said = " ".join(
            str(seg.get("text") or "").strip()
            for seg in transcript_segs
            if min(span["end"], float(seg.get("end") or 0)) - max(span["start"], float(seg.get("start") or 0)) > 0.2
        )
        rows.append({
            "title": span["title"],
            "start": round(span["start"], 2),
            "end": round(span["end"], 2),
            "intent": "",
            "draft": "",
            "said": said[:700],
        })
    return rows


def main() -> None:
    doc = json.loads(PROJECT.read_text(encoding="utf-8"))
    vo = doc["voiceover"]
    analysis = vo["analysis"]
    script = vo.get("script") or {}
    persisted = script.get("segments") or []
    prompt = vo.get("scriptPrompt") or ""
    chapter_note = (
        "Замени авторскую озвучку. Минута картины — это несколько реплик по ходу кадра, "
        "не одна фраза на всю главу. Пиши то, что видно и что меняется, опираясь на разбор "
        "кадров и на слова автора. Черновик главы — смысл, не текст для копирования."
    )
    full_prompt = "\n\n".join(part for part in (prompt, chapter_note) if part)
    project_context = vo.get("projectContext") or doc.get("brief") or ""
    spans = v1_spans(doc)
    chapters = chapters_payload(spans, (analysis.get("transcript") or {}).get("segments") or [])

    video_context = {
        **analysis,
        "chapters": chapters,
    }

    dump("01-video.json", {
        "film_id": doc["id"],
        "name": doc["name"],
        "assembled_path": doc.get("assembledPath"),
        "analysis_source_path": analysis.get("source_path"),
        "duration_sec": analysis.get("duration_sec"),
        "v1_chapters": spans,
        "warnings": analysis.get("warnings"),
        "whisper_available": analysis.get("whisper_available"),
        "transcript": analysis.get("transcript"),
        "ffmpeg_scenes": analysis.get("scenes"),
        "export_settings": doc.get("exportSettings"),
    })
    dump("02-analysis-saved.json", {
        "source_path": analysis.get("source_path"),
        "duration_sec": analysis.get("duration_sec"),
        "scenes": analysis.get("scenes"),
        "scene_analysis": analysis.get("scene_analysis"),
        "visual_notes": analysis.get("visual_notes"),
        "warnings": analysis.get("warnings"),
        "note": "VISION_MODEL_MISSING — visual_summary is empty; OCR runs later in script_llm._with_frame_captions",
    })

    frames = [
        str(row.get("frame_path") or "")
        for row in (analysis.get("scene_analysis") or [])
        if row.get("frame_path")
    ]
    ocr = read_frames(frames)
    ocr_out = {path: [line.get("text") for line in lines] for path, lines in ocr.items()}
    dump("02b-ocr-labels.json", ocr_out)

    enriched = _with_frame_captions(video_context, "ru")
    beats = _speech_beats(enriched)
    dump("03-visual-beats.json", {
        "after_ocr_scene_analysis": [
            {
                "index": row.get("index"),
                "start": row.get("start"),
                "end": row.get("end"),
                "visual_summary": row.get("visual_summary"),
                "ui_elements": row.get("ui_elements"),
                "source": row.get("source"),
                "frame_path": row.get("frame_path"),
                "narration_recommended": row.get("narration_recommended"),
            }
            for row in (enriched.get("scene_analysis") or [])
        ],
        "speech_beats": beats,
        "chapters_sent_to_llm": chapters,
    })

    llm_prompt = _build_director_prompt(enriched, full_prompt, "ru", 130, project_context)
    dump("04-llm-input.txt", llm_prompt)
    dump("04-llm-input-meta.json", {
        "prompt": full_prompt,
        "project_context": project_context,
        "language": "ru",
        "target_wpm": 130,
        "model_requested": "qwen2.5:7b default / persisted qwen2.5:14b",
        "beat_count": len(beats),
        "function": "script_llm._build_director_prompt",
    })

    raw = _try_ollama(llm_prompt, model="qwen2.5:14b")
    dump("05-raw-script.json", {
        "captured": bool(raw),
        "note": (
            "Historical raw Ollama JSON is not persisted by the app. "
            "This file is a live re-run of _try_ollama with the reconstructed prompt, "
            "or empty if Ollama is down."
        ),
        "ollama": raw,
    })

    current = generate_voiceover_script(
        video_context,
        full_prompt,
        language="ru",
        target_wpm=130,
        prefer_ollama=True,
        ollama_model="qwen2.5:14b",
        project_context=project_context,
    )
    dump("06-current-generate-output.json", current)

    if raw and isinstance(raw.get("segments"), list):
        finalized = _finalize_segments(
            [item for item in raw["segments"] if isinstance(item, dict)],
            enriched,
            "ru",
            130,
        )
        aligned = _align_segments_to_beats(finalized, beats, "ru", 130, project_context)
        dump("05b-raw-after-finalize-align.json", {
            "after_finalize": finalized,
            "after_align": aligned,
        })

    dump("07-persisted-script.json", {
        "status": vo.get("status"),
        "meta": script.get("meta"),
        "segments": persisted,
        "note": "This is what Film saved after the last successful generate + apply. Provider ollama / planner chapters.",
    })

    shorten_rows = []
    for i, seg in enumerate(persisted):
        start = float(seg.get("start_sec") or 0)
        end = float(seg.get("end_sec") or start)
        window = max(0.8, end - start)
        speech = float(seg.get("speech_sec") or 0)
        shorten_rows.append({
            "index": i,
            "window_sec": round(window, 3),
            "speech_sec": speech,
            "threshold_sec": round(window * 1.12, 3),
            "would_shorten": bool(speech and speech > window * 1.12),
            "target_sec_if_shorten": round(max(1.0, window * 0.85), 3),
            "text": seg.get("text"),
            "audio_path": seg.get("audio_path"),
            "visual_summary": seg.get("visual_summary"),
            "purpose": seg.get("purpose"),
        })
    dump("08-shorten-decisions.json", {
        "rule": "DirectorBoard.applyScriptVoiceover: shorten if probed TTS duration > windowSec * 1.12",
        "ipc": "shorten-script → sidecar /api/script/shorten → script_llm.shorten_spoken",
        "this_run": "No segment crossed the threshold — SHORTENED SCRIPT == RAW SCRIPT text.",
        "segments": shorten_rows,
    })

    audio_dir = Path.home() / "Documents/Canvas/Generated/Audio"
    mixed = [
        str(p) for p in sorted(audio_dir.glob(f"voiceover-{FILM_ID}-*.wav"))
    ]
    latest_mix = mixed[-1] if mixed else None
    dump("09-final-narration.json", {
        "a1_clip": {
            "label": "AI narration",
            "start_sec": 0,
            "duration_sec": 62.22,
            "file_path": latest_mix,
        },
        "mixed_tracks": mixed[-4:],
        "tts_parts_latest": [
            str(p) for p in sorted(audio_dir.glob("vo-1790493565-*.wav"))
        ],
        "fit_parts_latest": [
            str(p) for p in sorted(audio_dir.glob("fit-*-1790493603.wav"))
        ],
        "mix_api": "mix-voiceover-track → /api/audio/voiceover-track",
        "spoken_text": [
            {"start_sec": s.get("start_sec"), "end_sec": s.get("end_sec"), "text": s.get("text"), "speech_sec": s.get("speech_sec")}
            for s in persisted
        ],
    })

    print(f"wrote {OUT}")
    print(f"beats={len(beats)} persisted_segs={len(persisted)} current_segs={len(current.get('segments') or [])} raw={bool(raw)}")


if __name__ == "__main__":
    main()
