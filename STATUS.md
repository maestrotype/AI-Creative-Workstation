# STATUS — Claude start-page improvements port (Qwen branch)

Branch: `feat/canvas-start-page-qwen3.8-27b` (base HEAD observed: `46235de`).
All changes are in the working tree, **uncommitted**. No existing behavior changed.

## Changes (3 files modified, no consumer edits needed)

### 1. Navigation model — docs-compliant typed entries + runtime guard
File: `src/features/home/model/navigation.ts`
- `NAVIGATION_ITEMS` is now an array with `satisfies readonly NavigationEntry[]`.
- Each entry keeps the core `NavItem` shape (`id`, `label`) plus presentational `Icon` (Rule 6 compliance, per file header).
- All 6 entries preserved in IA order: `home`, `create`, `projects`, `assets`, `studio`, `settings`.
- Added type guard `isValidNavId(id: string): id is NavItemId` for validating ids from URL/storage at runtime.
- Qwen-local naming kept (`NavigationEntry`, `NavItem`/`NavItemId` from `src/core/types`) — Claude's exact identifiers were intentionally not force-fitted onto Qwen's type system.

Consumers verified unaffected (no edits required):
- `src/features/home/ui/homePage/index.tsx` — maps over `NAVIGATION_ITEMS` (`item.id`, `item.label`, `item.Icon`).
- `src/features/home/ui/sideNavigation/index.tsx` — imports types from core, not the new guard.

### 2. Focus-ring token compliance (docs/design/DESIGN_SYSTEM.md)
File: `src/shared/styles/tokens.css`
- Spec: focus state = amber ring `0 0 0 2px amber-muted`.
- Before: `--ring-focus: 0 0 0 3px hsl(38, 88%, 58% / 0.24)` (wrong width + wrong color).
- After: `--ring-focus: 0 0 0 2px var(--color-accent-muted)` — matches spec exactly; reuses the existing muted amber token (`hsl(36, 91%, 58%)`) instead of hardcoding.
- All focus-visible styles route through `var(--ring-focus)`, so this one token edit aligns the UI globally (no per-component edits).

### 3. .gitignore — local dev artifacts
File: `.gitignore`
- Added `# Local dev artifacts` section: `.vite/` and `package-lock.json`.
- Rationale: neither observed branch tracks a lockfile, both were untracked and polluting git status; ignoring them matches repo convention. Reversing the decision = delete line 31 of `.gitignore`.

## Validation (all green)
- `npm run typecheck` (`tsc --noEmit`) — exit 0.
- `npm run build` (`typecheck && vite build`) — success, `✓ built in 384ms`.
- Fresh on-disk reads used for all edits; git status/diff treated as source of truth (stale-read issue from earlier session avoided).

## Git state / next steps
```
 M .gitignore
 M src/features/home/model/navigation.ts
 M src/shared/styles/tokens.css
?? STATUS.md
package-lock.json — now ignored by .gitignore
```
Suggested single commit: `Port docs-compliant start-page improvements from Claude branch`
(STATUS.md can be committed separately or excluded per preference.)
