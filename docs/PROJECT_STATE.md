# Project State & Handoff
> **Purpose:** This document is the single source of truth for the current development state, recent changes, and immediate next steps. It is designed to be read by AI agents to quickly gain context without traversing Git logs.

## Current Focus
**Branch:** `feat/voice-pronunciation`
- Pronunciation / TTS quality — [VOICE_PRONUNCIATION_PLAN.md](product/VOICE_PRONUNCIATION_PLAN.md) (**active**)
- Video content voiceover (analyze → script → TTS) — [VIDEO_VOICEOVER_PLAN.md](product/VIDEO_VOICEOVER_PLAN.md) (**next branch:** `feat/video-voiceover`)
- Video + local TTS baseline — [VIDEO_STUDIO_PLAN.md](product/VIDEO_STUDIO_PLAN.md)

**Goal:** Ship Russian pronunciation automation + human fix UI in Assets and Video; then start video-analyze + script track on a separate branch.

## Active work (feat/voice-pronunciation)

### Phase A — automation baseline
- [x] `sidecar/text_ru.py` — normalize + RUAccent stress
- [x] `POST /api/audio/prepare-text`
- [x] Extend `POST /api/audio/tts` with prepared text path
- [x] Assets UI: test phrase → show processed text → TTS preview

### Phase B — human-in-the-loop
- [ ] Lexicon file `~/Documents/Canvas/Voice/lexicon.json` + API
- [ ] Prompt-based «fix pronunciation» → lexicon entry
- [ ] Video Director: per-segment fix after listen

## Next branch (feat/video-voiceover)

See [VIDEO_VOICEOVER_PLAN.md](product/VIDEO_VOICEOVER_PLAN.md) — Phase 1: Whisper + scene detect + `FromVideoPanel` UI.

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
