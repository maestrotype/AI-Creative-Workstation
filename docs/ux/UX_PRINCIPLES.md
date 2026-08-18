# UX PRINCIPLES
## AI Creative Workstation

---

## The Core UX Thesis

**The application should feel like a creative partner, not a control panel.**

A control panel asks: "What settings do you want?"  
A creative partner asks: "What are you trying to make?"

Every UX decision should be evaluated against this distinction.

---

## Principle 1: Intent Over Interface

The primary entry point to any creative action is a natural language description of what the user wants — not a form, not a dropdown, not a menu.

**Pattern:** A persistent, always-visible creation bar that accepts:
- Text description ("Create a cinematic portrait of me in Tokyo at night")
- Photo drop ("Here's my photo — make a YouTube thumbnail")
- Asset reference ("Use my character Alex in a new scene")

The UI then **asks clarifying questions** only when necessary — and only creative questions ("What style?", "Which mood?") never technical ones ("Which model?", "What sampler?").

---

## Principle 2: Progressive Disclosure

Three modes exist in the application. Users arrive in the mode appropriate to their intent and never have to see the others:

### Level 1: CREATE
The default entry state. Single focus. One task at a time. No sidebars, no asset panels, no technical information.

```
┌──────────────────────────────────────────┐
│  What are you creating today?            │
│  ┌────────────────────────────────────┐  │
│  │  "A YouTube banner with my photo"  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  [ + Add photo ]  [ Choose style ]       │
│                                          │
│  Recent:  Portrait  |  Banner  |  3D     │
└──────────────────────────────────────────┘
```

### Level 2: PROJECT
Project workspace. Assets, scenes, generations, history. Rich but structured. Technical details available on demand via expand/reveal patterns.

### Level 3: LAB
Full technical control. Model selection, seed, sampler, LoRA, ControlNet, provider choice. Deliberately "advanced" — not discoverable in Create mode.

**Critical:** There must be no accidental discovery of Lab mode. It requires a deliberate navigation gesture.

---

## Principle 3: Show Progress, Not Process

When generation is happening, the user sees:

```
Creating your YouTube banner...
Applying identity from Alex
Composing layout
Rendering...
─────────────────────────── 73%
Estimated: 12 seconds remaining
```

The user does NOT see:
- Which model is running
- Which node is executing
- Memory usage
- GPU utilization
- Temperature

This information exists in the application's Activity panel — accessible for those who want it, never surfaced to those who don't.

---

## Principle 4: Results Invite Next Steps

Every generated output is a **creative launch point**, not a terminus.

After any generation completes, the result panel shows:

```
┌─────────────────────────────────────────┐
│  [Generated Image]                      │
│                                         │
│  What's next?                           │
│  ○ Generate variations                  │
│  ○ Edit with a prompt                   │
│  ○ Convert to 3D model                  │
│  ○ Animate this                         │
│  ○ Save as character reference          │
│  ○ Export / Use in project              │
└─────────────────────────────────────────┘
```

The system suggests next steps based on context. If the user generated a portrait, "Save as character reference" is prominent. If they generated a product shot, "Convert to 3D model" is prominent.

---

## Principle 5: Assets Have Identity, Not Just Files

When a user saves something as an asset, they are creating an entity with:
- A name
- Visual identity (thumbnail + key references)
- A generation history
- Relationships to other assets
- A set of available actions

The asset sidebar does NOT look like a file browser. It looks like a **character sheet** or **product page**:

```
CHARACTER: Alex
─────────────────
[Face thumbnail]
Identity strength: ●●●●○

Uses: 14 images, 3 videos, 1 3D model
Last used: Today

[ Generate image ]  [ Create video ]
[ Open in 3D ]      [ Edit identity ]
```

---

## Principle 6: Cloud Actions Are Always Transparent

When any action will route to cloud execution, the UI shows a clear, non-alarming indicator:

```
🔒 Local           — default state
☁️ Cloud (you chose) — user chose cloud
⚡ Cloud (required)  — hardware can't run locally
```

Before any cloud generation starts:
```
This will be generated on cloud.
Your image will be sent to [provider name].

[ Generate anyway ]  [ Change settings ]
```

This is NEVER shown for purely local operations. Only appears when cloud will be used.

---

## Principle 7: Errors Are Creative, Not Technical

**Wrong:**
```
Error: CUDA out of memory. Tried to allocate 20 GiB. 
Total memory: 16 GiB; total allocated memory: 15.98 GiB.
Stack trace: ...
```

**Right:**
```
Your hardware can't run this locally.
This video model needs more memory than your Mac has available.

Options:
• Use cloud generation (fast, uses credits)
• Try a lighter model (slower, good quality)
• Reduce video length to 3 seconds
```

Every error must be accompanied by at least one actionable next step in plain creative language.

---

## Principle 8: Empty States Are Invitations

Empty states are not "no results found." They are the clearest expression of what the product can do.

**Project empty state:**
```
Your project is empty.

Start here:
→ Add your photo to create a character
→ Describe what you want to make
→ Browse templates to get started
```

**Character empty state:**
```
No characters yet.

Characters let you reuse your identity — or anyone's — across images, 3D, and video. Start by uploading 3–10 reference photos.

[ Create character ]
```

---

## Principle 9: Navigation Reflects Mental Models, Not Product Features

Users think in terms of:
- "My projects" — where their work lives
- "My assets" — their creative library
- "Create" — starting something new
- "What models can I use?" — capability exploration

They do NOT think in terms of:
- "Image generation endpoint"
- "Model registry"
- "Execution provider"
- "Job queue"

Navigation labels must match user language, not product architecture.

---

## Principle 10: The Interface Must Earn Its Space

**Every pixel of screen space is earned, not given.**

- Controls that aren't relevant to the current task should not be visible
- Secondary information should be hidden until requested
- Sidebars should collapse when the user is in a focused creation flow
- Modals should be rare — prefer inline, contextual interactions
- Never show two sidebars simultaneously in primary Create mode

The interface should feel like it disappears while you're creating and becomes richly informative when you step back to plan.

---

## UX Anti-Patterns to Actively Avoid

| Anti-Pattern | Why It Fails |
|---|---|
| Dashboard with stats and metrics on entry | We're not monitoring a system, we're making things |
| Model picker as primary choice | Models are infrastructure, not decisions |
| Progress bar with technical details | Users want creative reassurance, not system logs |
| Tab-heavy navigation (10+ tabs) | Implies feature sprawl, not a coherent product |
| Modal dialogs for settings | Breaks creative flow; prefer contextual inline panels |
| "Advanced" section that's always visible | Advanced must be opt-in, not a permanent presence |
| Form-heavy creation flow | Should feel conversational, not bureaucratic |
| Node graph for any primary task | Technical representation of creative intent is always wrong for primary UX |

---

## Motion and Interaction Principles

### Transitions Communicate State
- **Generating:** Subtle shimmer/breathing animation on the result area
- **Transitioning between modes:** Smooth spatial expand/collapse (never a page reload feeling)
- **Asset becoming 3D:** Camera rotation reveal animation communicates the modality shift
- **Cloud routing:** Brief pulse on the cloud indicator, then quiet

### Speed Expectations
- **UI response:** <100ms for any tap/click
- **Generation feedback:** Immediate visual response (<200ms) before generation starts
- **Progress:** First progress signal within 1 second of submitting a generation
- **Completion:** Result appears with a subtle reveal animation, not a jarring swap

### Hover States Provide Information
Hovering an asset shows a quick preview. Hovering a "next steps" option shows a visual preview of what that action would produce. Hover is information, not decoration.
