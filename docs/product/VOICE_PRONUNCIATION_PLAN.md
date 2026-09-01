# Voice Pronunciation & TTS Quality — Living Plan

> **Status:** Active development track  
> **Branch:** `feat/voice-pronunciation`  
> **Updated:** 1 September 2026  
> **Owners:** Product + sidecar (`audio.py`, `tts_clone.py`) + Assets / Video UI  
> **Related:** [VIDEO_STUDIO_PLAN.md](VIDEO_STUDIO_PLAN.md), [VIDEO_VOICEOVER_PLAN.md](VIDEO_VOICEOVER_PLAN.md)

---

## Problem

Coqui XTTS v2 clones the user's voice from a 10 s sample and auto-detects Russian (`lang=ru`). That works for demos, but production Russian voiceover fails on:

| Failure mode | Example | Root cause |
|--------------|---------|------------|
| Wrong stress (homographs) | «замок» (door vs castle) | No G2P / stress layer |
| Numbers and units | «2024», «16 ГБ», «M4 Max» | No text normalization |
| Abbreviations / brands | API, GitHub, npm | No pronunciation lexicon |
| Foreign words in RU speech | «framework», «deploy» | XTTS guesses |
| Pace / intonation drift | Long sentences, lists | No segment control |

There is **zero** stress/G2P code in the repo today (`stress`, `ударен`, `phoneme`, `g2p`, `silero` — no matches).

---

## Goal (this track)

Ship **UI + backend** so creators get noticeably better Russian TTS without leaving the app, with a **human-in-the-loop** path when automation is uncertain.

**Not in scope here:** video understanding, LLM script generation — see [VIDEO_VOICEOVER_PLAN.md](VIDEO_VOICEOVER_PLAN.md).

---

## Strategy: three layers

```
User text
    ↓
[1] Normalize     — numbers, dates, symbols → spoken Russian
    ↓
[2] Auto stress   — RUAccent (+ optional lexicon overrides)
    ↓
[3] XTTS clone    — existing Coqui path
    ↓
[4] Review UI     — listen → fix word(s) via prompt or inline edit → re-render segment
```

Layers 1–2 are automation. Layer 4 is the fallback the user asked for — **yes, it makes sense**.

---

## Manual correction via prompt — recommended design

**Verdict: yes, worth building.** Fully automatic stress for Russian is ~85–92% on clean prose; homographs and brand names need a human loop. A prompt-based fix is cheaper than a phoneme editor and matches how creators already work in Video timeline.

### UX pattern (Assets + Video)

After TTS preview on a segment:

```
┌─────────────────────────────────────────────────────────┐
│ Segment 2 · 0:12–0:28                                   │
│ Text: «Откройте настройки в замке безопасности»         │
│ [ ▶ Play ]  [ Regenerate ]                              │
│                                                         │
│ Fix pronunciation:                                      │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ слово «замок» — ударение на «а», не на «о»          │ │
│ └─────────────────────────────────────────────────────┘ │
│ [ Apply fix to this segment ]                           │
└─────────────────────────────────────────────────────────┘
```

### Backend behavior

1. **Lexicon override** (deterministic, preferred): prompt maps `замок → з+амок` (RUAccent `+` mark) or stored `{ "замок": "з+амок" }` in `~/Documents/Canvas/Voice/lexicon.json`.
2. **LLM assist** (optional): small local/cloud model rewrites only the marked word with stress notation; user confirms before TTS.
3. **Re-run TTS** for that segment only; timeline position unchanged.

### Why prompt + lexicon, not full SSML

| Approach | Pros | Cons |
|----------|------|------|
| Prompt → lexicon entry | Persistent; fast re-use; no model cost | User must describe fix once per word |
| Inline `+` stress marks | Exact control | Power-user only |
| Full G2P / SSML | Maximum control | Heavy integration with XTTS |
| Re-prompt entire script | Simple | Breaks timing; loses other good segments |

**Rule:** one bad word → fix that word in lexicon; bad sentence → edit segment text inline.

---

## Improving overall voiceover *generation* quality (not just stress)

Beyond pronunciation, XTTS output quality depends on:

| Lever | What to do | Priority |
|-------|------------|----------|
| **Speaker sample** | 10–30 s clean speech, no music, single speaker, same language as target | P0 — UI guidance in Assets |
| **Text chunking** | Split long paragraphs into ≤2 sentence segments; one WAV per segment | P0 |
| **Normalization** | `num2words`, currency, `%`, file paths, version strings | P0 |
| **Stress (RUAccent)** | Pre-TTS pipeline in sidecar | P0 |
| **Lexicon** | User + project overrides for brands/product names | P1 |
| **Speed / stability** | XTTS `temperature` / `speed` if exposed by worker | P1 |
| **Post loudness** | ffmpeg `loudnorm` on segment WAVs before timeline mix | P2 |
| **Alternative engine** | Silero for Russian-only (no clone) as A/B in Studio | P3 research |
| **Long-form consistency** | Same speaker wav + same chunking rules across project | P1 |

**Do not promise** broadcast-grade narration from a noisy 10 s phone sample. Assets UI should score sample quality (duration, SNR hint) before TTS.

---

## UI surfaces to implement

| Surface | Feature | ID |
|---------|---------|-----|
| **Assets → Voice** | Sample quality hints; test phrase with stress preview | V-PRON-1 |
| **Assets → Voice** | «Проверка произношения» — enter text → see normalized+stressed text → TTS | V-PRON-2 |
| **Assets → Voice** | Lexicon manager (word → stressed form); import/export JSON | V-PRON-3 |
| **Video → Director** | Per-segment TTS with pronunciation fix prompt | V-PRON-4 |
| **Video → Timeline** | Show «processed text» diff before send to XTTS | V-PRON-5 |
| **Settings** | Toggle auto-stress on/off; default language | V-PRON-6 |

All of the above are **required for this track** — not optional polish. Without UI, the sidecar pipeline is invisible to users.

---

## Sidecar / API plan

| Endpoint / module | Purpose |
|-------------------|---------|
| `sidecar/text_ru.py` | `normalize_ru(text)`, `add_stress(text, lexicon)` |
| `POST /api/audio/prepare-text` | Returns `{ original, normalized, stressed, warnings[] }` |
| `POST /api/audio/tts` | Extend: optional `prepared_text`, `skip_prepare` |
| `GET/PUT /api/audio/lexicon` | CRUD for pronunciation overrides |
| `requirements-tts.txt` | Add `ruaccent`, `num2words` (or equivalent) |

### RUAccent integration notes

- Model: `RUAccent` package — predicts stress, can output `+` before stressed vowel.
- Run in TTS venv (Python 3.11) alongside Coqui.
- Merge order: **lexicon overrides win** over model prediction for exact word matches.
- Log `warnings` when model is uncertain (if API exposes confidence).

---

## Phased delivery

| Phase | Deliverable | Branch |
|-------|-------------|--------|
| **A** | `text_ru` + `prepare-text` + Assets test UI | `feat/voice-pronunciation` |
| **B** | Lexicon file + manager UI + prompt-to-lexicon fix | same |
| **C** | Video Director segment editor + fix prompt | same |
| **D** | Chunking + loudnorm on export path | same or follow-up |

**Start:** Phase A (automation baseline). Phase B (manual prompt fix) immediately after — user explicitly wants this fallback.

---

## Success metrics

| Metric | Target |
|--------|--------|
| User-reported «wrong stress» per 100 words | < 5 after lexicon pass |
| Time to fix one word after listen | < 30 s |
| Prepare-text latency | < 2 s for 500 words |
| TTS unchanged when `skip_prepare=true` | Regression test |

---

## Code map (existing)

| Path | Role |
|------|------|
| `sidecar/api/audio.py` | TTS, timeline mix |
| `sidecar/tts_clone.py` | XTTS worker |
| `src/renderer/src/features/assets/ui/AssetsPage.tsx` | Voice sample + TTS |
| `src/renderer/src/features/video/ui/DirectorBoard.tsx` | Inline TTS on timeline |

---

## Revision log

| Date | Note |
|------|------|
| 2026-09-01 | Initial plan: RUAccent pipeline, lexicon, prompt-based fix UI, quality levers |
