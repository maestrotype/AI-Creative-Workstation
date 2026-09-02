# Project State & Handoff
> **Purpose:** This document is the single source of truth for the current development state, recent changes, and immediate next steps. It is designed to be read by AI agents to quickly gain context without traversing Git logs.

## Current Focus
**Branch:** `feat/video-voiceover`
- Video content voiceover — [VIDEO_VOICEOVER_PLAN.md](product/VIDEO_VOICEOVER_PLAN.md) (**active**, Phase 1 analyze)
- Pronunciation / TTS quality — merged from `feat/voice-pronunciation`
- Video + local TTS baseline — [VIDEO_STUDIO_PLAN.md](product/VIDEO_STUDIO_PLAN.md)

**Goal:** Phase 1 — video analyze (Whisper + scenes) + From video UI; then script LLM + TTS timeline.

## Active work (feat/video-voiceover)

### Phase 1 — Analyze
- [x] `scene_detect.py` + `transcribe.py` + `video_analyze.py`
- [x] `POST /api/video/analyze` + progress + cache
- [x] `FromVideoPanel` + dock panel «Озвучка видео»
- [ ] Whisper install path in Studio (optional)

### Phase 2 — Script (next)
- [ ] `POST /api/script/generate` + editor UI

## Recently Completed
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

## Immediate Next Steps (Pending)
- [x] **База Данных:** `better-sqlite3` + `drizzle-orm` in Main process.
- [x] **Studio Page:** Model download/manager UI.
- [x] Connect `Inspiration` click handler to `CreatePage`.
- [x] Real Python generation on MPS via sidecar.
- [x] `asset://` protocol for local images.

## What's Next?
- [ ] RUAccent + `prepare-text` in sidecar TTS venv
- [ ] Assets pronunciation test UI
- [ ] Lexicon + prompt fix flow

## Known Issues / Technical Debt
- `IntentInput` attach button not fully functional.
- `VideoTimelineCard` built but may need re-wiring for From video flow.
- No stress/G2P in TTS path today.
- No Whisper / video analyze in sidecar.
