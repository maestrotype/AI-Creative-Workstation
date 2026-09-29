#!/usr/bin/env python3
"""Live re-run of VIDEO → VLM → OCR → beats → LLM → RAW SCRIPT for the demo Film."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SIDECAR = ROOT / "sidecar"
sys.path.insert(0, str(SIDECAR))

from frame_ocr import read_frames  # noqa: E402
from scene_understand import detect_vision_model  # noqa: E402
from script_llm import (  # noqa: E402
    _align_segments_to_beats,
    _build_director_prompt,
    _finalize_segments,
    _speech_beats,
    _try_ollama,
    _with_frame_captions,
    generate_voiceover_script,
)
from video_analyze import analyze_video  # noqa: E402

FILM_ID = "8cd095b2-7f44-4e38-ac81-709d5080ad7a"
PROJECT = Path.home() / "Documents/Canvas/Projects" / FILM_ID / "project.json"
OUT = Path(__file__).resolve().parent / "demo-проект-after"


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
    video_path = (
        (vo.get("analysis") or {}).get("source_path")
        or doc.get("assembledPath")
    )
    if not video_path or not os.path.isfile(video_path):
        raise SystemExit(f"demo video missing: {video_path}")

    vision = detect_vision_model()
    print(f"vision_model={vision or 'NONE'}", flush=True)
    print(f"analyzing {video_path}", flush=True)
    analysis = analyze_video(
        video_path,
        transcribe=False,
        scene_detect=True,
        visual_captions=True,
        language="ru",
        use_cache=False,
    )
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
    video_context = {**analysis, "chapters": chapters}

    dump("00-run-meta.json", {
        "film_id": doc["id"],
        "name": doc["name"],
        "video_path": video_path,
        "detected_vision_model": vision,
        "analysis_vision_model": analysis.get("vision_model"),
        "visual_quality": analysis.get("visual_quality"),
        "warnings": analysis.get("warnings"),
        "from_cache": analysis.get("from_cache"),
        "cache_version": analysis.get("cache_version"),
        "frames_sent": [
            {"index": row.get("index"), "frames_sent": row.get("frames_sent"), "source": row.get("source")}
            for row in (analysis.get("scene_analysis") or [])
        ],
    })
    dump("01-video.json", {
        "film_id": doc["id"],
        "name": doc["name"],
        "assembled_path": doc.get("assembledPath"),
        "analysis_source_path": analysis.get("source_path"),
        "duration_sec": analysis.get("duration_sec"),
        "v1_chapters": spans,
        "warnings": analysis.get("warnings"),
        "visual_quality": analysis.get("visual_quality"),
        "vision_model": analysis.get("vision_model"),
    })
    dump("02-analysis-saved.json", {
        "source_path": analysis.get("source_path"),
        "duration_sec": analysis.get("duration_sec"),
        "scenes": analysis.get("scenes"),
        "scene_analysis": analysis.get("scene_analysis"),
        "visual_notes": analysis.get("visual_notes"),
        "warnings": analysis.get("warnings"),
        "visual_quality": analysis.get("visual_quality"),
        "vision_model": analysis.get("vision_model"),
    })

    frames = [
        str(row.get("frame_path") or "")
        for row in (analysis.get("scene_analysis") or [])
        if row.get("frame_path")
    ]
    ocr = read_frames(frames)
    dump("02b-ocr-labels.json", {
        path: [line.get("text") for line in lines] for path, lines in ocr.items()
    })

    enriched = _with_frame_captions(video_context, "ru")
    beats = _speech_beats(enriched)
    dump("03-visual-beats.json", {
        "after_ocr_scene_analysis": [
            {
                "index": row.get("index"),
                "start": row.get("start"),
                "end": row.get("end"),
                "visual_summary": row.get("visual_summary"),
                "screen_type": row.get("screen_type"),
                "user_doing": row.get("user_doing"),
                "actions": row.get("actions"),
                "ui_elements": row.get("ui_elements"),
                "ocr_labels": row.get("ocr_labels"),
                "source": row.get("source"),
                "frames_sent": row.get("frames_sent"),
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
        "beat_count": len(beats),
        "visual_quality": analysis.get("visual_quality"),
        "vision_model": analysis.get("vision_model"),
        "function": "script_llm._build_director_prompt",
    })

    raw = _try_ollama(llm_prompt, model="qwen2.5:14b")
    dump("05-raw-script.json", {
        "captured": bool(raw),
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

    dump("07-generated-script.json", current)
    dump("08-shorten-decisions.json", {
        "rule": "DirectorBoard.applyScriptVoiceover: shorten if probed TTS duration > windowSec * 1.12",
        "this_run": "TTS not re-applied in this sidecar re-run. Shorten remains unused unless speech exceeds the window.",
        "segments": [
            {
                "index": i,
                "window_sec": round(max(0.8, float(seg.get("end_sec") or 0) - float(seg.get("start_sec") or 0)), 3),
                "text": seg.get("text"),
                "visual_summary": seg.get("visual_summary"),
            }
            for i, seg in enumerate(current.get("segments") or [])
        ],
    })
    dump("09-final-narration.json", {
        "note": "RAW SCRIPT is the acceptance surface. TTS remains downstream and was not remixed onto A1.",
        "spoken_text": [
            {
                "start_sec": seg.get("start_sec"),
                "end_sec": seg.get("end_sec"),
                "text": seg.get("text"),
            }
            for seg in (current.get("segments") or [])
        ],
        "meta": current.get("meta"),
    })

    print(f"wrote {OUT}", flush=True)
    print(
        f"quality={analysis.get('visual_quality')} "
        f"warnings={analysis.get('warnings')} "
        f"beats={len(beats)} "
        f"raw_segs={len((raw or {}).get('segments') or [])} "
        f"generated={len(current.get('segments') or [])}",
        flush=True,
    )


if __name__ == "__main__":
    main()
