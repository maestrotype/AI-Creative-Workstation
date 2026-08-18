# README
## AI Creative Workstation — Blueprint Documentation

> **Status:** Architecture Blueprint (Pre-implementation)
> **Version:** 1.0 — August 2026
> **Classification:** Internal product strategy document

---

## What Is This?

This repository contains the complete product, UX, design, and technical architecture blueprint for **Canvas** — an AI creative workstation that makes local-first AI creative production accessible to creators without requiring them to understand AI tooling.

This is not an implementation. It is a detailed specification from which a senior engineering team can begin implementation.

---

## Executive Summary

### What Are We Building?

A local-first AI creative workstation — codename **Canvas** — that makes the full spectrum of AI-powered creative production (images, characters, 3D assets, videos, complete content packages) feel like natural creative work rather than technical configuration.

### Who Is It For?

Skilled content creators, solopreneurs, indie game developers, and small studios who are blocked by:
- The complexity of local AI tools (ComfyUI, InvokeAI)
- The cloud dependency of cloud tools (Midjourney, Runway)
- The creative ceiling of simplified tools (Canva, CapCut)
- The lack of cross-tool asset memory (every workflow starts from zero)

### What Is the Core Differentiator?

The **Creative Asset Graph** — the ability to define creative entities (characters, products, styles, environments) once, and use them consistently across image, 3D, video, and all output formats. With persistent identity. With tracked provenance. Without re-configuration.

### What Should We Build First?

**MVP:** Photo → Character → Consistent Images → Thumbnail/Banner. Mac-only. No video. No 3D. Five months. This proves the core moat (asset persistence and identity preservation) with the minimum viable scope.

### What Should We NOT Build?

- Our own GPU infrastructure (use fal.ai/Replicate)
- Our own foundation models (use open weights)
- A browser/web version (loses local-first advantage)
- Social/community features (distraction from tool quality)
- Plugin marketplace (V3 horizon)
- Video in MVP (too slow locally; too expensive in cloud for free tier)

---

## Documentation Map

```
docs/
├── product/
│   ├── PRODUCT_VISION.md          ← Start here. What we're building and why.
│   ├── PRODUCT_PRINCIPLES.md      ← The 10 non-negotiable constraints.
│   ├── PERSONAS.md                ← Who we're building for (with JTBD).
│   ├── POSITIONING.md             ← How we compete and where we stand.
│   ├── COMPETITIVE_ANALYSIS.md    ← Deep research on every relevant competitor.
│   └── PRODUCT_MOAT.md            ← What's genuinely defensible (honest analysis).
│
├── ux/
│   ├── UX_PRINCIPLES.md           ← 10 interaction design principles.
│   ├── INFORMATION_ARCHITECTURE.md ← Why this nav structure, not the obvious one.
│   ├── USER_FLOWS.md              ← Detailed flows for all 7 major workflows.
│   ├── CREATIVE_ASSET_GRAPH.md    ← The asset graph: UX surface + data model.
│   ├── AI_DIRECTOR.md             ← Production planning intelligence (V2 design).
│   └── LOCAL_MODEL_AND_CLOUD_UX.md ← Hardware UX + cloud consent flows.
│
├── design/
│   ├── DESIGN_SYSTEM.md           ← Color, type, spacing, elevation, motion.
│   └── WEBSITE_EXPERIENCE.md      ← Interactive marketing site concept.
│
├── architecture/
│   ├── SYSTEM_ARCHITECTURE.md     ← Full system with ADRs and technology choices.
│   ├── DOMAIN_MODEL.md            ← All entities, relationships, TypeScript interfaces.
│   └── RISKS_AND_DECISIONS.md     ← Top 10 × 3 decisions + 10 risks.
│
└── roadmap/
    └── ROADMAP.md                 ← MVP, V1, V2, V3 with scope, metrics, and reasoning.
```

---

## The One-Page Thesis

```
THE PROBLEM:
Every AI creative tool forces a choice:
  • Cloud → lose your data, pay per generation, no local hardware advantage
  • Local → drown in technical complexity (ComfyUI, CUDA, VRAM, samplers...)
  • Simplified → hit a creative ceiling immediately (Canva, CapCut)
  • Combination → 5 different tools, no project memory, start from zero every time

THE INSIGHT:
The gap is not a missing feature. It's a missing product category.
"Local-first + Creative Simplicity" is an entirely unoccupied position in the market.

THE MOAT:
The Creative Asset Graph — the ability to define a character, product,
or style once, and use it consistently across image → 3D → video.
With persistent identity. With no re-configuration.
The longer you use the system, the richer your creative library becomes.
That is earned lock-in, not forced lock-in.

THE PRODUCT:
Canvas — a creative workstation where:
  • Your photo becomes a character
  • Your character appears consistently in every image
  • Your character becomes a 3D model
  • Your character appears in video
  • Your YouTube content package is assembled intelligently
  • Everything runs on your hardware, by default
  • Nothing leaves your machine without your explicit consent

THE MVP:
Photo → Character → Consistent Images → Thumbnail
Five months. Mac only. No video. No 3D.
Prove the identity persistence thesis. Acquire the first 1,000 creators.

THE BUSINESS:
Local generation: free.
Cloud generation: paid (credits).
Advanced models + studio features: subscription.
The user's hardware does the work; we provide the intelligence.
```

---

## Key Decisions at a Glance

| Decision | Choice | Why |
|----------|--------|-----|
| Desktop shell | Electron | Guaranteed WebGPU; AI app ecosystem; LM Studio precedent |
| UI framework | React + TypeScript | Industry standard; best TS support |
| AI inference | Python sidecar (FastAPI) | Access to ML Python ecosystem; isolated from UI |
| Database | SQLite + Drizzle | Zero infrastructure; portable; fast |
| Vector search | sqlite-vec | Local embeddings without external DB |
| Image models | FLUX via MLX (Mac) / CUDA (Win) | Best quality; open weights; MLX performance on Apple Silicon |
| LLM | llama.cpp + Qwen 1.5B GGUF | Small, fast, local; prompt enhancement only in MVP |
| Cloud routing | fal.ai API | Fast; FLUX support; Wan video support |
| Primary platform | macOS Apple Silicon | Best local AI hardware; well-defined target |
| MVP scope | Images + character identity | Proves core moat; achievable in 5 months |

---

## Challenges to the Concept (Honest)

The following aspects of the original vision are either unrealistic for early versions or require challenge:

| Claim | Reality |
|-------|---------|
| "Full image + video + 3D + audio from day one" | Too broad. Phase these. Start with images + character identity. |
| "Video runs locally" | On M4 Max: 15–45 min for 5s clip. Acceptable for export; not for iteration. Cloud-route video. |
| "Perfect face preservation" | Current models are "recognizably similar," not "identical." Set correct expectations. |
| "3D continuity across modalities" | Hunyuan 3D is impressive but pipeline is complex. Quality varies. V1, not MVP. |
| "AI Director from day one" | Requires asset graph + job system + multi-modal generation as prerequisites. V2. |
| "Mac + Windows support from day one" | Doubles testing matrix. Mac first. Windows in V1. |
| "Model licensing isn't a problem" | It is. FLUX dev is non-commercial. Legal review required before shipping any model. |

---

## Getting Started (For Engineering Team)

1. **Read** `PRODUCT_VISION.md` — 15 minutes; establishes the "why"
2. **Read** `PRODUCT_PRINCIPLES.md` — 10 minutes; establishes constraints for every decision
3. **Read** `SYSTEM_ARCHITECTURE.md` — 30 minutes; establishes technical foundations
4. **Read** `DOMAIN_MODEL.md` — 20 minutes; establishes the data model
5. **Read** `ROADMAP.md` — 15 minutes; establishes MVP scope
6. **Read** `USER_FLOWS.md` — 30 minutes; establishes what we're building in UX terms
7. All other documents as needed for specific areas

**Do not read documents in isolation.** The product principle "the model is an implementation detail" affects every UX decision. The UX principle "three layers, no leakage" affects every architectural decision. These documents are interconnected.
