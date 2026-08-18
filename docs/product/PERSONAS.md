# PERSONAS & JOBS-TO-BE-DONE
## AI Creative Workstation

---

## Target User Philosophy

We are NOT targeting:
- AI researchers or engineers (ComfyUI serves them)
- Complete beginners with zero creative intent (Canva serves them)
- Enterprise procurement buyers (Adobe serves them)

We ARE targeting: **Skilled creators who produce real content but have been denied access to serious AI generation tools because every option forces either a cloud/privacy compromise or a technical complexity cliff.**

---

## Persona 1: The Independent Content Creator

**Name:** Marcus  
**Age:** 28  
**Context:** Solo YouTube creator with 180k subscribers covering tech and productivity

### Background
Marcus runs a one-person media operation. He films, edits, writes scripts, designs thumbnails, and manages everything himself. He spends 2–3 hours per week just on visual assets (thumbnails, banners, channel art). He has a MacBook Pro M4 Max 64GB — his most expensive work tool.

### Current Tools
- Canva (thumbnails — but hitting creative ceiling)
- ChatGPT (scripts and captions)
- Adobe Premiere (editing)
- Midjourney (occasional image generation — frustrated by Discord, no local option)
- Manually stitching between all tools

### Pain Points
- Every thumbnail starts from zero — no consistent visual identity across videos
- Midjourney loses his "style" between sessions — has to rebuild prompts
- Going from a generated image to a YouTube thumbnail requires multiple tool switches
- Can't generate video content locally — either too expensive (Runway) or too technical (ComfyUI Wan integration)
- Worried about client photos going to cloud services (NDA work)
- His M4 Max "just sits there" while he pays $30/month for cloud generation

### Jobs to Be Done
1. **When** I need a thumbnail for a new video, **I want to** generate multiple on-brand variants quickly **so I can** spend less time on production and more time on content
2. **When** I have an established visual style, **I want to** reuse it across every video **so my** channel has a coherent identity
3. **When** I have a client photo, **I want to** process it locally **so I** never violate NDA
4. **When** I'm on a flight without internet, **I want to** still generate content **so I** don't lose production time

### Quote
> "I have the hardware. I just don't have a tool that lets me actually use it for creative work without a PhD in AI."

---

## Persona 2: The Indie Studio / Solopreneur

**Name:** Priya  
**Age:** 35  
**Context:** Freelance brand consultant + content producer serving 8–12 clients per year

### Background
Priya produces branded content packages for clients — photography direction, visual identity, social media assets, and occasionally short video. She has an NVIDIA 4090 workstation and wants to use it. She's technically savvy but time-constrained. She's experimented with ComfyUI and hit the complexity wall.

### Current Tools
- Adobe Photoshop/Illustrator (design)
- CapCut (video editing)
- Midjourney (image generation for mood boards)
- Tripo3D (occasional 3D asset exploration)
- Notion (project management)

### Pain Points
- Every client requires a different visual identity — she rebuilds style guides from scratch
- ComfyUI's node graph takes 2 hours to set up a workflow she'll only use once
- Can't consistently generate on-brand visuals — client logos and style references don't carry forward
- 3D → video workflow requires switching between Tripo → some video tool → editing — no continuity
- Licensing risk: unclear if generated assets are commercial-safe when using various cloud tools

### Jobs to Be Done
1. **When** onboarding a new client, **I want to** define their visual identity once **so I can** generate on-brand assets throughout the engagement
2. **When** I need to show a client a concept for a product shoot, **I want to** visualize it in 3D quickly **so I can** iterate without scheduling a real shoot
3. **When** generating client content, **I want to** be confident about licensing and data handling **so I** can protect client relationships
4. **When** I've built up an asset library for a client, **I want to** reuse and extend it **so I** can deliver faster on repeat work

### Quote
> "I can see the workflows I want. I just can't assemble them without becoming a ComfyUI expert."

---

## Persona 3: The Indie Game / Animation Developer

**Name:** Sam  
**Age:** 24  
**Context:** Solo indie game developer making a 2.5D narrative RPG

### Background
Sam is a developer with strong artistic vision but limited drawing/3D modeling skill. He knows what he wants his game to look like — he just can't produce it at the quality level he's imagining. He has been combining Blender, MidJourney, and Meshy in a fragile manual pipeline.

### Current Tools
- Blender (3D — basic skill level)
- Midjourney (concept art)
- Meshy (quick 3D assets from images)
- Unity (game engine)

### Pain Points
- Every character model requires rebuilding from scratch in each tool — no shared identity
- Image → 3D pipeline is lossy and inconsistent — same character looks different every time
- Animation workflow (image → 3D → rig → animation) is completely manual and fragile
- Running 4 separate tools simultaneously is a workflow nightmare
- Wants to generate short cinematic trailers for itch.io/Steam pages — no affordable path

### Jobs to Be Done
1. **When** I've designed a character in 2D, **I want to** consistently generate their 3D representation **so I can** use them throughout the game
2. **When** I need a new environment, **I want to** generate concept → 3D preview → game asset **so I** can prototype quickly without hiring artists
3. **When** I'm marketing my game, **I want to** create a cinematic trailer **so I** can compete with bigger studios on presentation
4. **When** I'm building my game world, **I want to** maintain asset consistency **so** the game feels coherent

### Quote
> "The gap between what I can imagine and what I can produce is exactly where AI should live. But every tool makes me the connection layer."

---

## Persona 4: The Aspiring Creator (Growth Persona)

**Name:** Yuki  
**Age:** 21  
**Context:** University student starting a YouTube channel; has MacBook Pro M3 16GB

### Background
Yuki is ambitious and creative. She's just starting out. She's been using Canva and CapCut, but wants professional results. She doesn't want to spend money on cloud generation indefinitely.

### Pain Points
- Canva's creative ceiling is already visible
- AI tools feel intimidating — doesn't know where to start
- Limited budget for cloud services
- Her MacBook "should be able to do more"

### Jobs to Be Done
1. **When** I have an idea, **I want to** produce something that looks professional **so I** can build credibility faster
2. **When** I'm experimenting, **I want to** try things quickly **so I** can discover what works without investment

### Note
This persona is the **Level 1 (Create)** user. The product must work for her in Create mode. She will grow into Project and Lab modes as her skills develop. She is a future Persona 1 or 2.

---

## Shared Jobs-to-Be-Done (All Personas)

| Job | Frequency | Urgency | Current Pain |
|-----|-----------|---------|-------------|
| Generate on-brand images quickly | Daily/Weekly | High | Multiple tool switches, no style memory |
| Reuse a character/style across outputs | Per project | High | Rebuild from zero each time |
| Move from image → 3D → video | Per project | High | Manual pipeline across 4+ tools |
| Run locally without cloud dependency | Always | High | Either technical (ComfyUI) or forced cloud |
| Create thumbnail/banner variants | Weekly | Medium | Canva ceiling or Midjourney price |
| Produce short video content | Monthly | High | Runway cost or Wan technical complexity |
| Manage creative assets in a project | Always | Medium | Scattered files across tools |
| Maintain brand/style consistency | Per client | High | No tool supports this cross-modally |

---

## What Users Are NOT Asking For

These are things users would appreciate but will not make or break adoption:

- Perfect face reconstruction from a single photo
- Photorealistic render of a specific person's voice
- Real-time video generation
- Fully automated "publish to YouTube" pipeline
- Plugin marketplace at launch

These are things that would actively harm adoption:

- Complex setup wizard
- Mandatory account creation to start
- "Beta" quality that doesn't actually generate
- Model download of 20+ GB before first use
- Technical jargon in any primary interface
