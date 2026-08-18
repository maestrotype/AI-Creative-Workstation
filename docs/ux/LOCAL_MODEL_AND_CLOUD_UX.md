# LOCAL MODEL UX & CLOUD EXECUTION UX
## AI Creative Workstation

---

## Part 1: Local Model Experience

### Design Philosophy

The local model experience should feel like a MacBook's storage settings — not like a package manager or a terminal. The user should be able to understand what they have, install what they need, and trust that things will work.

**The benchmark:** LM Studio does this well for LLMs. We must match that standard for image, video, and 3D models — and ideally surpass it.

---

### Hardware Detection (Silent, At Startup)

At first launch (and silently on subsequent launches), the application detects:

```
Detection targets:
├── OS: macOS / Windows / Linux
├── Architecture: arm64 (Apple Silicon) / x86_64
├── CPU: model, cores
├── GPU(s): model, VRAM (or unified memory)
├── RAM: total, available
├── Storage: available disk space
├── Inference engines available:
│   ├── MLX (if Apple Silicon + macOS)
│   ├── CUDA (if NVIDIA GPU present)
│   ├── Metal (if Apple Silicon or AMD)
│   ├── Vulkan (if compatible GPU)
│   └── CPU fallback (always)
└── Network: connected / disconnected
```

This generates a **Hardware Profile** used throughout the app for routing decisions.

---

### Hardware Capability Screen (Studio → Hardware)

```
┌────────────────────────────────────────────────────────────┐
│  YOUR SYSTEM                                               │
│  ──────────────────────────────────────────────────────── │
│  MacBook Pro M4 Max                                        │
│  64 GB Unified Memory                                      │
│  macOS 15.3 | Apple Silicon                                │
│                                                            │
│  CAPABILITIES                                              │
│  ──────────────────────────────────────────────────────── │
│                                                            │
│  Images              ●●●●● Excellent                       │
│  "Full quality image generation on your Mac"               │
│                                                            │
│  3D Generation       ●●●●○ Very Good                       │
│  "Full 3D model generation, PBR texturing"                 │
│                                                            │
│  Short Video (< 5s)  ●●●○○ Good                            │
│  "Video generation runs locally, takes 15–45 min"          │
│                                                            │
│  Long Video (> 5s)   ●●○○○ Moderate                        │
│  "Cloud recommended for faster results"                    │
│                                                            │
│  LLM (Script, Planning)  ●●●●● Excellent                   │
│  "Fast local language model for scripts and planning"      │
│                                                            │
│  Voice Synthesis     ●●●●○ Very Good                       │
│  "High-quality local TTS and voice cloning"                │
│                                                            │
│  ──────────────────────────────────────────────────────── │
│  Storage available: 348 GB                                 │
│  Model storage used: 24.3 GB                               │
│                                                            │
│  [ Manage storage ]  [ Update capability scan ]            │
└────────────────────────────────────────────────────────────┘
```

---

### Model Library (Studio → Models)

**Design principle:** Never call models by their technical names in primary context. Describe what they do. Show technical name in detail view.

```
┌────────────────────────────────────────────────────────────┐
│  MODEL LIBRARY                         [ Search... ]       │
│  ──────────────────────────────────────────────────────── │
│                                                            │
│  INSTALLED (4 models, 24.3 GB)                             │
│                                                            │
│  ╔══════════════════════════════════════════════════════╗  │
│  ║  Image Generation                                    ║  │
│  ║  FLUX — Fast                                         ║  │
│  ║  Best for portraits, products, scenes                ║  │
│  ║  Speed: ●●●●●  Quality: ●●●●○  Size: 8.1 GB          ║  │
│  ║  Installed ✓                    [Configure] [Remove]  ║  │
│  ╚══════════════════════════════════════════════════════╝  │
│                                                            │
│  ╔══════════════════════════════════════════════════════╗  │
│  ║  Image Generation                                    ║  │
│  ║  FLUX — Quality                                      ║  │
│  ║  Best for editorial, detailed compositions           ║  │
│  ║  Speed: ●●●○○  Quality: ●●●●●  Size: 16.2 GB         ║  │
│  ║  Installed ✓                    [Configure] [Remove]  ║  │
│  ╚══════════════════════════════════════════════════════╝  │
│                                                            │
│  ──────────────────────────────────────────────────────── │
│  AVAILABLE TO INSTALL                                      │
│                                                            │
│  ╔══════════════════════════════════════════════════════╗  │
│  ║  Video Generation                                    ║  │
│  ║  Wan — Short Video                                   ║  │
│  ║  Generate 3–5 second video clips from images         ║  │
│  ║  Speed: ●●○○○  Quality: ●●●●○  Size: 18.4 GB         ║  │
│  ║  ✓ Compatible with your Mac                          ║  │
│  ║  Est. time: ~20 min per 5s clip on your hardware     ║  │
│  ║                                        [ Install ]   ║  │
│  ╚══════════════════════════════════════════════════════╝  │
│                                                            │
│  ╔══════════════════════════════════════════════════════╗  │
│  ║  3D Generation                                       ║  │
│  ║  3D Creator — Detailed                               ║  │
│  ║  Generate full 3D models with PBR textures           ║  │
│  ║  Speed: ●●●○○  Quality: ●●●●●  Size: 12.8 GB         ║  │
│  ║  ✓ Compatible with your Mac                          ║  │
│  ║                                        [ Install ]   ║  │
│  ╚══════════════════════════════════════════════════════╝  │
│                                                            │
│  ╔══════════════════════════════════════════════════════╗  │
│  ║  Video Generation                                    ║  │
│  ║  Wan — Long Video (14B)                              ║  │
│  ║  High-quality longer video generation                ║  │
│  ║  Speed: ●○○○○  Quality: ●●●●●  Size: 28.4 GB         ║  │
│  ║  ⚠ Your Mac may be slow (30–90 min per clip)         ║  │
│  ║  Cloud recommended for this model                    ║  │
│  ║                            [ Install anyway ] [Cloud]║  │
│  ╚══════════════════════════════════════════════════════╝  │
└────────────────────────────────────────────────────────────┘
```

---

### Model Install Flow

```
User taps [ Install ] on "3D Creator — Detailed"
         ↓
Install dialog:
┌──────────────────────────────────────────────┐
│  Install 3D Creator — Detailed?              │
│  ────────────────────────────────────────    │
│  Size: 12.8 GB                               │
│  Location: ~/Canvas/models/                  │
│  Available: 348 GB ✓                         │
│                                              │
│  License: Open source, commercial use OK ✓   │
│                                              │
│  [ Install ]  [ Cancel ]                     │
└──────────────────────────────────────────────┘
         ↓
Download progress:
┌──────────────────────────────────────────────┐
│  Installing 3D Creator — Detailed            │
│  ────────────────────────────────────────    │
│  Downloading... ████████████░░░░░░░░  62%    │
│  7.9 GB / 12.8 GB                            │
│  Speed: 85 MB/s   ETA: 58 seconds            │
│                                              │
│  [ Cancel download ]                         │
└──────────────────────────────────────────────┘
         ↓
Complete:
┌──────────────────────────────────────────────┐
│  ✓ 3D Creator installed                      │
│                                              │
│  Ready to use for 3D generation.             │
│                                              │
│  [ Create 3D model now ]  [ Done ]           │
└──────────────────────────────────────────────┘
```

---

## Part 2: Cloud Execution UX

### Design Philosophy

Cloud execution must be:
1. **Transparent:** The user always knows when cloud is active
2. **Consensual:** Cloud upload requires explicit awareness, not buried in settings
3. **Optional:** Cloud should enhance, never gate
4. **Honest about cost:** Credit usage shown before generation

---

### Cloud Indicator System

The cloud indicator appears in the generation UI whenever cloud is active or being considered:

```
🔒 Running locally        ← default, no indicator needed
⚡ Using cloud (faster)   ← user chose cloud for speed
☁️ Cloud required          ← hardware limitation, cloud is necessary
🔄 Cloud fallback          ← local failed, automatically using cloud
```

The indicator is **small and persistent**, not alarming. It lives in the corner of the generation status area.

---

### Cloud Consent Flow (First Cloud Use)

```
First time a cloud generation is triggered:

┌──────────────────────────────────────────────────────────┐
│  This generation will use cloud.                         │
│  ──────────────────────────────────────────────────────  │
│  Your image will be sent to [Provider] for processing.   │
│  It is deleted from their servers after generation.      │
│  We do not store your images on our servers.             │
│                                                          │
│  Provider: [Provider Name]   Privacy policy ↗            │
│  Cost: ~0.3 credits ($0.006)                             │
│                                                          │
│  Remember this choice:                                   │
│  ○ Ask me each time                                      │
│  ● Always allow cloud when recommended                   │
│  ○ Never use cloud without explicit request              │
│                                                          │
│  [ Generate on cloud ]  [ Cancel ]                       │
└──────────────────────────────────────────────────────────┘
```

After this one-time consent:
- If "always allow": cloud generations proceed without further dialogs
- If "ask each time": a briefer notification appears for each cloud job
- If "never without request": only shows when user explicitly selects cloud

---

### Cloud Provider Configuration (Studio → Providers → Cloud)

```
┌──────────────────────────────────────────────────────────┐
│  CLOUD PROVIDERS                                         │
│  ──────────────────────────────────────────────────────  │
│                                                          │
│  Canvas Cloud Credits                                    │
│  Balance: 48.5 credits (~$0.97)                          │
│  Plan: Creator ($29/mo — 200 credits/mo)  [Manage]       │
│                                                          │
│  ──────────────────────────────────────────────────────  │
│  CONNECTED PROVIDERS                                     │
│                                                          │
│  ╔════════════════════════════════════════════════════╗  │
│  ║  [fal.ai]                          Connected ✓     ║  │
│  ║  Used for: Images, Video                           ║  │
│  ║  Balance: $12.40                    [Disconnect]   ║  │
│  ╚════════════════════════════════════════════════════╝  │
│                                                          │
│  ╔════════════════════════════════════════════════════╗  │
│  ║  [Replicate]                       Not connected   ║  │
│  ║  Pay-as-you-go GPU cloud           [Connect]       ║  │
│  ╚════════════════════════════════════════════════════╝  │
│                                                          │
│  ──────────────────────────────────────────────────────  │
│  PRIVACY SETTINGS                                        │
│                                                          │
│  Photos sent to cloud:  ● Only with explicit consent     │
│  Prompts sent to cloud: ● Always (no personal data)      │
│  Generated images:      ● Deleted after download         │
│                                                          │
│  [ Privacy policy ]  [ Data processing agreement ]       │
└──────────────────────────────────────────────────────────┘
```

---

### Cloud Generation Status

When a cloud generation is running:

```
┌──────────────────────────────────────────────────────────┐
│  Creating your video clip...                             │
│  ──────────────────────────────────────────────────────  │
│                                                          │
│  ████████████████░░░░░░░░  65%                           │
│  Rendering frames: 56 / 86                               │
│  Estimated: 2 min 15 sec                                 │
│                                                          │
│  ☁️ Generating on cloud · fal.ai                         │
│  Cost: ~1.2 credits                                      │
│                                                          │
│  [ Cancel ]  [ Run in background ]                       │
└──────────────────────────────────────────────────────────┘
```

---

### Smart Routing UX

When the system decides to route to cloud, it briefly explains why:

```
Sending to cloud:
"This video model needs 28 GB memory. 
Your Mac has 64 GB available, but this model 
performs better on dedicated GPU."

[ Generate on cloud ]  [ Try locally (slower) ]
```

This explanation appears once per routing decision type, then is collapsed to just the cloud indicator.

---

### Cost Transparency

Credit costs are always visible before generation:

| Generation Type | Estimated Credits |
|---|---|
| Image (1024×1024, local) | 0 credits |
| Image (1024×1024, cloud) | ~0.2–0.5 credits |
| Video (5s, cloud) | ~1.5–3 credits |
| 3D model (cloud) | ~2–5 credits |
| LLM script (local) | 0 credits |

Credit pricing is shown as both credits and approximate dollar value at all times.

---

### "Always Local" Mode

For users who never want to use cloud:

```
Settings → Privacy → Cloud execution: OFF

When this is enabled:
- Only locally runnable capabilities are offered
- Cloud-only capabilities are grayed out with explanation
- No data ever leaves the device
- App works fully offline

"You're in local-only mode. Some capabilities 
that require cloud are not available."
```

This must be a first-class mode, not a hidden setting. Privacy-conscious users need to trust this completely.
