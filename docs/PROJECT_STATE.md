# Project State & Handoff

> Source of truth for **what the code does today** and what we are building next.  
> Trust this file and the source tree over older vision docs. Those often describe planned systems as if they shipped.

## Current branch / next branch

| Branch | Role |
|--------|------|
| `feat/film-phase-1` | Film UX for template demos (record the theme; app chapters, stitches, voices) |
| `fix/studio-llm-status-nav` | Ollama on-disk vs running server; Studio Script chips |
| `fix/create-intent-and-compose-ux` | **Current:** Create jobs, still compose, real Home covers, reference = variation, RU→EN for CLIP, delete/start over on Create result |

## Product (now)

AI Creative Workstation is an Electron + React desktop app with a Python FastAPI sidecar.

**Immediate product:** local-first workstation for **videos of a store template** (design, catalog, admin, builder, payments). You record the real UI; the app cuts, titles, stitches, and voices.

**Create** draws stills (FLUX): title card, storyboard frame, or catalog product. A reference photo or video frame is a **starting picture** — the prompt is the change (black leather bag → grey silk bag). It does not “undress” a character. A video reference can later be downloaded with a grade and the new still overlaid.

Russian prompts are translated to English **inside the sidecar** before CLIP/FLUX (`sidecar/prompt_en.py`). Users keep writing Russian in the UI. Do not add a second translator model; use the glossary plus the existing Ollama `qwen2.5:7b`, then unload it so FLUX is alone in RAM.

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
| Generate video | **IMPLEMENTED** (local Wan 2.2 TI2V-5B MLX q8; fallback H3/Runway; SVD is animation only) |
| Wan / SVD in catalog | **IMPLEMENTED** (TI2V = AI video; SVD = animation; Wan 2.1 T2V is not the ad path) |
| Video director + analyze → script → XTTS → export | **IMPLEMENTED** (session mostly **localStorage**) |
| 3D image → mesh | **IMPLEMENTED** (separate from video) |
| MLX, fal.ai, SQLite job queue, Creative Asset Graph | **PARTIAL** (MLX only for Wan 2.2 TI2V subprocess; fal.ai / queue / graph are docs) |

## Conceptual problem (why Phase 1)

Users currently choose between:

- **Projects** = generate product clips  
- **Video** = narrate an existing file  

Those are one production. The film is a **template walkthrough**: recordings in chapters, then the existing analyze → script → TTS path.

Voiceover analyze → script → TTS must be **preserved** and attached to Film, not deleted.

## Phase plan

Full architecture: [FILM_ARCHITECTURE.md](architecture/FILM_ARCHITECTURE.md).

| Phase | Goal |
|-------|------|
| **1** | **Corrected:** Film labels, template chapters, recording-first default, Studio advanced grouping |
| **2** | Persistence: Film JSON, analysis on disk, stop relying on localStorage for the film |
| **3** | Analysis → script quality; regenerate one narration segment |
| **4** | Disk job queue + unload after heavy jobs |
| **5** | Docs/tests aligned with code |

## Known issues

- Default Generate Video must not assume H3; default Film shot is **your screencast**.
- Runway is paid optional fallback, not the architecture.
- Two sources of truth: `project.json` vs `acw-director-session-*` localStorage.
- SQLite `projects` / `assets` tables exist and are unused.
- Docs/roadmap still claim MLX FLUX, fal.ai, character graph — **false**.
- FLUX + Ollama + XTTS must not stay co-resident. Translate with qwen, **unload**, then load FLUX. Analyze/script already call `release_heavy_for_other_work()`.
- 3D stays out of the film graph. Do not invent a huge identity graph / NLE / music.

## Incident log (read this before changing Create / CLIP / Home)

These already happened in the running app. Do not reintroduce them.

### CLIP ignored Russian → bottle instead of “blue sneaker”

**Symptom:** Create job **Товар**, prompt «Сделай этот кроссовок синим», result was a white pump bottle (or whatever sat in the reference / previous still). User saw the prompt box still saying “sneaker” under a bottle.

**Cause:**
1. CLIP on FLUX is English-only. Cyrillic is dropped. The old `_GLOSSARY` had title/UI/cat/dog/baker — not sneakers, colors, bags, “сделай этот…”.
2. For `job=product`, `_english_clip_prompt` **threw away the user text** and sent only `studio catalog product photograph, product on a clean background` (+ `same composition and subject as the reference` if one photo was attached). Img2img at strength `0.7` then kept the attached object.

**Fix (this branch):** `sidecar/prompt_en.py` — glossary rewrite first (so «кроссовок синим» → `make this sneaker blue` even if Ollama is down), then Ollama `qwen2.5:7b` if Cyrillic remains. Translation runs **before** FLUX loads. CLIP now **leads with the English subject**, then catalog tags. Log line: `prompt_en source=glossary|ollama|en`.

**Still true after the fix:** if the reference **is** a bottle and the prompt asks for a sneaker, img2img will try to keep the bottle. Start over, **remove the reference** (paperclip on Intent), then generate. Color/material changes on the **same** object are the intended ref path.

### Create result had no delete and no start over

**Symptom:** After a bad still, the only buttons were variants / download / 3D / Assets / voiceover. Zustand `useCreateStore` keeps `step: 'result'` when navigating Home → Create, so the bottle stayed on screen. `reset()` existed only on ErrorStep.

**Fix:** Result step has **Начать сначала** (`startOver`: back to intent, **keeps** prompt / job / refs so the user can edit or drop the photo) and **Удалить** (`delete-generated-still` IPC — only `~/Documents/Canvas/Generated/*.{png,jpg,webp}`, not Video/3D subfolders; drops the card from `homeStore.recentAssets`).

### Title stills silently became V2 PiP

**Symptom:** A title card from Create showed as an unexplained corner overlay on voiceover (V2), because `demoteShortClipsFromV1` shoved all images off V1.

**Fix (earlier on this branch):** compose modes intro / pip / off. Legacy sessions without `stillCompose` migrate to intro. Do not put title stills on V2 by default.

### Home showed mock Aria/Kael folders, not real files

**Fix (earlier on this branch):** `listProjects()` covers + `listGeneratedStills()` from `~/Documents/Canvas/Generated/*.png`.

### Studio said Script “not installed” while weights were on disk

**Cause:** Ollama weights present, server not running. Status mixed “not installed” with “server stopped”.

**Fix:** branch `fix/studio-llm-status-nav`. Treat on-disk vs running server as different states.

### Engine chip showed “Released 72%” while Activity Monitor showed 19 GB used and 5 GB swap

**Symptom:** User thought Canvas still held most of RAM / was leaking. Python sidecar was ~500–600 MB. Memory pressure green.

**Cause:** The chip appended `(total − os.freemem()) / total`. On macOS `os.freemem()` is unused *pages*, not Activity Monitor “Memory Used”. Cached files look “used” to Node and “free-ish” to Activity Monitor. After FLUX (tens of GB unified), macOS **does not shrink swap** until reboot even though the pipeline was idle-released.

**Fix:** Idle chip shows Python RSS (`Освобождено · 577 MB`), not a fake system percent. Panel RAM uses `psutil.virtual_memory().available`. Video jobs now `schedule_idle_release()` like stills (SVD/Wan used to stay in `pipeline_cache`).

**Not a leak:** 5 GB swap + 19 GB used of 64 GB with green pressure after unload is normal. Reboot if you want swap at 0. Cursor/Chrome helpers in Activity Monitor are the IDE, not the sidecar.

### Create “Видео” chip opened Voiceover

**Symptom:** On Create, chip **Видео** (`WorkspaceFlow` → `/video`) dumped the user into Озвучка step 6 of an existing film. They wanted a clip like a still.

**Fix:** Create has **Картинка | Клип**. Клип stays on `/create` and calls `/api/generate/video` (still + SVD / Runway / H3; Wan T2V if that model is selected). The old chip now goes to **Studio → Video engines**. Озвучка stays the sidebar item.

**Still true:** Mac default is **screencast + Ken Burns**, not local cinematic T2V. Клип needs a photo except Wan. Do not send Create-video to the 6-step voiceover pipeline.

### FLUX asked Metal for a 44 GiB buffer

**Symptom:** Create error `Invalid buffer size: 44.30 GiB` (friendly copy after the first pass). Chip ~750 MB after unload. **Попробовать снова** and 512px retry failed the same way.

**Cause:** Diffusers `enable_model_cpu_offload` copies T5-XXL onto Metal as one buffer, **and** `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0` tells PyTorch there is no cap, so the allocator requests Metal `maxBufferLength` (~44.30 GiB on a 64 GB Mac). Square format / 512px retry cannot help: T5 encode happens before pixels.

**Fix:** Watermark **both** `HIGH=0.0` and `LOW=0.0` (pair required; `HIGH=0.55` alone leaves default `LOW=1.4` → `invalid low watermark ratio 1.4`). CLIP+T5 stay on CPU; MPS SDPA sliced. Cache busts old FLUX without `_acw_flux_mps_v3`. **Fully quit the app** so the sidecar respawns.

### Do not do these

- Do not send Create “video” to the Voiceover route (`/video`). That page is analyze → script → TTS.
- Do not treat Node `os.freemem()` as Activity Monitor memory.
- Do not add a dedicated translator weight (no extra 7B just for RU→EN). Reuse qwen2.5:7b + glossary.
- Do not send Russian as the CLIP prompt and hope T5 saves it. CLIP decides the subject.
- Do not keep the Create result with no way back to intent.
- Do not merge 3D into the film timeline.
