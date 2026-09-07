# Film architecture

**Status of this document:** Phase 1 **shipped on `feat/film-phase-1`** (routes stay `/projects` and `/video`; nav labels are Films / Dub).  
What already runs: see [IMPLEMENTED_VS_PLANNED.md](IMPLEMENTED_VS_PLANNED.md).

## Why Film exists

The app split **Projects** (make pictures/clips) from **Video** (narrate a file). That is one commercial video.

**Film** is that production. **3D stays out.**

Priorities: quality → zero cost → product identity → ease of use → speed.

M4 Max 64 GB: local-first, one heavy model at a time. No required paid API.

## User mental model

```
Create Film  |  Continue Film  |  Dub existing video
        ↓
Marketplace Product Video (preset)
        ↓
Material (product photos, screenshots, clips)
        ↓
Storyboard (AI proposes, user approves)
        ↓
Shots (reference · motion · duration · result)
        ↓
Picture (stitch — generated seconds are optional)
        ↓
Analysis (cached, of the actual picture)
        ↓
Script (tied to scene times, editable, regen one row)
        ↓
Voice (local TTS, regen one segment)
        ↓
Review · Export MP4
```

**Dub existing video** is the same Film with picture already imported. Same analysis/script/TTS/export.

## Domain (target)

```
Film
  preset          marketplace | hero | youtube | shorts
  brief
  references[]    hero | detail | ui | extra   (paths on disk)
  storyboard      proposed + approved shots
  shots[]
    reference
    motion          still_motion | import | i2v (optional)
    durationSec
    stillPath / clipPath
    status
  assembledPath
  analysis        on disk, keyed by source video
  script
  voice
  timeline
  export
```

Phase 1 starts from existing `project.json` scenes and **does not** require a full rewrite. Fields are added; old files still load.

## Picture generation (quality, not max AI)

A marketplace film does **not** need generative video on every second.

| Method | Identity | Cost | Role |
|--------|----------|------|------|
| Import clip / screenshot / recording | Exact | Free | Prefer when you have it |
| Still + Ken Burns (`still_motion`) | Exact | Free | **Default on M4** |
| Image-to-video | Risk of morph | Local heavy or paid | Optional Advanced |

H3 and Runway are **optional providers** behind `IMAGE_TO_VIDEO`, not the product.

Wan/SVD are not recommended for ads (noise / living-photo).

## Capabilities (not model names in primary UX)

```
IMAGE
STILL_MOTION
IMAGE_TO_VIDEO     (optional)
VIDEO_ANALYSIS
SCRIPT
TTS
```

Studio primary UI: capability → Recommended / Local / Optional remote / Advanced.  
AUTO picks the best **available** path. Missing H3 on Mac is not a failure of the Film.

## Resource / jobs

**Now:** sidecar `pipeline_cache` + one generation lock + runtime chip.

**Planned (Phase 4):** disk job queue; unload after each heavy capability (LLM → image → I2V → TTS).

Phase 1: still-motion default so Mac users are not sent to H3.

## Persistence

**Now:** `project.json` + localStorage director session.

**Planned (Phase 2):** film JSON + analysis JSON on disk; generated media stay files.

## Navigation (Phase 1)

One obvious path: **Films** (current Projects list + workspace).  
The Video screen becomes the **later stages** of the same Film (or `/films/:id` stages), not a second product.

Keep a distinct entry: **Dub existing video**.

Do not merge 3D into this graph.

## Phases

1. **Shipped:** UX + shot UI + preset + still-motion default + Studio capability grouping  
2. Disk persistence for analysis/session  
3. Analysis-grounded script + per-segment regen  
4. Jobs + unload  
5. Docs/tests vs code  
