# Exact code path — Демо проект (`8cd095b2-7f44-4e38-ac81-709d5080ad7a`)

Film = `ProjectDoc`. Source of truth: `~/Documents/Canvas/Projects/8cd095b2-…/project.json`.

```
VIDEO
  DirectorBoard.analyzeVoiceover
    → assemble V1 if 2+ chapter clips (ensureAssembledPreview)
    → IPC analyze-video
    → sidecar POST /api/video/analyze
    → video_analyze.analyze_video
        probe duration
        scene_detect.detect_scenes          → ffmpeg cuts
        scene_understand.analyze_visual_scenes
            analysis_windows + extract_window_frames
            VLM _ask_vlm  OR  empty captions if VISION_MODEL_MISSING
        transcribe.transcribe_video         → Whisper (empty here)
        save ~/Documents/Canvas/Generated/Video/analysis/*.json
↓
VISUAL BEATS
  DirectorBoard.generateScript / replaceOwnNarration
    buildChapterPlan + withTranscript + chaptersPayload
    video_context = analysis + chapters
    IPC generate-script
    → sidecar POST /api/script/generate
    → script_llm.generate_voiceover_script
        _with_frame_captions                → OCR via frame_ocr.read_frames
        _speech_beats / _beats_from_analysis
↓
LLM INPUT
        _build_director_prompt              → 04-llm-input.txt
↓
RAW SCRIPT
        _try_ollama(qwen2.5:14b, format=json)
        _finalize_segments
        _align_segments_to_beats  (or _snap_segments_to_chapters)
        saved on ProjectDoc.voiceover.script
↓
SHORTENED SCRIPT
  DirectorBoard.applyScriptVoiceover
    synthesizeVoice / synthesizeVoiceBatch
    if TTS duration > window * 1.12:
        IPC shorten-script
        → POST /api/script/shorten
        → script_llm.shorten_spoken
        re-TTS
    THIS FILM: no segment crossed the threshold
↓
FINAL NARRATION
    IPC mix-voiceover-track
    → POST /api/audio/voiceover-track
    → sidecar.api.audio.mix_voiceover_track
    ingestAudioPathAt(mixed.wav, 0, 'AI narration') → A1
```

## Call sites (line-accurate)

| Step | File | Function |
|---|---|---|
| UI trigger | `src/renderer/src/features/video/ui/DirectorBoard.tsx` | `analyzeVoiceover` ~2027, `generateScript` ~2140, `applyScriptVoiceover` ~2265 |
| Chapter plan | `src/renderer/src/features/video/model/chapterNarration.ts` | `v1ChapterSpans`, `buildChapterPlan`, `chaptersPayload` |
| IPC | `src/main/index.ts` | `analyze-video` 1728, `generate-script` 1762, `shorten-script` 1775, `mix-voiceover-track` 2135 |
| Analyze HTTP | `sidecar/api/video.py` | `analyze_video_route` |
| Analyze core | `sidecar/video_analyze.py` | `analyze_video` |
| Visual windows | `sidecar/scene_understand.py` | `analysis_windows`, `extract_window_frames`, `analyze_visual_scenes` |
| Script HTTP | `sidecar/api/script.py` | `generate_script_route`, `shorten_script_route` |
| Script core | `sidecar/script_llm.py` | `generate_voiceover_script`, `_with_frame_captions`, `_speech_beats`, `_build_director_prompt`, `_try_ollama`, `_align_segments_to_beats`, `shorten_spoken` |
| Mix | `sidecar/api/audio.py` | `mix_voiceover_track` |

## What this Film actually had

- Video: assembled `…/Projects/8cd095b2-…/1790368429273-eefae847.mp4` (62.222s)
- V1: two screencasts 0–28.23s and 28.23–62.20s
- Analyze: `VISION_MODEL_MISSING`, 4 ffmpeg scenes → 7 keyframe windows, **empty `visual_summary`**, no transcript
- Script generate: OCR later fills captions; last saved script is 5 slogan lines from older `_template_voice`
- Shorten: skipped (every `speech_sec` < window × 1.12)
- Final A1: `~/Documents/Canvas/Generated/Audio/voiceover-8cd095b2-…-1790493603.wav`

Raw Ollama JSON is **not persisted**. `05-raw-script.json` is a live re-run of the reconstructed prompt.

## Files in this folder

| File | Stage |
|---|---|
| `01-video.json` | VIDEO |
| `02-analysis-saved.json` | analyze_video output stored on the Film |
| `02b-ocr-labels.json` | OCR texts from keyframes |
| `03-visual-beats.json` | VISUAL BEATS after `_with_frame_captions` + `_speech_beats` |
| `04-llm-input.txt` | LLM INPUT |
| `05-raw-script.json` | RAW SCRIPT (live Ollama) |
| `05b-raw-after-finalize-align.json` | finalize + align of that raw |
| `06-current-generate-output.json` | `generate_voiceover_script` now |
| `07-persisted-script.json` | script the Film actually used for TTS |
| `08-shorten-decisions.json` | SHORTENED SCRIPT (none) |
| `09-final-narration.json` | FINAL NARRATION + wav paths |
