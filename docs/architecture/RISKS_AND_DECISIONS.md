# RISKS & TOP DECISIONS
## AI Creative Workstation — Risk Register and Decision Record

---

## Top 10 Product Decisions

### PD-1: Start Mac-Only for MVP

**Decision:** MVP is macOS (Apple Silicon) only. Windows support in V1.

**Options:**
1. Mac + Windows from day one
2. Mac only for MVP, Windows in V1 (chosen)
3. Windows only (where gaming/NVIDIA audience is)

**Chosen:** Option 2

**Why:** Apple Silicon (M3/M4) is the best current hardware for local AI creative work — unified memory, MLX framework, predictable hardware profile. A well-defined target produces a much better product than a broad target with a bad experience. Every platform doubles the QA matrix for inference engines.

**Trade-off:** Excludes a large Windows creator audience in MVP. Mitigated by waitlist for Windows.

**Future escape path:** V1 adds Windows CUDA support using the same capability abstraction. The provider architecture is platform-agnostic.

---

### PD-2: No Video in MVP

**Decision:** Video generation is not in MVP.

**Options:**
1. Include video (full cross-modal from day one)
2. Include video cloud-only
3. Exclude video from MVP (chosen)

**Chosen:** Option 3

**Why:** Local video generation on M4 Max takes 15–45 minutes for 5 seconds of output. This is not a viable creative iteration speed. Cloud video is expensive ($1–3 per clip). Including video in MVP would require either: (a) slow, frustrating UX or (b) high cloud costs that make the free tier unsustainable. The creative asset persistence thesis is provable without video.

**Trade-off:** MVP is not the full "image → 3D → video" vision. Early adopters see a narrower product.

**Future escape path:** V1 adds video when Wan 1.3B performance on Apple Silicon improves (projected: 5–8 minutes for 5s clip by late 2026, acceptable for non-iterative generation).

---

### PD-3: No Account Required for First Use

**Decision:** Users can generate without creating an account.

**Options:**
1. Required account before any generation
2. No account required for local generation; optional for cloud (chosen)
3. No account required at all

**Chosen:** Option 2

**Why:** Mandatory accounts at entry are the primary friction that kills creative tool adoption. The product's value is immediately demonstrable. Making a user sign up before they've seen a result is asking for trust before demonstrating value. Local generation requires no account. Cloud requires credentials for billing.

**Trade-off:** Anonymous users harder to convert; harder to send model update notifications.

**Future escape path:** In-app "create account" flow triggered when user tries to share, sync, or use cloud.

---

### PD-4: Capability-Based Model Abstraction (Not Model-Centric)

**Decision:** The application exposes capabilities, not model names, in primary UX.

**Why:** The AI model landscape changes every 3–6 months. If our UX refers to specific models, the product breaks every time the landscape shifts. Capability abstraction allows us to swap models without UX changes.

**Trade-off:** Advanced users want model control. Addressed by Lab mode, where models are named and selectable.

---

### PD-5: Asset Identity Is Computed Locally and Never Synced to Cloud

**Decision:** Face embeddings, style vectors, and voice profiles are computed and stored locally. Cloud generation receives style/identity guidance parameters, not raw embeddings.

**Why:** Identity data is the most sensitive data a creative workstation handles. Leaking a user's face embedding is not just a privacy violation — it enables misuse. The privacy guarantee must be architectural, not policy-based.

**Trade-off:** Character consistency in cloud generation requires translating local embeddings to cloud-compatible parameters (IP-Adapter style reference images rather than raw vectors). Some fidelity loss.

---

### PD-6: Free Tier Is Genuinely Free for Local Generation

**Decision:** Local generation is always free. Cloud is the paid tier.

**Why:** The value proposition for privacy-conscious users and hardware owners is destroyed if we gate local generation behind a paywall. The product's moat is the local-first experience. That moat is undermined if local features are limited in the free tier.

**Trade-off:** Harder to monetize users with capable hardware. Revenue model depends on cloud usage and advanced features.

---

### PD-7: Python Sidecar, Not ComfyUI Wrapper

**Decision:** Build a custom Python inference sidecar. ComfyUI can be integrated as one optional backend.

**Why:** ComfyUI's architecture is designed around its graph model. Wrapping ComfyUI as the core backend means our data model, error handling, and job system become coupled to ComfyUI's internals. ComfyUI breaks frequently with custom node updates. We need a stable, testable inference API.

**Trade-off:** More engineering effort than a simple ComfyUI wrapper. Mitigated by starting with a small, well-defined capability set.

---

### PD-8: JTBD.md Reference Photo Copy: for JTBD.md

**Decision:** Creative Asset Graph is database-resident (SQLite + adjacency list) with vector search via sqlite-vec.

**Why:** SQLite is battle-tested, file-portable, and zero-infrastructure. The asset graph does not require the performance characteristics of a dedicated graph database (Neo4j etc.) at creator-user scale (thousands of nodes, not millions). sqlite-vec enables local semantic search.

**Trade-off:** Complex graph traversal queries require careful SQL. Mitigated by Drizzle type-safe query builder.

---

### PD-9: Electron Over Tauri

**Decision:** Electron for desktop shell.

**Detailed rationale in SYSTEM_ARCHITECTURE.md.** Summary: Guaranteed WebGPU, mature AI app ecosystem, negligible memory overhead relative to model weights.

---

### PD-10: Start With Identity Preservation, Not 3D Continuity

**Decision:** MVP's cross-modal feature is character identity across images (not image → 3D → video continuity).

**Why:** Image-to-image identity preservation (consistent face across multiple generated images) is technically achievable in 2026 with current tools (IP-Adapter, FaceID). Image → 3D → video continuity with consistent identity is a harder unsolved problem. Starting with the achievable proves the concept; the harder problem becomes a horizon goal.

**Trade-off:** MVP doesn't fully deliver the "image → 3D → video" vision.

---

## Top 10 UX Decisions

### UXD-1: Intent Entry Is Primary Navigation

The persistent creation bar is always accessible regardless of where in the app the user is. This mirrors the "Spotlight" pattern — the application is always ready to receive a creative intent.

### UXD-2: Three-Level Depth (Create / Project / Lab)

Users occupy exactly one level at a time. They don't see other levels' complexity unless they deliberately navigate there. This is enforced architecturally, not through best intentions.

### UXD-3: Generation Results Always Offer Contextual Next Steps

A completed generation is never just a file. The "What's next?" section intelligently suggests relevant follow-on actions based on the generation type and what's available (e.g., character asset + "Convert to 3D" only shows if 3D model is installed).

### UXD-4: Cloud Indicator Is Non-Alarming But Always Visible

The cloud indicator is permanent during cloud operations — never hidden — but designed to be calm and informative rather than alarming. The lock icon for local operations communicates privacy without drama.

### UXD-5: Empty States Are Invitations

Empty project, empty asset library, empty model list — each has a clear, action-oriented invitation that immediately communicates value and guides first use.

### UXD-6: Errors Speak Creative Language

Error messages are audited to never include technical terms. A test: could a user with no AI knowledge understand this error and know what to do next?

### UXD-7: Studio Mode Is Discoverable But Not Prominent

Studio is a top-level navigation item — visible to all users — but positioned last in the nav hierarchy. Its visual weight is lower than Create, Projects, and Assets.

### UXD-8: Onboarding Ends With a Real Output

The onboarding flow's final screen shows the user's actual first generated result. No feature tour videos. No onboarding checklist. The product demonstrates itself.

### UXD-9: Asset Detail Pages Are Entity Pages, Not File Inspectors

When a user opens a character, they see the character's world — their generated images, their 3D representation, their usage history, their voice. Not a file browser with metadata fields.

### UXD-10: Identity Strength Control Is a Single Slider, Not Technical Settings

The primary control for "how much should the character look like the reference" is one slider: weak → strong. The underlying implementation (IP-Adapter weight, ControlNet strength, etc.) is entirely hidden.

---

## Top 10 Architecture Decisions

### AD-1: Electron Desktop Shell
(See PD-9 above and SYSTEM_ARCHITECTURE.md)

### AD-2: Python Sidecar for Inference (Not Node.js)

The AI/ML Python ecosystem (PyTorch, MLX, Diffusers, llama-cpp-python) has no viable TypeScript equivalent. Running inference in Python subprocess preserves access to the entire research ecosystem while keeping the UI layer in TypeScript.

### AD-3: SQLite as Single Database

One database file per user installation. WAL mode for performance. sqlite-vec for vector embeddings. No external database server. Zero infrastructure for end users.

### AD-4: Local-First Data Architecture

All user data (projects, assets, embeddings, generations) is local by design. Cloud is opt-in at the job level. This is an architectural constraint, not a policy. Re-architecting to cloud-first later would break the product's core promise.

### AD-5: Capability Registry Over Direct Model Calls

The system routes through a capability registry that maps requested capabilities to available models. New models are registered without changing routing code. Old models are deprecated without breaking UX.

### AD-6: Job Queue in SQLite (Not Redis/external)

The job queue is a SQLite table polled by the main process. This eliminates external infrastructure while providing persistence, resumability, and crash recovery. Appropriate for single-user creative workstation (not multi-tenant server).

### AD-7: Asset Relationships as Adjacency List in SQLite

The Creative Asset Graph is stored as an adjacency list table (from_id, from_type, to_id, to_type, relationship_type). Not a dedicated graph database. Adequate for creator-scale data (thousands of nodes). Extensible to a dedicated graph database if needed.

### AD-8: Model Management via Application, Not External Tools

Models are downloaded, verified, and managed by the application. Users never interact with Hugging Face CLI, Python pip, or terminal commands to install models. The application owns the model lifecycle.

### AD-9: IPC via contextBridge (Electron Security)

The Electron renderer process communicates with the main process through a typed contextBridge interface. No Node.js access in renderer. No remote content with elevated privileges. Security-first Electron configuration.

### AD-10: No Plugin System at MVP

Plugin architecture is deferred to V3. Plugins require a security model, a plugin API contract, a manifest format, sandboxing, and testing. Adding this to MVP is scope bloat that would delay the core product.

---

## Top 10 Risks

### R-1: Identity Preservation Quality Is Inconsistent

**Risk:** Face identity preservation using IP-Adapter/FaceID produces inconsistent results. Some photos work well; others don't. Users with non-Caucasian features may see lower quality (known bias in existing models). Users expect "recognizable" — they may get "vaguely similar."

**Probability:** High  
**Impact:** High (core moat undermined)  
**Mitigation:** Set conservative expectations ("keep you recognizable" not "perfectly clone you"). Offer quality feedback mechanism. Test across diverse faces during development. Invest in improving the identity pipeline in V1.

---

### R-2: Local Inference Performance Is Disappointing

**Risk:** FLUX on M3 Pro (16GB) produces 45-second generation times. Users are frustrated. Competitors (cloud) produce in 3 seconds.

**Probability:** Medium  
**Impact:** High  
**Mitigation:** Offer FLUX schnell (fast model, 7 seconds) as default with quality model as opt-in. Be explicit about speed expectations before generation starts. Cloud routing should be frictionless.

---

### R-3: Model Licensing Violations

**Risk:** FLUX.1 [dev] is non-commercial. Some LoRA weights have unclear licenses. Bundling or distributing these violates terms.

**Probability:** Medium  
**Impact:** Very High (legal, reputational)  
**Mitigation:** Legal review of all models in initial set. Track license types in Model Registry. Warn users clearly about commercial use restrictions. Only bundle Apache 2.0 or equivalent models.

---

### R-4: SceneWorks or Promptus Executes Our Vision First

**Risk:** SceneWorks (confirmed existing) positions as a local AI creative workstation. If they execute faster and achieve product-market fit, they occupy the space we're targeting.

**Probability:** Medium  
**Impact:** High  
**Mitigation:** Differentiation on: asset persistence (they appear to not have this), cross-modal continuity (character → 3D is likely not implemented), UX quality (needs to be dramatically better). Speed to market matters.

---

### R-5: Apple Silicon MLX Model Ecosystem Lags

**Risk:** Key models (Wan video, Hunyuan 3D) don't have high-quality MLX ports in the MVP timeframe. Local inference on Mac falls back to slow PyTorch MPS.

**Probability:** Medium  
**Impact:** Medium (cloud fallback exists)  
**Mitigation:** MLX ports are actively developed by Apple and community. MFLUX project already provides excellent FLUX MLX support. Plan cloud routes as primary path for video/3D in MVP; improve local as models mature.

---

### R-6: Cloud Provider Cost Exceeds Revenue

**Risk:** Generous cloud credits attract power users who burn through them. fal.ai/Replicate costs exceed subscription revenue.

**Probability:** Medium  
**Impact:** High (business model failure)  
**Mitigation:** Conservative credit allocation in free tier (5 credits ≈ 5 images or 1 short video). Creator tier (200 credits = $4 cost at current rates; priced at $19). Hard cap on credit usage; users must purchase more. Monitor unit economics monthly.

---

### R-7: App Store Distribution Restrictions

**Risk:** Mac App Store sandboxing prevents subprocess management (Python sidecar), unlimited model downloads to arbitrary paths, and some system capabilities.

**Probability:** High  
**Impact:** Medium  
**Mitigation:** Distribute outside App Store primarily (direct download, like LM Studio). Offer a sandboxed App Store version with limited capabilities (cloud only, no local model management). Use App Store for visibility, not as primary distribution.

---

### R-8: Model Quality Regression

**Risk:** A new model version is installed and generates noticeably worse results for some use cases. Users blame the application.

**Probability:** Medium  
**Impact:** Medium  
**Mitigation:** Model version pinning (application specifies exact model version, not "latest"). Separate "stable" and "preview" tracks. Automated quality benchmarks run before shipping model updates. Rollback mechanism in model registry.

---

### R-9: ComfyUI Dependency Risk (If Used as Backend)

**Risk:** If we integrate ComfyUI as a backend, ComfyUI breaking changes or upstream custom node conflicts cascade into our application.

**Probability:** High (ComfyUI breaks frequently)  
**Impact:** High if tightly coupled  
**Mitigation:** ComfyUI is one optional provider, not the primary backend. Custom Python sidecar is the default. If ComfyUI is used, pin to a specific ComfyUI version and test against it.

---

### R-10: Privacy Promise Breach

**Risk:** A cloud provider incident, a code bug, or an unclear consent flow results in user photos being stored or shared without explicit consent. This would be catastrophic for a "privacy-first" product.

**Probability:** Low (but existential if it occurs)  
**Impact:** Existential  
**Mitigation:** Architectural enforcement (data classification at code level, not just policy). Regular security audits. Open-source the data handling layer so users can verify. Clear legal data processing agreements with cloud providers. Bug bounty program.
