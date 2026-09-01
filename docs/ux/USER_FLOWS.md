# USER FLOWS
## AI Creative Workstation — Detailed UX Flows

---

## Flow A: Image Generation with Identity Preservation

**Scenario:** Marcus wants a cinematic portrait of himself for a YouTube channel trailer.

```
ENTRY: Create screen
│
│  User types: "A cinematic portrait of me in Tokyo at night"
│  User drops photo: headshot.jpg
│
▼
INTENT CAPTURED
│
│  System parses:
│  - Subject: Person (identity from photo)
│  - Setting: Tokyo, night
│  - Style: Cinematic
│  - Format: Portrait / landscape?
│
▼
CLARIFYING MOMENT (if needed)
┌────────────────────────────────────────┐
│  Got it! A few quick choices:          │
│                                        │
│  Format:                               │
│  ○ Square (social)  ● Portrait  ○ Wide │
│                                        │
│  Style intensity:                      │
│  ○ Subtle  ● Cinematic  ○ Bold         │
│                                        │
│  Keep you recognizable:                │
│  ●●●●○  Strong                         │
│         ↑ drag to adjust               │
│                                        │
│  [ Create ]                            │
└────────────────────────────────────────┘
│
▼
GENERATING
┌────────────────────────────────────────┐
│  Creating your cinematic portrait...   │
│                                        │
│  ████████████░░░░░░░░  60%             │
│  Composing Tokyo night scene           │
│  Estimated: 8 seconds                  │
│                                        │
│  🔒 Running locally on your Mac        │
└────────────────────────────────────────┘
│
▼
RESULT
┌────────────────────────────────────────┐
│  [Generated Portrait]                  │
│                                        │
│  Happy with this?                      │
│  ────────────────────────────────────  │
│  [ Try variations ]  [ Edit this ]     │
│  [ Animate ]         [ Convert to 3D ] │
│  [ Save as character ]                 │
│  [ Export ]                            │
│                                        │
│  Saved to: Unsorted (tap to add to     │
│  project or asset)                     │
└────────────────────────────────────────┘
│
▼ (if user chooses "Try variations")
│
VARIATIONS PANEL
│  System generates 3 variations with different:
│  - Time of day (neon, rainy, foggy)
│  - Camera angle
│  - Depth of field
│
│  User selects preferred, can "refine" with additional instruction:
│  "More rain on the streets"
│
▼
ITERATION — same flow continues until satisfied
│
▼ (if user chooses "Save as character")
│
CHARACTER CREATION
│  Name: "Marcus"
│  Using: 1 source photo + generated portrait
│  Identity strength: calibrated automatically
│  [ Save Character ]
│
▼
CHARACTER ASSET CREATED
│  Marcus is now available in Assets → Characters
│  Future generations can reference "Marcus" for consistency
```

---

## Flow B: YouTube Thumbnail Creation

**Scenario:** Marcus needs a YouTube thumbnail for his MacBook Pro review.

```
ENTRY: Create → "YouTube Thumbnail" template selected
│
│  OR: User types "YouTube thumbnail for my MacBook review"
│
▼
INTENT FORM (pre-configured for thumbnail task)
┌────────────────────────────────────────────┐
│  YouTube Thumbnail                         │
│  ──────────────────────────────────────    │
│  Your photo:  [ + Marcus (character) ]     │
│               or [ + Upload new photo ]    │
│                                            │
│  Title text:  "MacBook Pro M4 Review"      │
│               [ Suggest title variations ] │
│                                            │
│  Main subject: "MacBook Pro laptop"        │
│               [ Browse assets ] or [ type ]│
│                                            │
│  Style:                                    │
│  ○ Clean/minimal  ● Cinematic  ○ Bold      │
│                                            │
│  Background:                               │
│  "Dark studio, dramatic lighting"          │
│                                            │
│  [ Generate 3 variants ]                   │
└────────────────────────────────────────────┘
│
▼
GENERATING 3 VARIANTS (parallel)
│
▼
VARIANT SELECTION
┌──────────────────────────────────────────────────┐
│  [Variant 1]    [Variant 2]    [Variant 3]        │
│                                                   │
│  Pick one to refine, or export all for A/B test   │
│                                                   │
│  Selected: Variant 2                              │
│                                                   │
│  Refine: "Move text to the left, make it bolder" │
│  [ Apply ]                                        │
│                                                   │
│  [ Export at 1280×720 ]  [ Export all variants ]  │
└──────────────────────────────────────────────────┘
│
▼
EXPORT OPTIONS
│  Format: JPEG / PNG / WebP
│  Resolution: 1280×720 (YouTube standard)
│  File name: auto-generated ("MacBook-Review-Thumbnail-v2")
│  Destination: Downloads / Project folder
│
▼
DONE — thumbnail file exported
```

---

## Flow C: Character Creation

**Scenario:** Sam wants to create a persistent 3D game character "Kira" from photos.

```
ENTRY: Assets → Characters → [ Create character ]
│
▼
CHARACTER CREATION WIZARD
┌────────────────────────────────────────────┐
│  Create a character                        │
│  ──────────────────────────────────────    │
│  Step 1: Who is this character?            │
│                                            │
│  Name: Kira                                │
│                                            │
│  Upload reference photos:                  │
│  [ + ] [ + ] [ + ] [ + ] [ + ]             │
│  (3–10 photos recommended)                 │
│  "Front, side, and 3/4 views help most"    │
│                                            │
│  Photos uploaded: 7                        │
│                                            │
│  [ Continue ]                              │
└────────────────────────────────────────────┘
│
▼
CHARACTER DEFINITION
┌────────────────────────────────────────────┐
│  Step 2: What's Kira's visual style?       │
│  ──────────────────────────────────────    │
│                                            │
│  Art style:                                │
│  ● Realistic  ○ Stylized  ○ Anime          │
│                                            │
│  Character description (optional):         │
│  "Young woman, late 20s, athletic build,   │
│   cyberpunk aesthetic, dark hair"          │
│                                            │
│  Clothing / Outfit (optional):             │
│  "Dark tactical jacket, urban gear"        │
│                                            │
│  [ Build Character ]                       │
└────────────────────────────────────────────┘
│
▼
BUILDING CHARACTER IDENTITY
┌────────────────────────────────────────────┐
│  Building Kira's identity...               │
│                                            │
│  Analyzing reference photos                │
│  Creating face identity                    │
│  Building visual profile                   │
│  ████████████████░░░  85%                  │
│                                            │
│  🔒 Running locally                        │
└────────────────────────────────────────────┘
│
▼
CHARACTER CREATED — ENTITY PAGE
┌────────────────────────────────────────────┐
│  CHARACTER — Kira                          │
│  ──────────────────────────────────────    │
│  [Generated representative portrait]       │
│                                            │
│  Identity: ████████░░ Strong               │
│                                            │
│  What would you like to create?            │
│  [ Generate image ]    [ Create 3D model ] │
│  [ Record voice ]      [ Animate ]         │
│                                            │
│  "Try: Kira in a neon-lit alley at night"  │
└────────────────────────────────────────────┘
│
▼ (if user selects "Create 3D model")
│
→ Flow D: Image → 3D continues
```

---

## Flow D: Image → 3D Conversion

**Scenario:** Sam wants to convert Kira's portrait into a 3D model for his game.

```
ENTRY: From Kira's character page → "Create 3D model"
│      OR: From any generated image → "Convert to 3D"
│
▼
3D GENERATION PREP
┌────────────────────────────────────────────┐
│  Creating 3D model of Kira                 │
│  ──────────────────────────────────────    │
│                                            │
│  Source: [Kira's reference portrait]       │
│                                            │
│  Polygon style:                            │
│  ○ Game-ready (low poly, optimized)        │
│  ● Detailed (high poly)                    │
│  ○ Stylized                                │
│                                            │
│  Include:                                  │
│  ☑ Full body (from reference)              │
│  ☑ PBR materials and textures              │
│  ☐ Rig for animation (adds time)           │
│                                            │
│  Estimated time: 3-8 minutes               │
│  ⚡ Cloud recommended (better quality)     │
│                                            │
│  [ Generate locally (slower) ]             │
│  [ Generate on cloud ]                     │
└────────────────────────────────────────────┘
│
▼
GENERATING
│  3D mesh creation: progress
│  Texture and material generation: progress
│
▼
3D RESULT — INTERACTIVE VIEWPORT
┌────────────────────────────────────────────┐
│  ┌──────────────────────────────────────┐  │
│  │  [Interactive 3D viewer]             │  │
│  │  Drag to rotate | Scroll to zoom     │  │
│  │                                      │  │
│  │  [Kira 3D model rotating]            │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  Mesh: 42,000 polygons                     │
│  Textures: Diffuse, Normal, Roughness      │
│                                            │
│  ┌────────────────────────────────────┐    │
│  │ Material preview:  PBR  ▼          │    │
│  │ [○ Clay  ○ PBR  ● Textured  ○ Wire]│    │
│  └────────────────────────────────────┘    │
│                                            │
│  [ Export GLB ]  [ Export OBJ+MTL ]        │
│  [ Animate ]     [ Place in scene ]        │
│  [ Optimize for game engine ]              │
│                                            │
│  Kira's 3D model saved to character assets │
└────────────────────────────────────────────┘
```

---

## Flow E: AI Director — YouTube Production

**Scenario:** Marcus wants to create a 7-minute YouTube video about the MacBook Pro M4.

```
ENTRY: Create → "YouTube Video"
│
▼
BRIEF ENTRY
┌────────────────────────────────────────────┐
│  Create a YouTube video                    │
│  ──────────────────────────────────────    │
│                                            │
│  What's the video about?                   │
│  "A 7-minute review of the MacBook Pro M4" │
│                                            │
│  Who are you?                              │
│  [ Marcus (Character) ▼ ]                  │
│                                            │
│  Tone:                                     │
│  ● Informative  ○ Entertaining  ○ Cinematic│
│                                            │
│  Audience: Tech enthusiasts                │
│                                            │
│  Include:                                  │
│  ☑ Script   ☑ Voiceover   ☑ Thumbnail      │
│  ☑ Shorts clips (3)       ☐ B-roll         │
│                                            │
│  [ Generate Production Plan ]              │
└────────────────────────────────────────────┘
│
▼
AI DIRECTOR: PRODUCTION PLAN
┌────────────────────────────────────────────┐
│  Production Plan: MacBook Pro M4 Review    │
│  ──────────────────────────────────────    │
│                                            │
│  ESTIMATED: 45-90 minutes total generation │
│                                            │
│  ├── Script          ✦ LLM (2 min)         │
│  ├── Voiceover       ✦ TTS (5 min)         │
│  ├── Scene 01: Intro                       │
│  │   ├── Prompt     Auto-generated         │
│  │   ├── Image      🔒 Local (30s)         │
│  │   └── Video      ⚡ Cloud (3 min)       │
│  ├── Scene 02: Design                      │
│  ├── Scene 03: Performance                 │
│  ├── Scene 04: Real-world use              │
│  ├── Scene 05: Competitors                 │
│  ├── Scene 06: Verdict                     │
│  ├── B-roll: 6 clips                       │
│  ├── Music: Background track               │
│  ├── Thumbnail: 3 variants                 │
│  ├── Shorts: 3 clips                       │
│  └── Export: YouTube-ready MP4             │
│                                            │
│  [ Edit plan ]  [ Start production ]       │
└────────────────────────────────────────────┘
│
▼ (after approval)
│
PRODUCTION MODE — PROJECT VIEW
│
│  Project: MacBook Pro M4 Review
│  Progress: 3/14 tasks complete ████░░░░░ 22%
│
│  Running now: Scene 02 — Image (local)
│  Queue: Scene 02 — Video (cloud)
│
│  [ Pause ]  [ View script ]  [ Edit scene 4 ]
│
▼
SCENE EDITING (partial regeneration)
│
│  User: "Make Scene 4 more cinematic, darker background"
│  Only Scene 4 regenerates — all other scenes preserved
│  Dependency check: Scene 4 does not feed into others → safe
│
▼
EXPORT
│  All components assembled
│  Final render: YouTube-ready MP4 (1080p)
│  Thumbnail: exported separately
│  Shorts: 3 separate clips
│  All saved to project and to export folder
```

---

## Flow F: Existing Video Analysis

**Scenario:** Priya imports a client's existing YouTube video for repurposing.

```
ENTRY: Create → "Analyze existing video"
│      OR: Project → Import → video file
│
▼
IMPORT
│  Drop video file or paste YouTube URL
│  File accepted: client_product_launch.mp4 (12 min)
│
▼
ANALYSIS (background processing)
┌────────────────────────────────────────────┐
│  Analyzing your video...                   │
│                                            │
│  Transcribing audio         ████████░  85% │
│  Detecting scenes           ████░░░░  45%  │
│  Identifying key moments    ░░░░░░░░   0%  │
│                                            │
│  Estimated: 2 minutes                      │
└────────────────────────────────────────────┘
│
▼
ANALYSIS RESULTS
┌────────────────────────────────────────────┐
│  Video Analysis: client_product_launch.mp4 │
│  ──────────────────────────────────────    │
│                                            │
│  12 scenes detected                        │
│  Transcript: ready (847 words)             │
│                                            │
│  AI Suggestions:                           │
│  ○ Best Short: 0:42–1:18 (product reveal)  │
│  ○ Best Short: 3:20–3:55 (key benefit)     │
│  ○ Best Short: 9:10–9:45 (call to action)  │
│                                            │
│  Thumbnail: Scene at 2:34 suggested        │
│                                            │
│  [ Create Shorts ]  [ Generate Thumbnails ]│
│  [ Edit Transcript ]  [ Export Assets ]    │
└────────────────────────────────────────────┘
```

**Implementation note:** Flow F is **specified but not implemented**. Target UI: Video → **From video** per [VIDEO_VOICEOVER_PLAN.md](../product/VIDEO_VOICEOVER_PLAN.md). Phase 1 ships transcript + scenes only; Shorts/thumbnail actions are later.

---

## Flow H: Video Voiceover from Upload

**Scenario:** Creator uploads a screencast and wants a new Russian voiceover guided by a prompt.

```
ENTRY: Video → From video
│
▼
UPLOAD
│  Drop video or pick from library
│  screencast_angular_shop.mp4 (4:32)
│
▼
ANALYSIS
┌────────────────────────────────────────────┐
│  Understanding your video...               │
│  Transcribing speech        ████████░  80% │
│  Finding scene boundaries   ██████░░  60%  │
└────────────────────────────────────────────┘
│
▼
CONTEXT SUMMARY
│  4:32 · 6 scenes · transcript ready
│  [ View transcript ]  [ View scenes ]
│
▼
VOICEOVER PROMPT
┌────────────────────────────────────────────┐
│  What should the voiceover say?            │
│  «Обзор для YouTube, дружелюбно, без воды» │
│  [ Generate script ]                         │
└────────────────────────────────────────────┘
│
▼
SCRIPT EDITOR (editable segments)
│  0:00–0:18  «В этом видео мы покажем...»
│  0:18–1:05  «Сначала откройте каталог...»
│  [ Preview all ]  [ Apply to timeline ]
│
▼
PER-SEGMENT VOICE (links to Flow I)
│  TTS per segment → Director A1 track
│
▼
EXPORT
│  Director → Export MP4 with voiceover
```

**Plan:** [VIDEO_VOICEOVER_PLAN.md](../product/VIDEO_VOICEOVER_PLAN.md) · Branch: `feat/video-voiceover`

---

## Flow I: Pronunciation Fix After Listen

**Scenario:** TTS sounds wrong on one word; user fixes without re-writing the whole script.

```
ENTRY: Assets → Voice test  OR  Video → Director segment player
│
▼
LISTEN
│  ▶ «...в настройках замка безопасности...»  — wrong stress on «замок»
│
▼
FIX (prompt or inline)
┌────────────────────────────────────────────┐
│  Fix pronunciation:                        │
│  «слово замок — ударение на а»               │
│  [ Apply ]                                   │
│                                            │
│  Processed: «...в настройках з+амка...»      │
│  Saved to lexicon ✓                          │
└────────────────────────────────────────────┘
│
▼
REGENERATE SEGMENT
│  ▶ correct pronunciation · same timeline position
```

**Plan:** [VOICE_PRONUNCIATION_PLAN.md](../product/VOICE_PRONUNCIATION_PLAN.md) · Branch: `feat/voice-pronunciation`

---

## Flow G: Onboarding (First-Run)

**Design requirement:** First-run experience must produce a real creative output, not just a tour.

```
LAUNCH (first time)
│
▼
WELCOME
┌────────────────────────────────────────────┐
│                                            │
│  CANVAS                                    │
│                                            │
│  Create. Don't configure.                  │
│                                            │
│  The AI creative workstation that runs     │
│  on your machine.                          │
│                                            │
│  [ Get started — takes 2 minutes ]         │
│                                            │
└────────────────────────────────────────────┘
│
▼
HARDWARE SCAN (silent, 3-5 seconds)
┌────────────────────────────────────────────┐
│  Discovering your system...                │
│                                            │
│  MacBook Pro M4 Max                        │
│  64 GB unified memory                      │
│                                            │
│  Your capabilities:                        │
│  ● Images          Excellent               │
│  ● 3D              Good                    │
│  ● Short video     Good                    │
│  ◐ Long video      Cloud recommended       │
│                                            │
│  [ Continue ]                              │
└────────────────────────────────────────────┘
│
▼
FIRST CREATION — GUIDED
┌────────────────────────────────────────────┐
│  Let's create something.                   │
│                                            │
│  Drop a photo of yourself                  │
│  (or skip to try without one)              │
│                                            │
│  [  Drop photo here  ]                     │
│                                            │
│  What do you want to make?                 │
│  ○ A portrait in a new style               │
│  ● A YouTube channel banner                │
│  ○ A character for 3D                      │
│                                            │
│  [ Create it ]                             │
└────────────────────────────────────────────┘
│
▼
GENERATION — FIRST OUTPUT
│  User sees their first real output
│  No onboarding video. No feature tour.
│  Just their photo, transformed.
│
▼
SUCCESS STATE
┌────────────────────────────────────────────┐
│  [Their generated result]                  │
│                                            │
│  That's Canvas.                            │
│                                            │
│  Your photo stays on your Mac.             │
│  Your work is saved in your first project. │
│                                            │
│  [ Continue exploring ]  [ Start a project]│
└────────────────────────────────────────────┘
```
