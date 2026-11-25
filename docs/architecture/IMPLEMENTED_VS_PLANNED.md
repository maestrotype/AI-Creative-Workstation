# Implemented vs planned

Legend: **IMPLEMENTED** · **PARTIAL** · **UNIMPLEMENTED**

Older files (`SYSTEM_ARCHITECTURE.md`, `ROADMAP.md`, `PRODUCT_VISION.md`) describe Canvas OS, MLX, fal.ai, JobQueue, Character/Product Graph. **Those are vision, not the running app.** This table is the code as of the Film Phase 1 kickoff.

## Shell and data

| Item | Status | Notes |
|------|--------|--------|
| Electron + Vite + React 19 | IMPLEMENTED | |
| Python sidecar FastAPI `:57291` | IMPLEMENTED | |
| SQLite `models`, `settings` | IMPLEMENTED | |
| SQLite `projects`, `assets` | UNIMPLEMENTED | Schema only; unused |
| Filesystem projects | IMPLEMENTED | `~/Documents/Canvas/Projects/` |
| Director session | PARTIAL | `localStorage`, not film JSON |
| Persistent job queue | UNIMPLEMENTED | In-process `_runtime_job` + asyncio lock only |
| MLX provider | PARTIAL | Wan 2.2 TI2V-5B q8 in a Python 3.11 subprocess only. Image gen stays PyTorch/MPS |
| fal.ai / Replicate | PARTIAL | fal.ai queue API integration for Seedance 2.5 (`sidecar/api/seedance_cloud.py`) |
| Creative Asset Graph | UNIMPLEMENTED | |

## AI capabilities

| Capability | Status | What actually runs |
|------------|--------|--------------------|
| IMAGE_GENERATION | IMPLEMENTED | Diffusers + Torch MPS: SDXL, FLUX. CLIP is English-only: `sidecar/prompt_en.py` translates RU (glossary, then Ollama qwen2.5:7b) **before** FLUX loads, then unloads the LLM |
| IMAGE_TO_VIDEO (ads) | IMPLEMENTED | Hybrid Video Hub: ModelPicker UI with search & speed/price/quality sorting; Local: Wan 2.2 TI2V-5B MLX q8 (832×480, 41-121 frames); Cloud: Kling 4.0, Seedance 2.5 (fal.ai), Runway Gen-4.5, MiniMax H3. SVD for still animation |
| TEXT_TO_VIDEO | PARTIAL | Wan code exists; disabled for product ads (noise/crash on Mac) |
| STILL_MOTION | IMPLEMENTED | ffmpeg Ken Burns on stills at stitch |
| VIDEO_ANALYZE | IMPLEMENTED | scene_detect + optional Whisper + optional Ollama VLM |
| SCRIPT | IMPLEMENTED | Ollama qwen2.5:7b or heuristic fallback |
| TTS | IMPLEMENTED | Coqui XTTS v2 |
| STT | PARTIAL | optional faster-whisper |
| 3D mesh | IMPLEMENTED | TripoSR, Hunyuan3D 2 mini — **not** part of video |
| Upscale / interpolation | UNIMPLEMENTED | |
| Music / SFX gen | UNIMPLEMENTED | |

## UI modules

| Nav | Status | Role today |
|-----|--------|------------|
| Home / Create | IMPLEMENTED | Stills (FLUX) + Video Generation Hub (ModelPicker modal, duration stepper, 16:9/1:1/9:16 aspect ratios, references); RU→EN for CLIP; delete/start over |
| 3D | IMPLEMENTED | Independent experiment |
| Video | IMPLEMENTED | Voiceover + timeline; separate from Projects |
| Projects | IMPLEMENTED | Scenes + generate/import + stitch |
| Assets | IMPLEMENTED | Library + voice sample |
| Studio | PARTIAL | Catalog by model names, not capabilities; updated with cloud video engines (Kling, Seedance, Luma) |
| Settings | IMPLEMENTED | i18n, HF token, H3 URL, Runway key, Kling key, Seedance/fal.ai key, Luma key |
