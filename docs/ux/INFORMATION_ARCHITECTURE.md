# INFORMATION ARCHITECTURE
## AI Creative Workstation

> **Design Philosophy:** Navigation must reflect creative mental models, not product features. Users think in terms of work, not tools.

---

## Why This IA, Not the Obvious One

### What We Rejected

The obvious structure would be:
```
Image | Video | 3D | Audio | Export | Settings
```

This is a **modality-first IA** — it organizes around what the product does, not what the user wants.

The alternative temptation:
```
Dashboard | Projects | Tools | Library | Settings
```

This is a **SaaS generic IA** — it looks like every software product ever made.

### What We Chose

A **workflow-first IA** where navigation reflects:
1. **Where you work** (Projects — the creative context)
2. **What you make** (Create — the primary action)
3. **What you own** (Assets — the persistent creative library)
4. **How your setup works** (Studio — models, hardware, providers)

---

## Primary Navigation Structure

```
CANVAS
├── Home              — Recents, continued work, discovery
├── Create            — Intent entry, task-driven generation
├── Projects          — Project workspace, scenes, timelines
├── Assets            — Creative entity library
│   ├── Characters
│   ├── Products
│   ├── Environments
│   ├── Styles
│   └── Collections
├── Studio            — Models, hardware, providers (power user)
└── Settings          — Account, preferences, cloud config
```

**Navigation count: 6 items.** Deliberate. If it can't fit in 6 items, something is wrong with the architecture.

---

## Level 1: Home

**Purpose:** Re-engage with existing work; discover what's possible; continue where you left off.

**NOT a dashboard.** Home is not a metrics screen. It is a visual landing space.

### Contents
- **Continue Working** — 3 most recent active projects with visual thumbnails
- **Recent Assets** — Latest characters/assets created, quick-access generation
- **Quick Create** — Direct intent entry (replicated from Create section)
- **Inspiration** — Curated examples of what the system can produce (not testimonials, actual outputs)

### Design Note
Home should feel like opening a creative notebook, not logging into a SaaS app.

---

## Level 2: Create

**Purpose:** The primary creative entry point. Single-task, focused, distraction-free.

### Sub-states (not separate pages — transitions within Create)

```
Create
├── Intent Entry       — "What do you want to make?"
├── Refinement         — Clarifying questions (style, mood, references)
├── Generating         — Progress with creative language
├── Result             — Output + next steps
└── Iteration          — Variations, edits, extensions
```

### Creation Templates (optional surface within Create)
Common creation tasks available as starting points. NOT Canva-style templates — these are workflow starting points:

- Portrait / Headshot
- YouTube Thumbnail
- YouTube Banner
- Character Creation
- Product Shot
- Scene / Environment
- Short Video
- Social Content Pack

These are templates for **intent**, not for design.

---

## Level 3: Projects

**Purpose:** The project workspace — the home for complex, multi-asset creative productions.

### Project View Structure
```
Project: "MacBook Pro Review — November"
├── Overview           — Summary, recent activity, export status
├── Assets             — Characters, styles, products used in this project
├── Scenes             — Ordered production units (images/video)
│   ├── Scene 01       — Intro (image + video + voice)
│   ├── Scene 02       — Main content
│   └── Scene 03       — Outro
├── Media              — All generated outputs (images, videos, audio)
├── Timeline           — Assembly and sequencing (if video project)
├── Exports            — Final packaged outputs
└── History            — Generation log, versions, provenance
```

### Project Types (determined by initial creation intent)
- **Image Pack** — Collection of related images (e.g., social media set)
- **Video Production** — Full video project with scenes, audio, script
- **Content Package** — Multi-format output (video + shorts + thumbnail + banner)
- **Asset Build** — Focused on creating a reusable creative entity (character, product)

The project type affects which views are visible and which workflows are suggested.

---

## Level 4: Assets

**Purpose:** The persistent creative library. Every reusable entity lives here.

### Asset Types

| Type | What It Contains | Primary Actions |
|------|-----------------|----------------|
| **Character** | Reference photos, identity, voice, 3D model, generation history | Generate image, Create video, Open in 3D, Edit identity |
| **Product** | Reference images, 3D model, materials | Product shot, 3D view, Place in scene |
| **Environment** | Reference images, scene description, style | Generate scene, Create video, Edit |
| **Style** | Reference images, style description, color palette | Apply to generation, Preview |
| **Collection** | Curated groups of other assets | — |

### Asset Detail View
Each asset opens a dedicated "asset page" — not a file inspector, but an entity view:

```
CHARACTER — Alex Chen
────────────────────────────────────────────
[Primary portrait thumbnail]  [+ 5 more]

Identity strength: ████████░░ Strong
Voice: "Alex — Professional Male"
3D Model: ✓ Available

Actions:
[ Generate Image ]  [ Create Video ]  [ Open 3D ]  [ Add to Project ]

Recent Generations (12)
[thumbnail] [thumbnail] [thumbnail] [thumbnail]  See all →

Usage
├── YouTube Review Series (Project)
├── MacBook Launch Content (Project)
└── LinkedIn Banner Set (Project)
```

---

## Level 5: Studio

**Purpose:** Hardware management, model library, inference configuration. This is **not** hidden — but it is deliberately placed away from the creative flow.

### Sub-sections

```
Studio
├── Hardware           — Detected hardware, capability ratings, performance
├── Models             — Local model library, install/update, compatibility
│   ├── Installed      — What's on disk
│   ├── Available      — What can be installed given hardware
│   └── Cloud Models   — Models accessible via cloud execution
├── Providers          — Local / cloud provider configuration
│   ├── Local          — Engine settings, memory allocation
│   └── Cloud          — API keys, credit balance, provider selection
└── Performance        — Generation history, speed statistics, resource usage
```

### Studio Is Not Required
A user who never opens Studio should still have a fully functional experience. The application manages hardware, models, and providers automatically. Studio is for users who want control, not users who need it.

---

## Level 6: Settings

Standard application preferences:
- Account and license
- Cloud provider credentials
- Storage paths (where projects, models, and assets are stored)
- Privacy settings (what can go to cloud, what stays local always)
- Notification preferences
- Application updates

---

## Navigation Decision Record

**Decision:** Use a left sidebar for primary navigation (not a top bar, not a bottom bar)

**Rationale:**
- Left sidebar is the established pattern for creative desktop software (Figma, Adobe, VS Code)
- Top bar with many items forces horizontal scanning — cognitively expensive
- Bottom bar is mobile-first — wrong affordance for desktop workstation
- Left sidebar can collapse to icons for maximum content space

**Trade-off:** Left sidebar takes horizontal space. Mitigated by collapse-to-icon mode when in focused creation.

---

**Decision:** Assets are separate from Projects in the primary nav

**Rationale:**
- Assets exist across projects — they are a library, not a project component
- A user may want to manage their character library without opening any specific project
- Conflating assets and projects creates confusion about asset scope
- Separate nav items reinforce the mental model: "My creative entities" vs "My creative works"

**Trade-off:** Two navigation items for related concepts. Mitigated by cross-linking (Project view surfaces its own assets; Asset view shows which projects use each asset).

---

**Decision:** Studio is a separate top-level item, not under Settings

**Rationale:**
- Model management and hardware configuration are genuinely different from app preferences
- Power users need Studio regularly; it should not be buried in Settings
- Studio's prominence signals to power users that the product takes local inference seriously
- But it must remain clearly secondary to Create/Projects/Assets

**Trade-off:** 6 nav items instead of 5. Acceptable given the importance of local model management.

---

## Screen Inventory (High-Level)

| Screen | Mode | Description |
|--------|------|-------------|
| Home | All | Recent work, quick create, discovery |
| Create — Intent | Create | Natural language / photo entry |
| Create — Refine | Create | Style, mood, reference selection |
| Create — Generating | Create | Progress and real-time feedback |
| Create — Result | Create | Output display + next steps |
| Project — List | Project | All projects, sorted/filtered |
| Project — Overview | Project | Single project summary |
| Project — Scene | Project | Individual scene editor |
| Project — Timeline | Project | Video assembly/sequencing |
| Project — Export | Project | Output format and export |
| Assets — List | Asset | All assets, filtered by type |
| Assets — Character | Asset | Character entity page |
| Assets — Product | Asset | Product entity page |
| Assets — Style | Asset | Style entity page |
| Studio — Hardware | Studio | Hardware detection and capability |
| Studio — Models | Studio | Model library and management |
| Studio — Providers | Studio | Execution provider config |
| Settings | Settings | Application preferences |
| Onboarding — Welcome | Create | First-run experience |
| Onboarding — Hardware | Create | Hardware scan and capability |
| Onboarding — First Create | Create | Guided first generation |
