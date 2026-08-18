# WEBSITE EXPERIENCE
## AI Creative Workstation — Marketing Website Concept

---

## The Strategic Objective

The website is not a marketing brochure. It is a demonstration.

The moment a visitor arrives, they should understand — viscerally, not intellectually — what it feels like to create with this product. Not through screenshots. Not through feature bullets. Through an experience that makes them feel "I want to do this."

The website must demonstrate the core product thesis:

> **One idea → Image → 3D → Video → YouTube**

---

## Design Language: Anti-Template

We are explicitly avoiding:

- Hero with large screenshot + feature cards below
- Testimonial section with profile photos
- Pricing table with checkbox-heavy plan comparison
- FAQ accordion at the bottom
- "Trusted by X companies" logo row

We are building toward:

- A cinematic, interactive 3D experience that responds to user input
- Scroll-driven storytelling that mirrors the product's creative workflow
- Micro-interactions that feel like product previews
- A website that creators screenshot and share

**Reference inspiration principles** (not designs to copy):
- **Vercel / Linear:** Extreme craft in dark-theme developer product sites
- **Apple:** Every element earns its place; performance as aesthetic
- **Awwwards SOTD winners:** Interactive 3D + cinematic transitions
- **Teenage Engineering:** Tactile, editorial, premium product feel
- **Arc browser:** Software as narrative experience

---

## Website Architecture

```
/ (Home)
├── Hero                    — Interactive 3D creative scene
├── Core Thesis             — "One idea → full production"  
├── Workflow Demo           — Scroll-driven creation story
├── Capability Showcase     — What you can make (motion examples)
├── Asset Persistence       — The Asset Graph explained visually
├── Privacy Promise         — Local-first, explained beautifully
├── Download / Waitlist     — Primary CTA
└── Footer

/product                    — Detailed product features
/pricing                    — Simple tier comparison
/blog                       — Made-with examples, technical writing
/docs                       — Documentation (separate)
```

---

## Hero: The Interactive Creative Scene

### Concept

The hero is a full-viewport interactive 3D scene. A character stands in a cinematic environment. The scene is alive — subtle ambient motion, responsive lighting, particle dust.

The visitor can interact with three controls:

```
CHARACTER    ENVIRONMENT    STYLE

[     Marcus  ↓    ]    [  Tokyo Night  ↓  ]    [  Cinematic  ↓  ]
```

Changing each control changes the 3D scene in real-time. The transitions are smooth, cinematic.

**The key CTA in the hero:**

```
[   Build this scene with your photo   ]
```

When clicked: a minimal drag-and-drop appears. The user can upload their own photo. A pre-generated set of results is shown (the real pipeline runs server-side or from a pre-baked state machine — **not live generation**). But the effect is that "your face appeared in the scene."

### Technical Approach for Hero

The hero is **not live AI generation**. That would be too slow and too expensive to run for every website visitor.

Instead, it uses:
- A pre-generated set of scene states (maybe 3 characters × 4 environments × 3 styles = 36 combinations)
- WebGL/Three.js scene that **transitions between pre-baked results** with cinematic animation
- The "upload your photo" flow shows pre-selected result examples with a brief delay (simulating generation)
- Real waitlist capture with the photo upload for early access

This is not deception — it's demonstration. The website communicates "this is what the product produces" while the product is in development.

### Hero WebGL Scene Details

```
Scene components:
├── Character mesh (GLTF, ~30k polygons, 2K textures)
│   - Pre-built models for each character option
│   - Facial swap overlay when user uploads photo
│
├── Environment (HDRI + mesh background)
│   - Tokyo Night: neon reflections, wet street
│   - Studio: dark, dramatic, single light
│   - Forest: natural, golden hour
│   - City Day: bright, urban
│
├── Cinematic camera
│   - Subtle auto-orbit at 0.1 degrees/second
│   - Responsive to mouse position (parallax)
│   - Smooth 1.5s transition on scene change
│
├── Ambient particles
│   - Floating dust / rain / cherry blossoms depending on environment
│   - GPU particle system, ~5000 particles
│
└── Lighting system
    - Real-time directional + environment lighting
    - Dramatic volumetric-style light shafts (screen-space)
```

### Hero Copy

```
CREATE. DON'T CONFIGURE.

The AI creative workstation that runs
on your hardware.

Images. 3D. Video. Characters. Productions.
Without learning ComfyUI.

────────────────────────────────────────────

Change the scene:

CHARACTER ▾        ENVIRONMENT ▾        STYLE ▾
  Marcus              Tokyo Night          Cinematic

[  Build this with your photo  ]

Works on Mac. Coming to Windows.
Your photos never leave your device.
```

---

## Section 2: The Workflow Story

### Scroll-Driven Narrative

As the user scrolls, the story unfolds as a production timeline:

```
SCROLL POSITION 0%: "You have an idea."
   Text fades in over a simple input prompt

SCROLL POSITION 15%: "Type what you want."
   The input animates — text types itself
   "A cinematic portrait for my YouTube channel"
   A photo drops in

SCROLL POSITION 30%: "It creates."
   A generating animation plays
   A portrait appears with a reveal animation

SCROLL POSITION 45%: "Then it creates more."
   The portrait transforms — 3D rotation begins
   The flat image becomes a 3D model, rotating slowly

SCROLL POSITION 60%: "Then it moves."
   The 3D model becomes a video clip
   2 seconds of character walking through a scene

SCROLL POSITION 75%: "Your creative library."
   Multiple characters, products, styles appear
   Asset cards with "used in 12 videos" counters

SCROLL POSITION 90%: "One tool. Everything."
   Complete YouTube project view appears briefly
   Script + 6 scenes + thumbnail + shorts

SCROLL POSITION 100%: "Download Canvas."
   CTA appears
```

**Technical implementation:**
- CSS scroll-driven animations (Scroll Animation API)
- Intersection Observer for media asset triggers
- Video elements play on scroll reach, pause on scroll away
- All media assets pre-baked, no runtime generation

---

## Section 3: Capability Cards

A horizontally scrollable (or grid) section showing real outputs:

```
┌──────────────────────────────────────────────────────────────────┐
│  What you can make with Canvas                                   │
│                                                                  │
│  [Portrait Video]  [YouTube Banner]  [3D Character]             │
│  [Product Scene]   [Short Clip]      [Script]                    │
│  [Voiceover]       [Thumbnail Set]   [Complete Video]            │
│                                                                  │
│  All real outputs from Canvas                                    │
│  Tap to see how it was made                                      │
└──────────────────────────────────────────────────────────────────┘
```

Each card, when clicked, shows a mini case study:
- The input (photo + prompt)
- The output
- The workflow (steps taken)
- Time to complete

---

## Section 4: The Privacy Promise

This section is critical for trust and differentiation. It should feel as premium as the 3D section:

```
YOUR CREATIVE WORK
STAYS ON YOUR MACHINE.

[Animated visualization: laptop with files inside]
[Arrow attempting to leave → blocked by shield]
[Label: "By default, nothing leaves your device"]

Photo of your client?  Stays here.
A face you've trained?  Stays here.
Your entire project?    Stays here.

Cloud is always your choice.
We show you exactly when it's used
and exactly what's sent.

We don't store your work.
We don't train on your generations.
Your files, your hardware, your control.
```

**Design:** Dark section with a tactile lock icon that animates — opens, data tries to escape, closes. Premium illustration treatment.

---

## Section 5: Hardware Intelligence

```
YOUR MAC IS CAPABLE.

[Animated hardware visualization]
MacBook Pro M4 Max ←→ CANVAS

Image generation:    ●●●●● Excellent
3D generation:       ●●●●○ Very Good
Video (short):       ●●●○○ Good
LLM (script/plan):   ●●●●● Excellent

We detect your hardware on first launch.
You choose what runs where.
Everything else is automatic.

Works on:
[Apple Silicon]  [Windows NVIDIA]  [Cloud]
```

---

## Section 6: Download / Early Access

The CTA section is clean, bold, confident:

```
CREATE WITHOUT CONFIGURING.

Canvas for Mac — Early Access

[  Download for macOS  ]    [  Join waitlist  ]

MacBook Pro M4 / M3 / M2 and later
64 GB unified memory recommended for video
16 GB minimum for images

Free during Early Access.
Privacy-first. Your files stay local.
```

---

## Website Technical Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Framework | Next.js (App Router) | SSG for performance; React ecosystem for interactive components |
| 3D hero | Three.js + React Three Fiber | Mature ecosystem; good for pre-baked scene transitions |
| Scroll animations | CSS Scroll-Driven Animations + GSAP | Native CSS for simple cases; GSAP for complex timeline animations |
| Video elements | HTML5 video (WebM/AV1) | Best compression; hardware decoded |
| Animation | Framer Motion | React-native; good for UI elements; avoid for 3D |
| Hosting | Vercel | Edge network; instant deploys; SSG performance |

### Performance Requirements

```
Core Web Vitals targets:
  LCP: < 2.5s (Largest Contentful Paint)
  FID: < 100ms (First Input Delay)
  CLS: < 0.1 (Cumulative Layout Shift)

3D hero: loads progressively
  - Static screenshot first (< 1s)
  - WASM + WebGL loads in background
  - Hero activates when ready (~2-3s)
  - Graceful fallback for WebGL-unsupported
  
Video assets: lazy loaded, compressed
  - WebM AV1 for Chrome/Edge
  - HEVC for Safari
  - H.264 fallback
  - autoplay=true muted=true (scroll-triggered)
```

### Mobile Experience

The full 3D interactive hero is desktop-only. Mobile experience:
- Pre-rendered video loop of the 3D scene (no interaction)
- Swipeable output gallery (capability cards)
- Same workflow narrative, optimized for vertical scroll
- CTA adjusted for "Notify me" (App is desktop-first)
