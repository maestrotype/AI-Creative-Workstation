# Video & Voice Studio — Living Plan

> **Status:** Working plan, not a freeze.  
> **Updated:** 1 September 2026  
> **Owners:** Product + sidecar (Video page, Studio catalogs, Assets TTS)  
> **How to use:** Correct this file when we learn what local hardware can actually ship, or when goals shift. Do not treat older roadmap slides as more true than this page if they conflict with implemented behavior.

Studio in the app is the **engine registry** (image / video / 3D / voice). The **job** of making a YouTube-shaped file lives on **Video**. Voice sample and prompt TTS live in **Assets**. This document is the plan for those three surfaces together — the “video studio” users mean when they want montage plus local voiceover.

Related vision (later, not current UI): [AI_DIRECTOR.md](../ux/AI_DIRECTOR.md), [ROADMAP.md](../roadmap/ROADMAP.md) V2.

**Active tracks (must land in UI):**
- [VOICE_PRONUNCIATION_PLAN.md](VOICE_PRONUNCIATION_PLAN.md) — Russian stress, lexicon, prompt-based fix (`feat/voice-pronunciation`)
- [VIDEO_VOICEOVER_PLAN.md](VIDEO_VOICEOVER_PLAN.md) — upload → analyze → script → TTS → timeline (`feat/video-voiceover`)

---

## Intent (stable)

We want creators to produce **watchable** local video without ComfyUI graphs:

1. **Picture quality** from the active **image** engine (not from a missing motion model).
2. **Assembly** that is honest ffmpeg (slideshow or cleaned screencast), not fake “AI film.”
3. **Voiceover from a prompt**, cloned from a local speaker sample (XTTS), mixed on a timeline.
4. **Motion models** (LTX, Wan) only when a real sidecar path exists — until then they stay “pipeline later” in Studio.

Goals will move. The rule that should not: **never label a slideshow or crop as generative video.**

---

## What ships today (ground truth)

| Surface | Role | What actually runs |
|---------|------|--------------------|
| Studio → Image | Active still engine | FLUX / SDXL via sidecar `/api/generate/image` |
| Studio → Video | Catalog only | LTX Video, Wan 2.1 T2V — **not downloadable**, no infer route |
| Studio → Voice | Status | Sample on/off, Coqui installed or not |
| Video → From scratch | Storyboard + MP4 + timeline | Template beats → stills → Ken Burns assemble → same TTS/mix card |
| Video → From a recording | Clean + mix | ffmpeg crop/trim; `POST /api/video/timeline` |
| Assets | Voice + library | 10 s `speaker.wav`; `POST /api/audio/tts`; optional mix-in |

**From scratch** shows the prompt timeline after assemble (draft `voiceover:` lines at each scene start). Edit, then Apply. Needs a voice sample in Assets and Coqui in the sidecar.

**Screencast “clean” is not inpaint.** Prompt keywords adjust crop/end-trim only (`sidecar/api/video.py`).

**TTS is optional.** Default sidecar install does not include Coqui. User: `pip3 install TTS`. First run downloads `tts_models/multilingual/multi-dataset/xtts_v2`. No stock voice without `~/Documents/Canvas/Voice/speaker.wav`.

Outputs: `~/Documents/Canvas/Generated/Video/`, TTS WAVs under `Generated/Audio/`.

---

## Quality path we endorse now

For a **listing / storefront demo** (e.g. Angular shop):

1. Studio → Image: strongest installed still model as **active**.
2. Record the real UI in OBS (or macOS) at 1920×1080. This is the picture of the product — not generated motion.
3. Video → From a recording → clean prompt (browser chrome, stop-recording UI).
4. Assets: 10 s voice sample; `pip3 install TTS` if needed.
5. Timeline prompt, timestamps + local clone:

```
at 0:00 voiceover: Interactive 3D on the product page
на 0:12 озвучка: Поверните модель — это GLB в магазине
at 0:40 add captured audio
```

Lines matching voiceover / озвучка / tts / speak go through XTTS. Other lines overlay a library clip.

**From scratch** is for cinematic **stills montage** (thumbnails, teaser), not for proving a web app. Scene prompts are templates, not an LLM director.

---

## Near-term corrections (this track)

Adjust as we ship. Suggested order, not a contract:

| ID | Change | Why |
|----|--------|-----|
| V-TTS-1 | After From scratch assemble, same timeline/TTS step without leaving Video | **Shipped 2026-08-29** — `VideoTimelineCard` on From scratch; draft prompt from scene starts |
| V-TTS-2 | Document / optionally vendor Coqui in sidecar setup | Partial — UI hint + Assets copy; still `pip3 install TTS` |
| V-EDIT-1 | Ken Burns or crossfade on stills (ffmpeg) | **Shipped 2026-08-29** — slow zoompan per still in `assemble` |
| V-STORY-1 | Optional LLM storyboard later | Templates are a ceiling for “cool video” — see [VIDEO_VOICEOVER_PLAN.md](VIDEO_VOICEOVER_PLAN.md) |
| V-MOTION-1 | First real motion model (Wan 1.3B or LTX) **or** keep catalog disabled | No half-wired Studio download |
| V-CLEAN-1 | Smarter screencast crop only if we have evidence; no fake inpaint | Hardware cost vs benefit |
| V-PRON-* | Russian pronunciation pipeline + Assets/Director UI | [VOICE_PRONUNCIATION_PLAN.md](VOICE_PRONUNCIATION_PLAN.md) — **in progress** on `feat/voice-pronunciation` |
| V-VO-* | From video: analyze → script → TTS → timeline | [VIDEO_VOICEOVER_PLAN.md](VIDEO_VOICEOVER_PLAN.md) — **planned** on `feat/video-voiceover` |

Do **not** implement a full NLE (DaVinci). We generate and assemble; we do not become an editor.

---

## Later (vision, keep aligned with ROADMAP V2)

- Image → short clip (local small Wan / LTX when latency is acceptable).
- Cloud-routed longer clips with explicit consent ([LOCAL_MODEL_AND_CLOUD_UX.md](../ux/LOCAL_MODEL_AND_CLOUD_UX.md)).
- AI Director: script → voice → scenes → package ([AI_DIRECTOR.md](../ux/AI_DIRECTOR.md)).
- Character-consistent shots — research, not a current promise.

If local 5 s clip stays 15–45 min on M4 Max, **iteration stays on stills + recording**, and motion stays export-only. Update this paragraph when we measure a real sidecar job.

---

## Code map

| Path | Notes |
|------|--------|
| `src/renderer/src/features/video/` | Video page, idea + recording panels |
| `src/renderer/src/features/video/model/planYoutubeVideo.ts` | Beat templates |
| `src/renderer/src/features/studio/model/engineCatalog.ts` | Families; video engines `downloadable: false` |
| `src/renderer/src/features/assets/` | Voice sample + TTS UI |
| `sidecar/api/video.py` | assemble, clean-screencast |
| `sidecar/api/audio.py` | voice, tts, timeline parse/mix |

---

## Revision log

| Date | Note |
|------|------|
| 2026-08-29 | First pass: implemented ffmpeg + XTTS timeline vs Studio motion placeholders. Living doc. |
| 2026-08-29 | V-TTS-1 + V-EDIT-1: From-scratch timeline card; Ken Burns zoom on stills. |
| 2026-09-01 | Linked VOICE_PRONUNCIATION_PLAN + VIDEO_VOICEOVER_PLAN; UI delivery required for both tracks. |
