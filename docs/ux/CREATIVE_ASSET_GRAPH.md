# CREATIVE ASSET GRAPH
## AI Creative Workstation — Asset Graph Architecture (UX + Data)

---

## The Core Concept

The Creative Asset Graph is the product's most important architectural concept. It is the data structure that gives the product its primary moat — the ability for a creative entity defined once to be used consistently across all modalities.

**Crucially:** The user never sees a graph. They see assets. The graph is the invisible connective tissue between them.

---

## Why "Graph" and Not "Library"

A library is a collection of files. It has no memory of relationships.

A graph knows:
- That "Alex" (character) was used in "Scene 3" of "MacBook Review"
- That "Scene 3's image" was the source for "Scene 3's video"
- That "MacBook Pro" (product asset) appears in "Scene 2", "Scene 5", and the thumbnail
- That the "Cinematic" style used in this project matches the one from the "Brand Identity" project
- That deleting Alex would break 14 generations across 3 projects

**This is what makes reuse possible.** Not just finding files — understanding creative relationships.

---

## Asset Types (Nodes in the Graph)

```
CreativeAsset (abstract)
├── Character           — A persistent human or character identity
├── Product             — A real-world product with visual identity
├── Environment         — A place, setting, or scene background
├── Style               — Visual aesthetic reference (mood, color, look)
├── Voice               — Audio character/voice profile
└── Collection          — A named grouping of other assets
```

### Generation Types (also nodes, but ephemeral unless promoted)
```
Generation
├── Image               — A single generated image
├── Video               — A generated video clip
├── Audio               — Generated voiceover or music
├── Mesh3D              — A generated 3D model
└── Export              — A packaged output (ZIP, MP4, etc.)
```

---

## Graph Relationships (Edges)

```
Edge Types:
├── USED_IN         — Asset used in generation (Character → Image)
├── DERIVED_FROM    — Generation derived from another (Image → 3D Mesh)
├── BELONGS_TO      — Generation belongs to Project
├── REFERENCED_BY   — Asset references source material (Character → SourcePhoto)
├── INFLUENCED_BY   — Generation influenced by Style, Environment, etc.
├── DEPENDS_ON      — Scene depends on previous scene (for continuity)
└── VERSION_OF      — New version of same creative entity
```

---

## Example Graph: MacBook Review Project

```
Project: MacBook Pro Review
│
├── Assets Used:
│   ├── Character: Alex (Marcus)
│   │   ├── Source: 5 reference photos
│   │   ├── Generated: FaceEmbedding (internal, invisible to user)
│   │   └── Voice: Alex-Professional
│   │
│   ├── Product: MacBook Pro M4
│   │   ├── Source: 3 reference images
│   │   └── 3D Model: macbook_pro_m4.glb
│   │
│   └── Style: Dark-Cinematic
│       └── Source: 8 style reference images
│
├── Scenes:
│   ├── Scene 01: Intro
│   │   ├── Image: scene_01_hero.png
│   │   │   ├── USED: Alex (character)
│   │   │   ├── INFLUENCED_BY: Dark-Cinematic (style)
│   │   │   └── Prompt: "Alex in studio, dramatic lighting, MacBook..."
│   │   └── Video: scene_01.mp4
│   │       └── DERIVED_FROM: scene_01_hero.png
│   │
│   ├── Scene 02: Product closeup
│   │   ├── Image: scene_02_product.png
│   │   │   ├── USED: MacBook Pro M4 (product)
│   │   │   └── INFLUENCED_BY: Dark-Cinematic (style)
│   │   └── Video: scene_02.mp4
│   │
│   └── Scene 03: Alex with MacBook
│       ├── Image: scene_03_together.png
│       │   ├── USED: Alex (character)
│       │   ├── USED: MacBook Pro M4 (product)
│       │   └── INFLUENCED_BY: Dark-Cinematic (style)
│       └── Video: scene_03.mp4
│
├── Thumbnail: thumbnail_v2.jpg
│   ├── USED: Alex (character)
│   └── USED: MacBook Pro M4 (product)
│
└── Export: macbook_review_final.mp4
    └── ASSEMBLED_FROM: Scene 01, 02, 03 + voiceover + music
```

---

## UX Surface of the Asset Graph

### What the User Sees: Asset Detail View

```
CHARACTER — Alex
────────────────────────────────────────
[Primary portrait]  [5 reference photos]

Identity: ████████░░ Very Strong
Voice: Alex — Professional Male ✓
3D: Available ✓

─── Used in 3 projects ─────────────────
• MacBook Pro Review (active)
  14 images, 3 videos
• Brand Identity 2024
  6 images
• Personal Portfolio
  8 images, 1 video

─── Generated content ──────────────────
[img] [img] [img] [img] [img] +9 more

─── Relationships ──────────────────────
Style: Dark-Cinematic (used together 11×)
Product: MacBook Pro M4 (used together 8×)

─── Actions ────────────────────────────
[ Generate image ]  [ Create video ]
[ Open in 3D ]      [ Update identity ]
[ Export identity pack ]
```

### What the User Sees: Project Dependency View

Available in Project → Overview → "Show connections":

```
This project uses:
→ Alex (Character) — 14 generations depend on this
→ MacBook Pro M4 (Product) — 8 generations depend on this  
→ Dark-Cinematic (Style) — 22 generations depend on this

⚠️ Updating "Alex" will affect 14 generations.
   They can be automatically refreshed or kept as-is.
```

### Deletion Warning

```
Delete "Dark-Cinematic" style?

⚠️ 22 generations across 3 projects reference this style.
They will still exist but will lose their style link.

They won't be regenerated automatically.

[ Delete anyway ]  [ Cancel ]
```

---

## Provenance Tracking

Every generation records its full provenance context:

```json
{
  "generation_id": "gen_xyz789",
  "type": "image",
  "created_at": "2026-08-17T12:34:56Z",
  "prompt": "Alex in a dark studio, dramatic side lighting, MacBook Pro visible",
  "enhanced_prompt": "...",  // LLM-enhanced version
  "assets_used": [
    {"asset_id": "char_alex", "type": "character", "strength": 0.8},
    {"asset_id": "prod_macbook", "type": "product", "strength": 0.6},
    {"asset_id": "style_dark_cin", "type": "style", "strength": 0.7}
  ],
  "model_used": {
    "capability": "image_generation_with_identity",
    "model_id": "flux1-dev",
    "provider": "local",
    "engine": "mlx"
  },
  "hardware": {
    "device": "MacBook Pro M4 Max",
    "memory_gb": 64,
    "execution_ms": 12400
  },
  "seed": 42891,
  "resolution": "1024x1024",
  "can_reproduce": true
}
```

This allows:
- Exact reproduction of any result
- Understanding what changed between versions
- Audit trail for commercial asset licensing questions

---

## Asset Versioning Model

```
Character: Alex
├── v1 (2026-01-15) — 2 source photos, basic identity
├── v2 (2026-03-20) — 5 source photos, improved identity  ← current
└── v3 (draft)      — 7 source photos, being refined

Generations made with v1: 8 (frozen)
Generations made with v2: 22 (active)
```

When updating an asset:
- Existing generations are not changed (they reference the version used)
- New generations use the latest version
- User can choose to "refresh" existing generations to use the new version

---

## Implementation Notes (for Technical Architects)

The Creative Asset Graph is implemented as a **graph database** layer on top of SQLite using adjacency list pattern, supplemented by embedded vector search (`sqlite-vec`) for semantic asset retrieval.

Key design decisions:
- **Never delete generation records** — soft delete only; preserve provenance
- **Version all assets** — asset updates create new versions, not overwrites
- **Lazy relationship computation** — don't recompute the full graph on every change
- **Semantic search as first-class** — "find assets similar to this" is a core query

The graph must be queryable for:
- "All generations that used asset X"
- "All assets used in project Y"
- "What would regenerating if I update asset Z?"
- "Which generation is the source of this 3D model?"
- "Find assets similar to this style reference" (semantic search)
