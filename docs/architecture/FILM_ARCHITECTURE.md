# Film architecture

**Status:** Phase 1 UX shipped on `feat/film-phase-1`, then **corrected**: the product is a **template demo**, not a photo of a SKU.

What already runs: [IMPLEMENTED_VS_PLANNED.md](IMPLEMENTED_VS_PLANNED.md).

## What we are actually making

The commercial job is a **video of the ecommerce template itself** (example: Angular 3D Store): what the site is, design, catalog, product page, checkout, **admin**, **page builder**, **payments and settings**.

**You record the real UI.** The workstation does not invent a fake storefront.

The app helps with everything around that recording:

| You do | App helps |
|--------|-----------|
| Screencast the template | Import, chapter, stitch |
| | Trim / cut / clean screencast (Video desk) |
| | Titles, captions, look (grain, zoom) |
| | Optional generated **inserts** (title cards) — not fake admin |
| | Analyze → script → local TTS |
| | Export MP4 |

Priorities: quality of the **real UI on screen** → zero cost → identity of **this template** → ease → speed.

**3D mesh tools stay out of this graph.** Showing the template’s 3D storefront in a screencast is fine; generating GLB into the timeline is not the job.

M4 Max 64 GB: local-first, one heavy model at a time. No required paid API.

## User mental model

```
Create Film (template chapters)  |  Continue  |  One long recording + voice
        ↓
Brief: what this template is
        ↓
Chapters (intro · design · catalog · product · checkout · admin · builder · payments)
        ↓
Your recordings / screenshots in each chapter
        ↓
Optional titles, Ken Burns on a screenshot, generated insert
        ↓
Stitch
        ↓
Analysis of the actual picture
        ↓
Script (tied to times, editable)
        ↓
Voice (local TTS)
        ↓
Review · Export
```

**One long recording + voice** is the same Film with picture already imported (no chapter split yet). Same analysis / script / TTS / export.

## Domain (target)

```
Film
  preset          marketplace (= template demo) | hero | youtube | shorts
  brief           what the template is
  shots[]         chapter
    prompt        what to show / say
    motion        import (default) | still_motion | i2v (optional insert)
    stillPath / clipPath
  assembledPath
  analysis / script / voice / timeline / export
```

Old `project.json` still loads. `marketplace` preset **means template walkthrough**, not product photography.

## Picture (quality = real UI)

A template demo **must** show the real theme.

| Method | Identity | Role |
|--------|----------|------|
| Import recording | Exact UI | **Default** |
| Screenshot + Ken Burns | Exact UI | When a still is enough |
| Clean screencast | Exact UI | Strip chrome / dead tails |
| Generated title card | Graphic, not UI | Optional punch |
| Image-to-video (H3/Runway) | Risk of fake UI | Optional Advanced only |

H3 and Runway are not the product. Wan/SVD stay Advanced.

## Capabilities

```
IMPORT_RECORDING
TRIM_STITCH
STILL_MOTION          (screenshots)
IMAGE                 (optional titles)
IMAGE_TO_VIDEO        (optional)
VIDEO_ANALYSIS
SCRIPT
TTS
```

## Resource / jobs

**Now:** sidecar `pipeline_cache` + one generation lock + runtime chip.

**Planned (Phase 4):** disk job queue; unload after heavy jobs.

## Persistence

**Now:** `project.json` + localStorage director session.

**Planned (Phase 2):** film JSON + analysis JSON on disk.

## Navigation

**Films** = chaptered template demo.  
**Dub / Video** = later stages, or one long screencast.

Do not merge 3D mesh into this graph.

## Phases

1. **Shipped then corrected:** Film UX; default path is **your recording + chapters + voice**, not SKU photography  
2. Disk persistence for analysis/session  
3. Analysis-grounded script + per-segment regen  
4. Jobs + unload  
5. Docs/tests vs code  

**Later (not claimed as shipped):** auto-zoom on cursor, blur secrets, music, upscale, AI glue between clips.
