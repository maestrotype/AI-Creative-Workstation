# MVP, V1, V2, ROADMAP
## AI Creative Workstation — Development Roadmap

---

## Challenging the MVP Assumption

The brief suggests the first killer workflow is:
> PHOTO → CHARACTER → IMAGE → 3D → VIDEO → YOUTUBE THUMBNAIL

**This is partially correct — but it's too broad for MVP.**

The challenge:
- 3D generation from photos: technically feasible but quality is inconsistent; pipeline is complex
- Video generation locally: slow (15–45 min on M4 Max for 5s); not viable for iterative creative work
- YouTube video: requires AI Director, which is a V2 feature
- All of this together: enormous scope, enormous testing matrix

**The real question for MVP:** What is the smallest demonstrable thing that proves the core thesis?

**Core thesis:** _Persistent creative assets that travel across modalities, with hardware-aware local execution._

The simplest proof of this thesis is:

> **Upload a photo. Define a character. Generate multiple consistent images. Save as character. Export a thumbnail.**

This demonstrates:
1. Photo → Character asset (identity preservation)
2. Character → multiple consistent images (asset reuse)
3. Image → thumbnail (workflow output)
4. Everything runs locally by default

3D and video are compelling extensions — but they add 6–9 months of development and are not required to prove the core value proposition.

**Revised MVP recommendation:**

| MVP scope | Why |
|-----------|-----|
| Photo → Character | Core moat: persistent identity |
| Character → Images (consistent) | Proves asset reuse |
| Image editing (prompt-based) | Essential creative control |
| Thumbnail/banner export | Concrete, measurable output |
| Local execution on Mac (M3/M4) | Core hardware differentiator |
| Basic project structure | Foundation for everything else |

**NOT in MVP:**
- Video generation (too slow locally; cloud route is expensive for a free product)
- 3D generation (quality inconsistency; complex pipeline)
- AI Director (requires production graph; V2)
- Windows support (doubles testing matrix; V1)
- Voice/audio (deferred; V1)
- Plugin system (deferred; V2)

---

## MVP (Month 0–5)

**Codename: Seed**
**Platform:** macOS (Apple Silicon M3/M4 only)
**Goal:** Prove the creative asset persistence thesis. Acquire early creator users. Validate the UX model.

### MVP Feature Scope

#### Core Creation
- [x] Natural language intent entry ("Create a cinematic portrait of me")
- [x] Photo upload and processing
- [x] LLM prompt enhancement (local, llama.cpp, small model)
- [x] Image generation: FLUX via MLX (local) + fal.ai (cloud)
- [x] Progress display with creative language
- [x] Result display with next-step suggestions
- [x] Image variations (3 variants)
- [x] Basic prompt-based editing ("make the background darker")

#### Character System (The Moat)
- [x] Character creation from 1–10 reference photos
- [x] Face identity embedding (IP-Adapter or FaceID approach via MLX)
- [x] Character entity page with generation history
- [x] Identity strength control (simple slider)
- [x] Character → Image generation (with identity preservation)
- [x] Multiple character references in one generation

#### Project Structure
- [x] Project creation (free-form to start)
- [x] Generation history within project
- [x] Basic asset library (characters + styles)
- [x] Thumbnail/banner task preset (1280×720, YouTube-optimized)

#### Studio / Hardware
- [x] Hardware detection at launch
- [x] Capability display (images: excellent, etc.)
- [x] FLUX Fast model bundled/downloadable (8GB)
- [x] FLUX Quality model downloadable (16GB)
- [x] Hardware-aware model selection (automatically)
- [x] Cloud routing when local insufficient

#### Export
- [x] Export image at multiple resolutions
- [x] PNG / JPEG / WebP format
- [x] YouTube thumbnail (1280×720)
- [x] Direct save to macOS Photos or Downloads

#### Privacy & Cloud
- [x] Local-only default
- [x] Cloud consent dialog (first use)
- [x] Privacy indicator (🔒 local / ☁️ cloud)
- [x] "Always local" mode in Settings

#### Onboarding
- [x] Hardware scan on first launch
- [x] Guided first creation (produces real output)
- [x] No account required to start

### MVP Technical Implementation

**Stack:**
- Electron 32 + React 19 + TypeScript
- SQLite + better-sqlite3 + Drizzle
- Python 3.11 sidecar (FastAPI)
- MLX-Diffusion for FLUX on Apple Silicon
- llama.cpp for local LLM (Qwen 1.5B for prompt enhancement)
- fal.ai for cloud routing

**Models shipped/downloadable:**
- FLUX.1 [schnell] MLX Q8: ~8GB (fast, for preview and variation)
- FLUX.1 [dev] MLX Q8: ~16GB (quality, for final generation)
- Qwen 1.5B GGUF: ~1GB (prompt enhancement, local LLM)
- IP-Adapter Face model: ~1GB (identity preservation)

**Total model footprint (minimal install):** ~10GB

### MVP Success Metrics

| Metric | Target |
|--------|--------|
| Time to first real output (new user) | < 5 minutes |
| Character creation success rate | > 85% perceive identity as "preserved" |
| Generation time (image, local M4 Max) | < 15 seconds (FLUX schnell) |
| NPS score (early users) | > 50 |
| "Used it again in same week" | > 60% |
| Screenshots / social shares | Organic evidence of quality |

---

## V1 (Month 6–11)

**Codename: Studio**
**Platform:** macOS (M2/M3/M4 all variants) + Windows (NVIDIA RTX 3080+)
**Goal:** Full creative workflow. Image + 3D. Product assets. Paid tier launch.

### V1 Additions

#### Image Workflow Extensions
- Inpainting (edit specific regions of generated images)
- Outpainting (extend images)
- Style assets (define and reuse styles across generations)
- Product assets (reference a product consistently)
- Multi-asset generation (character + product + style together)
- Upscaling (2× and 4×)
- Batch generation (generate 10 variations in background)

#### 3D Generation
- Image → 3D mesh (Hunyuan 3D, local where hardware allows)
- 3D interactive viewport (Three.js viewer with rotate, zoom, material preview)
- 3D export: GLB, OBJ+MTL, FBX
- 3D → Character asset linkage (character entity gains 3D representation)
- Cloud 3D routing for lighter hardware

#### Audio/Voice (Basic)
- Text → Voiceover (local TTS for character voices)
- Voice asset creation (link voice to character)
- Character gains voice identity (used in future video generation)
- **Russian pronunciation pipeline** — RUAccent, normalization, lexicon, prompt-based fix UI ([VOICE_PRONUNCIATION_PLAN.md](../product/VOICE_PRONUNCIATION_PLAN.md), branch `feat/voice-pronunciation`)
- **Video content voiceover V1** — shipped MVP: analyze → LLM script → XTTS → A1 ([VIDEO_VOICEOVER_PLAN.md](../product/VIDEO_VOICEOVER_PLAN.md), branch `feat/video-voiceover`)
- **Video content voiceover V2** — pipeline UX, VLM-aware script, continuous narration ([VIDEO_VOICEOVER_V2_VISION.md](../product/VIDEO_VOICEOVER_V2_VISION.md), branch `docs/voiceover-v2-vision`)

#### Project System (Enhanced)
- Project types: Image Pack, Content Package
- Scene structure within projects
- Generation dependency tracking (foundation for AI Director)
- Version history for assets
- Provenance viewer (what went into this generation)

#### Studio (Enhanced)
- Windows NVIDIA support (CUDA, SafeTensors/GGUF)
- Full model library for Windows
- Performance dashboard (generation speed, memory usage)
- Model auto-update notifications

#### Cloud Business Model Launch
- Free tier: Local generation only; 5 cloud credits/month
- Creator tier ($19/mo): 200 cloud credits; priority queue; 3D generation; advanced models
- Model monetization: sell curated model packs through in-app store

### V1 Technical Additions
- Windows Electron build with CUDA inference path
- Hunyuan 3D Python integration
- CoquiTTS or Kokoro-TTS for local voice synthesis (XTTS clone + timeline mix: see [VIDEO_STUDIO_PLAN.md](../product/VIDEO_STUDIO_PLAN.md); Coqui is still optional `pip install`)
- Three.js 3D viewport component
- Enhanced job queue with dependency tracking
- Stripe integration for billing

---

## V2 (Month 12–20)

**Codename: Director**
**Platform:** macOS + Windows + Linux (experimental)
**Goal:** AI Director. Video generation. Complete content packages. Team features.

### V2 Additions

#### Video Generation
- Image → Video (Wan 1.3B local; Wan 14B cloud-routed)
- Text → Video (via text → image → video pipeline)
- Character consistency across video shots (key technical challenge)
- Short video clips: 3–8 seconds
- Video scene assembly (multi-clip project)

**Now (pre-Director, living):** Slideshow + screencast ffmpeg and prompt TTS are specified in [VIDEO_STUDIO_PLAN.md](../product/VIDEO_STUDIO_PLAN.md). Voiceover V1 MVP is on `feat/video-voiceover`; V2 UX/intelligence is in [VIDEO_VOICEOVER_V2_VISION.md](../product/VIDEO_VOICEOVER_V2_VISION.md). Pronunciation quality is in [VOICE_PRONUNCIATION_PLAN.md](../product/VOICE_PRONUNCIATION_PLAN.md). Update those files when capabilities ship; do not treat the Director V2 list below as current UI.

#### AI Director
- Production plan generation from creative brief
- Dependency-ordered job scheduling
- Partial regeneration (change one scene, dependencies auto-cascade)
- Script → Voiceover → Image → Video pipeline
- Background music generation (cloud)
- Complete YouTube video package output
- 3× Shorts auto-generation from main video

#### Team Features (Studio tier)
- Shared asset library (team characters, styles)
- Project sharing and handoff
- Collaborative review (comment on generations)
- Role-based permissions

#### Advanced UX
- Lab mode full implementation (seed, sampler, LoRA, ControlNet)
- LoRA training (fine-tune on user's style/product)
- Community template sharing
- Style marketplace

---

## V3 (Month 21–30)

**Codename: Platform**
**Goal:** Platform play. API. Plugin ecosystem. Enterprise.

### V3 Additions
- Canvas API (allow third-party tools to call Canvas capabilities)
- Plugin marketplace (extend capabilities with community tools)
- Enterprise: private model registry, on-premise deployment, team management
- Real-time collaboration (multiplayer project editing)
- Mobile companion app (review/approve from iPhone)
- Automated pipeline scheduling (scheduled content generation)

---

## Full Roadmap Overview

```
MONTH:     0    3    6    9    12   15   18   21   24   27   30
           │    │    │    │    │    │    │    │    │    │    │
           │    │    │    │    │    │    │    │    │    │    │
PHASE:  ───┤    │    ├────┼────┤    │    ├────┼────┤    │    ├───
           │    │    │    │    │    │    │    │    │    │    │
           │ MVP│    │    │ V1 │    │    │ V2 │    │    │ V3 │
           │(Mac│    │    │(Mac│    │    │(Dir│    │    │(Plt│
           │only│    │    │+Win│    │    │ect)│    │    │frm)│
           │    │    │    │    │    │    │    │    │    │    │

KEY MILESTONES:
Month 3:  MVP alpha — private beta with 100 creators
Month 5:  MVP public early access — waitlist
Month 8:  V1 alpha — Mac + Windows beta
Month 11: V1 public — Paid tier launch
Month 14: V2 alpha — AI Director preview
Month 18: V2 public — Full video pipeline
Month 22: V3 alpha — API + plugin SDK
Month 28: V3 public — Platform launch
```

---

## What We Should NOT Build (Ever, or Until Very Late)

| Feature | Why Not |
|---------|---------|
| Our own model training infrastructure | Expensive, distraction; use open weights |
| Real-time video generation | Not technically feasible at local scale |
| Our own CDN / cloud GPU pool | Capital-intensive; use fal.ai/Replicate |
| Browser-based version | Loses local-first differentiator; complex security |
| Mobile-first creation | Desktop-first is appropriate for creative workstation |
| Social sharing / community feed | Distraction from core tool; not our product category |
| Template marketplace (early) | Competes with Canva on their home turf; not our moat |
| Full non-linear video editor | That's DaVinci Resolve; we generate, not edit |
| Our own speech/music foundation model | Use open weights; this is not a competitive moat |
