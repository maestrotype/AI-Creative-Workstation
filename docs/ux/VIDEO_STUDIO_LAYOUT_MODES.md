# Video Studio — Layout Modes

> **Status:** Pipeline mode IMPLEMENTED (first slice) — see “Implementation status” below  
> **Related:** [VIDEO_VOICEOVER_V2_VISION.md](../product/VIDEO_VOICEOVER_V2_VISION.md)

---

## Three modes

Today Video Studio has **Grid (`tile`)** and **Free (`free`)** — see `videoDockLayout.ts`, `VideoDock.tsx`.

V2 adds **Pipeline (`pipeline`)** as the default entry for voiceover workflows.

| Mode | `DockMode` value | User label RU | User label EN |
|------|------------------|---------------|---------------|
| Pipeline | `pipeline` | Пайплайн | Pipeline |
| Grid | `tile` | Сетка | Grid |
| Free | `free` | Свободно | Free |

Storage key bump: `video-dock-layout-v8` (keep migration from v7).

---

## Pipeline mode — principles

1. **One center stage** — primary content occupies ~70% viewport width, centered.
2. **Progressive disclosure** — only current step’s controls are expanded; past steps = compact summary; future steps = hidden or disabled in stepper.
3. **No orphan panels** — preview never floats alone while script is in Sources far away.
4. **Escape hatch** — user can switch to Grid/Free without losing session state.

---

## Pipeline stepper (always visible in pipeline mode)

```
[1 Material ✓] — [2 Analyze ✓] — [3 Brief ●] — [4 Script] — [5 Voice] — [6 Review] — [7 Export]
```

- **●** = current step  
- **✓** = completed (click to expand summary, not full re-flow)  
- Empty = not reached

Clicking a completed step opens **read-only summary** + “Edit” to jump back.

---

## Stage layouts (center)

### Stage 1 — Material

```
┌─────────────────────────────────────────┐
│  Video on timeline or drop file here     │
│  [ + Video ]  [ Open voiceover ]         │
└─────────────────────────────────────────┘
```

Auto-advance when V1 has a video clip.

### Stage 2 — Analyze

```
┌──────────────────┬──────────────────────┐
│  Preview (small) │  Scenes list         │
│                  │  [Analyze / Re-run]  │
│                  │  Transcript (details)  │
└──────────────────┴──────────────────────┘
```

Auto-advance when analysis cached or complete.

### Stage 3 — Brief

```
┌─────────────────────────────────────────┐
│  Prompt for this video                   │
│  ┌─────────────────────────────────────┐ │
│  │ Расскажи клиенту о 3D-магазине…     │ │
│  └─────────────────────────────────────┘ │
│  Project context (optional, collapsible) │
│  [ Continue to script ]                    │
└─────────────────────────────────────────┘
```

### Stage 4 — Script (critical UX fix)

```
┌──────────────────┬──────────────────────┐
│  Segment table   │  Preview + playhead    │
│  (editable)      │  (seeks on row click)  │
│                  │                        │
│  [ Regenerate ]  │  Current segment text  │
└──────────────────┴──────────────────────┘
```

### Stage 5 — Voice

```
┌─────────────────────────────────────────┐
│  Voice sample (inline, existing)         │
│  [ Generate full voiceover ]             │
│  Progress: segment 2/4…                  │
└─────────────────────────────────────────┘
```

### Stage 6 — Review

```
┌─────────────────────────────────────────┐
│  Large preview + timeline strip (A1+V1)  │
│  [ Play ] [ Scrub ]                       │
└─────────────────────────────────────────┘
```

Full timeline panel slides up from bottom (optional expand).

### Stage 7 — Export

```
┌─────────────────────────────────────────┐
│  Preview                                  │
│  [ Собрать MP4 ] [ Save as… ]             │
└─────────────────────────────────────────┘
```

---

## Mode switching

| From | To | Behavior |
|------|-----|----------|
| Pipeline | Grid | Map pipeline state to dock panels: Sources=script, Timeline=on, Result=preview |
| Pipeline | Free | Same as grid but restore free positions from last free session |
| Grid/Free | Pipeline | Infer current step from `voiceover.status` + timeline state; focus stage |

Entry points that force pipeline:

- Menu **«Озвучка →»**
- Bin inspector **«Подготовить озвучку»**
- First visit to Video with `?mode=voiceover` query (optional)

---

## Implementation notes

- New component: `VideoPipelineShell.tsx` — replaces `VideoStudioShell` when `dock.mode === 'pipeline'`.
- Reuse existing panes as **stage content**, not dock tiles.
- `DirectorProvider` unchanged; pipeline is pure layout.
- i18n: `video.layout_pipeline`, `video.pipeline_step_*`.

---

## Implementation status (shipped)

The first slice of pipeline mode is implemented. Decisions that differ from the
original 7-stage spec (rationale noted):

### 6 stages instead of 7

**Review + Export merged into one “Финал” stage.** Export UI already lives on the
Result pane (preview + transport + «Собрать MP4» + save/discard), so a separate
Review stage would duplicate the same preview with fewer buttons. The final stage
renders `DirectorResultPane` full-width plus a collapsible timeline strip
(`<details>` with `DirectorTimelinePane`, 300 px).

```
[1 Материал] – [2 Анализ] – [3 Бриф] – [4 Сценарий] – [5 Голос] – [6 Финал]
```

### Stage unlock & auto-advance rules (as coded)

| Stage | Unlocked when | Auto-advance to next when |
|-------|---------------|---------------------------|
| Материал | always | video source appears (drop/pick) |
| Анализ | `voiceoverSource` exists | analyze finishes without error |
| Бриф | `analysis` exists | script generation finishes without error |
| Сценарий | `script.segments.length > 0` | manual («Продолжить») |
| Голос | script exists | apply finishes, `status === 'voiced'` |
| Финал | `status === 'voiced'` | — |

- Stepper chips are **clickable for any unlocked stage** (done = ✓ + accent ring,
  current = filled accent, upcoming = dimmed, locked = disabled).
- Entry stage on mount is derived from session state (`deriveStage`), so
  re-opening the app lands on the furthest meaningful step.
- «← Назад» / «Продолжить →» footer on every stage; Continue disabled until the
  next stage unlocks.

### Stage 4 «Сценарий» — the critical UX fix

50/50 split: editable segment table (left) + `DirectorPreview` with mini
transport (right). Clicking a segment’s timecode calls `seekTo(start_sec)`; the
row under the playhead is highlighted (`data-live`). No more script-in-Sources /
preview-in-Result separation.

### Files (actual)

| Change | File |
|--------|------|
| `DockMode` + `'pipeline'`, storage `video-dock-layout-v8` (migrates v7→v4) | `src/renderer/src/features/video/model/videoDockLayout.ts` |
| «Пайплайн» mode button, panel chips hidden in pipeline, mode-aware header hint | `src/renderer/src/features/video/ui/VideoDock.tsx` |
| Shell branch + entry points force pipeline | `src/renderer/src/features/video/ui/VideoPage.tsx` |
| Pipeline shell (stepper + 6 stage components) | `src/renderer/src/features/video/ui/VideoPipelineShell.tsx` (+ `.module.css`) |
| «Подготовить озвучку» in Sources/inspector routes through pipeline switch | `src/renderer/src/features/video/ui/DirectorPanes.tsx` (`onOpenVoiceover` prop) |
| Strings `video.menu_layout_pipeline*`, `video.pipe_*`, `video.menu_lead_pipeline` | `core/i18n/locales/ru.json`, `en.json` |

Notes:

- Dock persistence moved from `VideoDock` into `useDockLayout` — the dock is
  unmounted in pipeline mode, so saving had to live with the state owner.
- Grid/Free behavior untouched; switching modes never clears `voiceover` session
  (layout state and director state are separate stores).
- Old voiceover-in-Sources UI (`VoiceoverSection`) still works in Grid/Free as
  the escape hatch.

### Not yet done (next slices)

- ~~Single continuous A1 voiceover clip (G3)~~ — ✅ shipped same day; the Voice
  stage now produces one «Озвучка» clip on A1 (see vision doc, G3).
- ~~«Контекст проекта» field on the Brief stage (G4)~~ — ✅ shipped same day
  (collapsible details with ✓ badge, persisted in director session).
- ~~VLM visual notes (G2)~~ — ✅ shipped same day; Analyze stage shows
  «Что на экране (по сценам)» + hints when the vision model is missing or the
  cached analysis predates captions (press «Переанализировать»).
- ~~Per-segment pronunciation fix on the Script stage (G5)~~ — ✅ shipped same day;
  each segment row has a «Произношение» toggle → inline panel with spoken preview
  (`prepare-text`) and a lexicon fix input. Saving a fix re-enables «Озвучить на A1».
- ~~WPM / tempo tuning (G5)~~ — ✅ shipped same day; script table shows speech vs scene
  window; after A1 apply, measured duration + «ускорено N%» when atempo was applied.
  `prepare-text` / lexicon fix run in a sidecar thread pool so they no longer block
  `GET /api/audio/voice` (fixes `get-voice-profile` TimeoutError).

---

## Anti-patterns (current V1 — do not repeat)

- Script editor in Sources scroll area while preview is in Result tile far away.
- Timeline always visible consuming vertical space during brief/script steps.
- Four separate A1 clips labeled «Озвучка 1…4» without user understanding gaps.
- Forcing navigation to Assets/Studio mid-pipeline (fixed in V1 for voice sample; keep all steps in pipeline).
