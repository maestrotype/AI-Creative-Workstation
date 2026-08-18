# PRODUCT PRINCIPLES
## AI Creative Workstation

> These principles are not aspirational. They are constraints. Any feature, flow, or component that violates them should be questioned and possibly rejected.

---

## Principle 1: Creative Intent Is Primary

**The user's creative goal is the atomic unit of interaction — not a model, not a parameter, not a workflow.**

Every screen, dialog, and interaction must be expressible in terms of what the user wants to create, not how the system will create it.

Implications:
- Never expose model names in the primary UX
- Never expose sampler, scheduler, or CFG scale unless in advanced Lab mode
- Every task entry point must begin with "What do you want to create?"
- Error messages must be creative-intent-aware: "Identity strength is too low — increase it to keep faces more consistent" not "IP-Adapter weight threshold not met"

---

## Principle 2: The Application Owns the Complexity

**The user should never be asked to make a technical decision.**

Hardware selection, model routing, quantization format, execution provider, memory management — these are the application's responsibilities, not the user's.

Implications:
- Hardware capability detection must happen silently at startup
- Model selection must happen automatically based on capability + hardware
- Cloud routing must be transparent: the app explains the choice, never asks for it
- "Your hardware supports local generation" is information. "Please select GGUF or SafeTensors" is a failure.

---

## Principle 3: Assets Are Entities, Not Files

**Every generation is a moment in the life of a persistent creative entity.**

Characters, products, environments, and styles are first-class objects in the system. They have identity, history, relationships, and provenance.

Implications:
- No generation should exist without belonging to an asset or project
- Every asset has a version history
- Every asset knows what other assets it depends on
- Deleting an asset must warn about dependent content
- The file system is implementation detail — the user works with assets, not files

---

## Principle 4: Local-First Is Not a Feature — It Is a Default

**The application runs on the user's hardware by default. Cloud is an enhancement, not a prerequisite.**

Implications:
- The product must work without internet access (for supported capabilities)
- Cloud usage must require explicit opt-in, with clear indication of what data leaves the device
- Privacy indicator must always be visible when cloud is active
- A user on a MacBook with no internet should still be able to create

---

## Principle 5: Three Layers, No Leakage

**The product has three complexity layers: Create, Project, Lab. No layer should pollute another.**

- **Create:** Photo → Intent → Result. No technical controls visible.
- **Project:** Assets, scenes, versions, timeline. Technical details available on demand.
- **Lab:** Full model control, inference settings, provider selection. Deliberately separated.

Implications:
- Create mode must feel like a consumer product
- Lab mode must feel like a professional tool
- The transition between layers must be explicit and deliberate (not accidental)
- A new user should never accidentally encounter Lab mode

---

## Principle 6: Continuity Is the Product

**The ability to take one creative identity across image → 3D → video → export is what makes this product irreplaceable.**

Single-modality generation is a commodity. The connective tissue between modalities is not.

Implications:
- Every generation should offer "next step" options (animate, convert to 3D, save as character)
- Character identity should survive modality transitions
- Style references should be portable across generation types
- The Creative Asset Graph should be invisible but always active

---

## Principle 7: Intelligence Should Be Ambient

**AI assistance should feel like a good tool that understands its job, not an assistant asking for permission.**

Implications:
- The app should proactively suggest "This character could become a 3D asset" — but not demand acknowledgment
- Hardware-aware routing should happen silently
- Prompt enhancement should be opt-in but always available
- Suggestions should appear contextually, in the flow of work, not in modal dialogs

---

## Principle 8: Honesty at the Boundaries

**When something can't be done locally, when data will leave the device, when a result is unlikely to be good — be honest.**

Implications:
- Always show: "This will be generated on cloud — your image will be sent to [provider]"
- Always show estimated quality/compatibility: "Good", "Moderate", "Cloud recommended"
- Never fake progress; never hide failures
- When a model can't achieve something (e.g., perfect face preservation), show capability limits clearly

---

## Principle 9: The Experience Must Earn "Wow"

**Visual sophistication should come from composition, motion, and interaction — not from effects and decoration.**

Implications:
- No particle overlays, blob animations, or gradient text fills
- Animations must serve transitions and communicate state, not decorate
- 3D elements in the UI must serve the product narrative (demonstrating capability)
- Every "wow" moment should make the user think "I want to make that"

---

## Principle 10: Build for the Creator, Challenge Your Assumptions

**The target user is not the builder. Test every screen with "would a YouTube creator understand this in 3 seconds?"**

Implications:
- Every term used in the UI must be audited: is this a creative term or a technical term?
- Every empty state must have a clear creative prompt ("Start by adding your photo")
- Every error must be recoverable with a clear next action
- Onboarding must produce a real creative output, not a tour of features

---

## Anti-Principles (What We Will Not Do)

| We will NOT | Because |
|---|---|
| Expose ComfyUI's node structure | ComfyUI is a backend, not the product |
| Name models in primary UX | Models are infrastructure, not choices |
| Require API keys to get started | Friction at entry is unacceptable |
| Treat every generation as a file | Assets are entities with identity |
| Design a dashboard-first interface | The user wants to create, not monitor |
| Add features before polish | A half-working feature destroys trust faster than a missing one |
| Claim to "support" a modality before it actually works well | Overpromising is brand damage |
