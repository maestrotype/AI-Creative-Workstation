# Video Studio — Layout Modes

> **Status:** Spec for V2  
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

## Anti-patterns (current V1 — do not repeat)

- Script editor in Sources scroll area while preview is in Result tile far away.
- Timeline always visible consuming vertical space during brief/script steps.
- Four separate A1 clips labeled «Озвучка 1…4» without user understanding gaps.
- Forcing navigation to Assets/Studio mid-pipeline (fixed in V1 for voice sample; keep all steps in pipeline).
