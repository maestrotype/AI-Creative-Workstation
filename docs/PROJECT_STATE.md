# Project State & Handoff

> Source of truth for **what the code does today** and what we are building next.  
> Trust this file and the source tree over older vision docs. Those often describe planned systems as if they shipped.

## Current branch / next branch

| Branch | Role |
|--------|------|
| `feat/projects-workspace` | Last shipped work: filesystem projects, H3/Runway video gen paths, engine monitor |
| `feat/film-phase-1` | **Current:** Film UX — marketplace preset, shot UI, still-motion default, Studio advanced grouping |

## Product (now)

AI Creative Workstation is an Electron + React desktop app with a Python FastAPI sidecar.

**Immediate product:** local-first **commercial product video** (marketplace / ecommerce), not a general AI OS.

**Priority:** quality → zero cost → product identity → ease of use → speed.

**Hardware target:** MacBook Pro M4 Max, 64 GB unified memory. One heavy model in RAM at a time.

**3D** (TripoSR / Hunyuan3D, Three.js preview) is an **independent** module. Do not wire GLB → video.

## What is actually implemented

See [IMPLEMENTED_VS_PLANNED.md](architecture/IMPLEMENTED_VS_PLANNED.md).

Short version:

| Area | Status |
|------|--------|
| Projects on disk (`~/Documents/Canvas/Projects/{id}/project.json`) | **IMPLEMENTED** |
| Scene: still, clip, prompt, overlay, Ken Burns stitch | **IMPLEMENTED** |
| Image gen: FLUX / SDXL via Diffusers + PyTorch (MPS), not MLX | **IMPLEMENTED** |
| Generate video: MiniMax H3 (CUDA or SGLang URL) or Runway API | **IMPLEMENTED** (not practical as Mac default) |
| Wan / SVD in catalog | **PARTIAL** (downloadable; not the ad path) |
| Video director + analyze → script → XTTS → export | **IMPLEMENTED** (session mostly **localStorage**) |
| 3D image → mesh | **IMPLEMENTED** (separate from video) |
| MLX, fal.ai, SQLite job queue, Creative Asset Graph | **NOT IMPLEMENTED** (docs only) |

## Conceptual problem (why Phase 1)

Users currently choose between:

- **Projects** = generate product clips  
- **Video** = narrate an existing file  

Those are one production. Phase 1 makes **Film** the single path.

Voiceover analyze → script → TTS must be **preserved** and attached to Film, not deleted.

## Phase plan

Full architecture: [FILM_ARCHITECTURE.md](architecture/FILM_ARCHITECTURE.md).

| Phase | Goal |
|-------|------|
| **1** | **Shipped:** UX + domain: Film labels, marketplace preset, shot UI, still-motion default, Studio by capability |
| **2** | Persistence: Film JSON, analysis on disk, stop relying on localStorage for the film |
| **3** | Analysis → script quality; regenerate one narration segment |
| **4** | Disk job queue + unload after heavy jobs |
| **5** | Docs/tests aligned with code |

## Known issues

- H3 cannot run on M4 GPU; default Generate Video must not assume H3.
- Runway is paid optional fallback, not the architecture.
- Two sources of truth: `project.json` vs `acw-director-session-*` localStorage.
- SQLite `projects` / `assets` tables exist and are unused.
- Docs/roadmap still claim MLX FLUX, fal.ai, character graph — **false**.
