# AI Creative Workstation — Status

**Last updated:** 2026-08-25 (branch `feat/canvas-start-page-qwen3.8-27b`)

## Current state of the app

| Area | State | Notes |
| --- | --- | --- |
| App shell, design tokens, global styles | Done | `tokens.css` + `global.css`; Sora/Inter via @fontsource. Tokens used by code are all defined; `--color-border` remains unused (dead token). |
| Home — Recent Assets (grid + cards) | **Done, committed** | See "Latest work" below. Live UI verification still pending. |
| Side navigation | Present, unverified | Collapsible rail with active-state tinting (`sideNavigation.module.css`). Not yet checked against the premium direction in a live session. |
| IntentInput (composer) | Present, unverified | Attach button + solid accent send button implemented in CSS; needs visual verification only. |
| Create feature | **WIP from parallel session** | `src/features/create/store/createStore.ts` is committed (zustand mock generation pipeline: status/progress/statusText/resultImageUrl). **No consumers yet**, no route wired, and `src/features/create/ui/{GenerationResult,GenerationProgress}` exist as empty directories only. Disposition undecided (see Open decisions). |
| Asset pipeline / Onboarding / Settings | Not started | Roadmap items only (`docs/roadmap/ROADMAP.md`). |

## Latest work — committed on this branch

**Root cause of the uneven card widths:** `.card` had no width, so it shrank to content size inside its grid/flex track (`.gridItem` is `display: flex`). Fixed in `assetCard.module.css`: `.card { display: flex; flex-direction: column; width: 100%; min-width: 0 }`, plus `box-sizing: border-box` on the card for deterministic sizing.

**Opus visual port (reference-only — Qwen token system preserved):**
- Card hover: lift (`translateY(-3px)`), accent ring, deeper shadow via layered box-shadow. NOTE: hover shadow uses a hardcoded `hsl(220 25% 3% / 0.6)` — candidate for tokenization (see Open decisions).
- Accent-tinted preview placeholder with centered icon (`--color-accent-subtle` + `--color-accent`).
- Metadata pinned to card bottom via `margin-top: auto` on `.meta`.
- Asset name uses display font (Sora) with tighter tracking.
- Type label tinted with accent color.
- Staggered grid reveal in `recentAssets`: `.grid > li` animation, per-item delay from a local `--grid-index` custom property set inline in React; reduced-motion guard extended to disable it.
- Skeleton pulse timing moved `--duration-slow` → `--duration-cinematic` (800 ms).

**Verification so far:** typecheck + Vite build clean (in session). **Live UI verification pending.**

## Pending verification (`npm run dev`)

1. Card columns even at 1280 / 1536 / 1920 widths (the original bug).
2. Staggered reveal reads correctly; disabled under reduced motion.
3. Hover lift/ring/shadow feels right, no visual regression vs the previous treatment.
4. Metadata bottom-aligned across cards with varying name lengths.
5. Sidebar active state and IntentInput attach/send buttons match the intended premium direction (visual check only — code is already in place).

## Open decisions

1. **Card hover background:** Opus also lightens the surface on hover (`--color-card-elevated`). Current port keeps `--color-card` unchanged. Add a new token for full parity, or keep as-is?
2. **Hover shadow color:** replace hardcoded `hsl(220 25% 3% / 0.6)` with a token (e.g. reuse/derive from the existing `--shadow-4` family) if strict design-token discipline is required.
3. **Create feature WIP:** `useCreateStore` has no consumers and its UI dirs are empty. Options: wire it up in this session, defer to the next milestone with a note in ROADMAP, or revert. Also decide whether to keep the committed store now that zustand is a dependency.
4. **CSS comment cleanup:** `global.css` still contains literal em-dashes inside CSS comments (lines ~47–53 and ~206–219) — cosmetic fix pending.

## Roadmap pointers

Full phase breakdown lives in [`docs/roadmap/ROADMAP.md`](docs/roadmap/ROADMAP.md). Next up after verification: asset pipeline, then onboarding flow; Settings last (no external services yet). The Create UI is the natural consumer of the already-committed `useCreateStore`.
