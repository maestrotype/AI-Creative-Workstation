# REACT ARCHITECTURE STANDARDS
## Canvas — Front-End Engineering Guidelines

To ensure the React codebase remains as maintainable, scalable, and predictable as an enterprise Angular application, all front-end code must adhere to the following architectural standards.

---

## 1. Architectural Pattern: Feature-Based Modular Design

We reject the traditional React "folder-by-type" (components/, hooks/, services/) structure, which leads to spaghetti code. We adopt a strict **Feature-Based Architecture** (inspired by Feature-Sliced Design and Angular modules).

### Directory Structure

```
src/
├── app/                  # App-level config (Routing, Global Providers, Global Styles)
├── core/                 # Core domain logic (Types, API clients, DB schema, Utils)
├── features/             # Independent, business-value modules (The "Angular Modules")
│   ├── create/           # e.g., The Create Intent Feature
│   │   ├── components/   # UI components specific to this feature
│   │   ├── hooks/        # Feature-specific React hooks
│   │   ├── store/        # Zustand slice for this feature
│   │   ├── api/          # Data fetching for this feature
│   │   └── index.ts      # Public API of this feature (Strict encapsulation)
│   ├── projects/
│   └── assets/
└── shared/               # Highly reusable, dumb UI components (Design System)
    ├── ui/               # Button, Input, Modal, Typography
    └── styles/           # CSS Variables, Mixins
```

**Rule 1:** A feature can import from `core` and `shared`, but NEVER from another feature's internal folders. Cross-feature imports must go exclusively through the target feature's `index.ts`.

---

## 2. Strict Separation of Concerns (Container vs. Presentational)

We maintain a strict boundary between UI rendering and business logic.

- **Presentational Components (`shared/ui` and `feature/components`):**
  - Must NOT contain business logic.
  - Must NOT directly access the global store (Zustand) or API.
  - Receive all data and callbacks via `props`.
  - Only allowed state: purely visual UI state (e.g., `isHovered`, `isOpen`).

- **Container Components (Feature Entry Points):**
  - Responsible for connecting to Zustand, API, and Core services.
  - Render Presentational Components, passing down props.
  - Contain minimal HTML/CSS; mostly structural wrappers.

---

## 3. State Management (Zustand over Context)

- Avoid React Context for frequently updating state (prevents unnecessary re-renders).
- Use **Zustand** for global/feature state.
- Split Zustand stores by feature (Domain Stores).
- Business logic, side effects, and state mutations MUST live in the Zustand store actions, NOT inside React components. 
- *Angular translation: Zustand acts as our injectable Singleton Services.*

---

## 4. Design System & Styling Rules

To prevent "chaos of colors and fonts", the application must enforce strict design tokens.

### Styling Technology
- **Vanilla CSS Modules** (`Component.module.css`).
- No Tailwind (to prevent generic design).
- No inline styles (unless mathematically calculated for animations like parallax).

### Design Tokens (CSS Variables)
- **Rule 2:** NEVER hardcode a HEX color, font-size, or margin value in a component's CSS.
- Every color, spacing, and typography setting must reference a CSS Variable from `shared/styles/tokens.css`.

```css
/* BAD */
.button {
  background-color: #1a1a1a;
  border-radius: 8px;
  font-family: 'Inter', sans-serif;
}

/* GOOD */
.button {
  background-color: var(--color-surface-elevated);
  border-radius: var(--radius-md);
  font-family: var(--font-ui);
}
```

### Component Constraints
- Developers are NOT allowed to invent new UI components for standard elements. Use `shared/ui`. If a variant is missing, update the shared component.

---

## 5. Asynchronous Operations & Side Effects

- All async calls (API, IPC to Electron Main process, Database reads) must be abstracted into Service files (`api.ts` or `ipc.ts`), returning typed Promises.
- React components must never call `window.api` directly.
- Use a data-fetching library (like SWR or React Query) or Zustand async actions to handle loading/error states cleanly.

---

## 6. Type Safety (Strict TypeScript)

- `strict: true` in `tsconfig.json` is non-negotiable.
- No `any` types allowed. Use `unknown` if absolutely necessary and narrow it down.
- Interfaces for all Component Props.
- Domain types (e.g., `Project`, `Asset`) must be imported from `core/types` and act as the single source of truth.
