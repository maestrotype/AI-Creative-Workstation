# Project State & Handoff
> **Purpose:** This document is the single source of truth for the current development state, recent changes, and immediate next steps. It is designed to be read by AI agents to quickly gain context without traversing Git logs.

## Current Focus
**Branch (implementation):** `feat/video-voiceover` — V1 MVP shipped  
**Branch (planning):** `docs/voiceover-v2-vision` — V2 UX + intelligence spec

- Video content voiceover V1 — [VIDEO_VOICEOVER_PLAN.md](product/VIDEO_VOICEOVER_PLAN.md) (Phases 1–3 MVP)
- Video content voiceover V2 — [VIDEO_VOICEOVER_V2_VISION.md](product/VIDEO_VOICEOVER_V2_VISION.md) (**next**)
- Layout modes spec — [VIDEO_STUDIO_LAYOUT_MODES.md](ux/VIDEO_STUDIO_LAYOUT_MODES.md)
- Pronunciation / TTS quality — [VOICE_PRONUNCIATION_PLAN.md](product/VOICE_PRONUNCIATION_PLAN.md)
- Video + local TTS baseline — [VIDEO_STUDIO_PLAN.md](product/VIDEO_STUDIO_PLAN.md)

**Goal (V2):** Pipeline-first UX, video-aware script (VLM), continuous A1 voiceover, project context prompts.

## V1 voiceover status (`feat/video-voiceover`)

### Phase 1 — Analyze ✅
- [x] `scene_detect.py` + `transcribe.py` + `video_analyze.py`
- [x] `POST /api/video/analyze` + progress + cache + `from_cache` flag
- [x] `VoiceoverSection` in Sources (uses V1/bin video via `voiceoverSession.ts`)
- [x] Analyze cache UX: show ready state, separate re-analyze
- [ ] Whisper install path in Studio (optional)

### Phase 2 — Script ✅ (quality weak)
- [x] `POST /api/script/generate` (Ollama + scene fallback)
- [x] `VoiceoverScriptEditor` — prompt + editable segment table
- [x] Scene alignment: one segment per scene (`_align_segments_to_scenes`)
- [x] Studio → **Сценарий**: install/start/delete `qwen2.5:7b` via Ollama
- [ ] Cloud LLM provider in Settings (optional)
- [ ] **V2:** visual_notes + project context in script prompt

### Phase 3 — Voice ✅ (raw MVP)
- [x] Per-segment XTTS → A1 via `applyScriptVoiceover()` in `DirectorBoard.tsx`
- [x] Inline voice sample: `VoiceSampleSetup.tsx` (record / file / library)
- [x] 3-step stepper: `VoiceoverSteps.tsx`
- [x] Hide bottom voice strip when voiceover expanded
- [ ] **V2:** single continuous A1 clip (concat + pad)
- [ ] **V2:** pronunciation fix per segment in script table

### UX (V1 limitations — see V2 vision)
- Grid/Free dock only — panels scattered (timeline bottom, preview top-right)
- Script often generic placeholders without video content description
- A1 has multiple short clips with gaps between segments

## Recently Completed
- [x] Voiceover MVP commit `dae5d8a`: analyze → script → inline voice → A1 → export path
- [x] Ollama engine management in main process + Studio tab
- [x] Initial React + Vite architecture setup with CSS modules.
- [x] Application routing layout (`Shell`, `SideNavigation`).
- [x] `HomePage` baseline (Hero section, `IntentInput` for Quick Create).
- [x] `RecentAssets` component and `homeStore` Zustand integration.
- [x] Basic mock API (`assetApi.ts`) for assets.
- [x] **Data Separation:** Split the mock API and Zustand store state into `Projects` and `Assets`.
- [x] **Continue Working Component:** Build the UI to display recent projects.
- [x] **Inspiration Component:** Build a gallery of curated generation examples.
- [x] **Integrate into HomePage:** Update `HomePage.tsx` to render all sections in the correct order.
- [x] **CreatePage Implementation:** Built the core generation flow with Zustand state machine.
- [x] **Мультиязычность (i18n):** `i18next`, EN/RU, Settings language switcher.
- [x] **Базовые заглушки экранов:** `ProjectsPage`, `AssetsPage`, `StudioPage`, `SettingsPage`.
- [x] **Electron Shell:** Electron + Vite via `electron-vite`.
- [x] **Python Sidecar:** FastAPI, MLX, mock generation endpoint.
- [x] **Video Studio:** Director timeline, screencast clean, XTTS timeline mix, Ken Burns assemble.
- [x] **Docs 2026-09-01:** VOICE_PRONUNCIATION_PLAN + VIDEO_VOICEOVER_PLAN; roadmap and UX flows updated.
- [x] **Docs 2026-09-02:** VIDEO_VOICEOVER_V2_VISION + VIDEO_STUDIO_LAYOUT_MODES

## Immediate Next Steps (V2 — start on `docs/voiceover-v2-vision` or new feat branch)

| Priority | Task | Doc |
|----------|------|-----|
| P0 | Pipeline layout mode (`pipeline` / Grid / Free) | [VIDEO_STUDIO_LAYOUT_MODES.md](ux/VIDEO_STUDIO_LAYOUT_MODES.md) |
| P0 | Single A1 voiceover track (concat segments) | [VIDEO_VOICEOVER_V2_VISION.md](product/VIDEO_VOICEOVER_V2_VISION.md) §G3 |
| P1 | Keyframe + VLM captions → `visual_notes` | §G2 |
| P1 | Project context brief (persist per project) | §G4 |
| P2 | Script row click → preview seek | §Stage 4 |
| P2 | Pronunciation fix in script table | [VOICE_PRONUNCIATION_PLAN.md](product/VOICE_PRONUNCIATION_PLAN.md) |

## Known Issues / Technical Debt
- Voiceover UI scattered in Grid mode — use Pipeline mode in V2.
- Script quality: Ollama returns placeholders without visual context.
- A1 fragmented clips — not continuous narration.
- `IntentInput` attach button not fully functional.
- Preview may show black frame when playhead at end of timeline.
- Typecheck: pre-existing errors in `MeshProgress.tsx` (unrelated).
