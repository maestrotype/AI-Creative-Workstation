# DESIGN SYSTEM & VISUAL LANGUAGE
## AI Creative Workstation — Canvas

---

## Design Philosophy

> **The interface should feel like a creative environment, not a software product.**

We are designing for people who spend hours in creative flow states. The interface must:
- Disappear when they're creating
- Appear when they need information
- Always feel premium, intelligent, and tactile
- Never feel generic, corporate, or loud

The visual language draws from:
- **Dark room / darkroom:** The professional environment where creative work happens — controlled, focused, precise
- **Editorial print:** High-quality typography, considered whitespace, confident hierarchy
- **Material intelligence:** Surfaces that feel like real materials — brushed metal, matte glass, grain
- **Spatial depth:** Content lives in dimensional space, not flat planes

---

## Color System

### Foundation: Dark Cinematic

The primary surface is deep, warm-neutral dark — not pure black, not blue-dark. Think the inside of a professional camera bag.

```
Surface Scale:
  ─────────────────────────────────────────────
  Canvas Dark     hsl(220, 8%, 8%)    #12131A   ← App background
  Canvas Raised   hsl(220, 8%, 11%)   #191A23   ← Sidebar, panels
  Canvas Card     hsl(220, 8%, 14%)   #1F2029   ← Cards, items
  Canvas Hover    hsl(220, 8%, 18%)   #282A35   ← Hover states
  Canvas Border   hsl(220, 10%, 22%) #333544   ← Subtle dividers
  Canvas Subtle   hsl(220, 10%, 28%) #404256   ← Inactive elements
  ─────────────────────────────────────────────
```

### Accent: Warm Amber

The accent color signals action, selection, and active state. It is warm — amber/gold — not blue (that's for cloud), not purple (AI cliché), not neon green (gaming).

```
Amber Scale:
  Amber Light    hsl(38, 90%, 65%)   #F5B84A   ← Hover glow
  Amber Default  hsl(38, 88%, 58%)   #F4A827   ← Primary action, selection
  Amber Deep     hsl(38, 85%, 48%)   #E09415   ← Active/pressed state
  Amber Muted    hsl(38, 40%, 35%)   #8A6A2A   ← Subtle amber surfaces
```

### Semantic Colors

```
Cloud Blue:    hsl(208, 85%, 58%)   #3D9FEA   ← Cloud indicator, cloud actions
Success:       hsl(152, 65%, 48%)   #2ECC7F   ← Completion, installed
Warning:       hsl(45, 92%, 58%)    #F5C842   ← Warning states
Error:         hsl(4, 75%, 58%)     #E85444   ← Errors (never loud)
Local Lock:    hsl(152, 55%, 42%)   #34A86A   ← Local/private indicator
```

### Text Scale

```
Text Primary   hsl(220, 15%, 92%)   #E8EAF0   ← Primary content
Text Secondary hsl(220, 12%, 65%)   #9CA3BC   ← Supporting content
Text Tertiary  hsl(220, 10%, 45%)   #6A718A   ← Placeholder, disabled
Text Inverse   hsl(220, 8%, 8%)     #12131A   ← Text on light surfaces
```

---

## Typography

### Type System: Editorial + Functional

Two type families with clear roles:

**Display / Heading: "Sora"** (Google Fonts)
- Used for: App name, large headings, asset titles, marketing
- Weight range: 300 (Light) to 700 (Bold)
- Character: Geometric, clean, slightly futuristic without being sci-fi
- Tracking: Slightly loose for headings (-0.01em to +0.02em depending on size)

**Body / UI: "Inter"** (Google Fonts / Variable)
- Used for: All UI text, labels, descriptions, prompts, metadata
- Weight range: 400 (Regular) to 600 (SemiBold)
- Character: Neutral, highly legible, excellent at small sizes
- The industry standard for a reason — excellent at small sizes and high pixel density

**Monospace: "JetBrains Mono"** (Google Fonts)
- Used for: Seed values, technical IDs, model names in Lab mode, code
- Only appears in Lab mode and technical views

### Type Scale

```
Size scale (rem, 16px base):
  Display XL:  3.5rem / 56px — App name, hero marketing
  Display LG:  2.5rem / 40px — Section headlines
  Heading XL:  2rem   / 32px — Page titles
  Heading LG:  1.5rem / 24px — Section titles  
  Heading MD:  1.25rem/ 20px — Card titles, asset names
  Heading SM:  1rem   / 16px — Group labels
  Body LG:     1rem   / 16px — Primary body text
  Body MD:     0.875rem/14px — Secondary content, descriptions
  Body SM:     0.8125rem/13px — Captions, metadata, tags
  Label:       0.75rem / 12px — Form labels, status indicators
  Micro:       0.6875rem/11px — Badges, counters
```

### Line Height and Spacing

```
Display sizes:    line-height: 1.1  (tight, editorial)
Heading sizes:    line-height: 1.2  (comfortable, readable)
Body sizes:       line-height: 1.6  (generous, scannable)
UI labels:        line-height: 1.3  (compact, functional)
```

---

## Spacing System

8-point grid, with 4-point micro-spacing for fine adjustments:

```
Spacing tokens:
  space-1:   4px   ← Micro gaps (icon to text)
  space-2:   8px   ← Tight component internal
  space-3:   12px  ← Component internal padding
  space-4:   16px  ← Standard padding, card internal
  space-5:   20px  ← Medium separation
  space-6:   24px  ← Component group separation
  space-8:   32px  ← Section internal
  space-10:  40px  ← Section separation
  space-12:  48px  ← Large section gap
  space-16:  64px  ← Page sections
  space-24:  96px  ← Major divisions
```

---

## Radius System

Consistent border-radius tokens — not aggressive rounding (that's mobile), not sharp corners (that's enterprise):

```
Radius tokens:
  radius-sm:   4px   ← Tags, badges, small chips
  radius-md:   8px   ← Buttons, inputs, small cards
  radius-lg:  12px   ← Cards, panels, modal content
  radius-xl:  16px   ← Large cards, sheet surfaces
  radius-2xl: 24px   ← Floating panels, tooltips
  radius-full: 999px ← Pills, avatars
```

---

## Elevation & Surfaces

### Surface Materials

Canvas uses layered surfaces with subtle texture — not flat colors, not glass morphism excess:

**Surface Base (App Background)**
```css
background: hsl(220, 8%, 8%);
/* Subtle grain texture overlay at 3% opacity */
background-image: url(grain.svg);
```

**Surface Raised (Sidebar, Panels)**
```css
background: hsl(220, 8%, 11%);
border-right: 1px solid hsl(220, 10%, 16%);
```

**Surface Card (Selectable items, model cards)**
```css
background: hsl(220, 8%, 14%);
border: 1px solid hsl(220, 10%, 20%);
border-radius: 12px;
```

**Surface Floating (Dropdowns, tooltips, popups)**
```css
background: hsl(220, 10%, 16%);
border: 1px solid hsl(220, 10%, 24%);
box-shadow: 0 8px 32px hsl(220, 20%, 4% / 0.6);
backdrop-filter: blur(12px);
border-radius: 12px;
```

**Surface Active / Selected**
```css
background: hsl(38, 88%, 58% / 0.08);
border-color: hsl(38, 88%, 58% / 0.3);
```

### Elevation Levels

```
Level 0: Base canvas        — No shadow, background color
Level 1: Raised elements    — Very subtle shadow
Level 2: Cards, panels      — Soft shadow
Level 3: Floating elements  — Pronounced shadow + blur
Level 4: Modal, dialogs     — Strong shadow + overlay
```

```css
/* Shadow tokens */
--shadow-1: 0 1px 3px hsl(220 20% 4% / 0.3);
--shadow-2: 0 4px 12px hsl(220 20% 4% / 0.4);
--shadow-3: 0 8px 32px hsl(220 20% 4% / 0.6);
--shadow-4: 0 16px 64px hsl(220 20% 4% / 0.8);
```

---

## Component States

For every interactive component, define all states:

| State | Visual Treatment |
|-------|-----------------|
| Default | Base surface, Text Primary |
| Hover | +2% lightness, subtle amber border hint |
| Focus | Amber ring: 0 0 0 2px amber-muted |
| Active/Pressed | -2% lightness, amber accent |
| Selected | Amber tint background, amber border |
| Disabled | 40% opacity, no hover state |
| Loading | Skeleton shimmer animation |
| Error | Error-red border, error text below |
| Success | Green checkmark, brief success animation |

---

## Iconography

### Icon Language

- **Style:** Streamline (thin, 1.5px stroke, 24×24 base)
- **Character:** Functional, not decorative. Each icon earns its place.
- **No emoji.** No cartoon icons. No filled icons in primary UI.
- **Color:** Icons inherit text color by default; accent icons use amber

### Icon Usage Rules

1. Icons accompany labels in navigation — never alone in primary context
2. In dense contexts (model cards, status rows), icons can stand alone with tooltip
3. Cloud indicator uses dedicated system: lock (🔒 local), cloud (☁️), lightning (⚡ cloud-required)
4. Status icons: green circle (complete), amber pulsing (generating), red circle (failed)

---

## Motion System

### Motion Principles

**Fast and purposeful.** Animations exist to communicate state transitions, not to decorate. No animation should feel slow or showy.

**Reference speed:** Mac native transitions. Not web-default CSS. Professional creative software feel.

### Duration Scale

```
Duration tokens:
  instant:   50ms   ← State hints (hover color)
  quick:    100ms   ← Icon state changes, tab switches
  normal:   200ms   ← Standard transitions (drawer open, state change)
  deliberate:300ms  ← Modal open, panel slide
  slow:     500ms   ← Page-level transitions, 3D camera moves
  cinematic:800ms   ← Hero animations, first-load reveals
```

### Easing Curves

```css
/* Custom easing tokens */
--ease-snap:    cubic-bezier(0.4, 0, 0.2, 1);   /* Material-style */
--ease-out:     cubic-bezier(0, 0, 0.2, 1);      /* Settling */
--ease-in:      cubic-bezier(0.4, 0, 1, 1);      /* Departing */
--ease-spring:  cubic-bezier(0.34, 1.56, 0.64, 1); /* Springy, used sparingly */
```

### Specific Animations

**Generation in progress:** Subtle breathing shimmer on the result area
```css
@keyframes generate-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
/* Duration: 2s, ease: sine-wave-like */
```

**Result reveal:** Generated result fades in with a subtle upward drift
```css
@keyframes result-reveal {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
/* Duration: 300ms, ease-out */
```

**3D model appear:** Scale from 0.95 with opacity
```css
@keyframes model-appear {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
/* Duration: 400ms, ease-spring */
```

**Panel slide:** Sidebar and panels slide in from their natural edge
```css
/* Left panel */
@keyframes panel-slide-right {
  from { transform: translateX(-16px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
/* Duration: 200ms, ease-out */
```

**Asset card hover:** Subtle lift on hover — no scale, just shadow enhancement
```css
.asset-card:hover {
  box-shadow: 0 8px 24px hsl(220 20% 4% / 0.5);
  border-color: hsl(220, 10%, 28%);
  transition: box-shadow 100ms ease-out, border-color 100ms ease-out;
}
```

---

## Visual Language Summary

| Element | Treatment |
|---------|-----------|
| App background | Deep warm dark with grain texture |
| Panels / sidebars | One step lighter, with subtle right border |
| Cards | Two steps lighter, rounded, thin border |
| Floating panels | Backdrop blur, deeper shadow |
| Primary action | Amber button, deep amber on hover |
| Selection state | Amber tint background |
| Cloud indicator | Small blue cloud icon, non-alarming |
| Local indicator | Small green lock icon |
| Progress | Amber progress bar, subtle shimmer |
| Typography | Sora for headings, Inter for body |
| Icons | Thin stroke, functional, not decorative |
| Shadows | Warm-dark, not neutral gray |

---

## What This Design Is Not

| Forbidden | Why |
|-----------|-----|
| Purple AI gradient | Cliché; every AI tool uses this |
| Glassmorphism excess | Overused; feels weightless, not premium |
| Neon glow borders | Gaming aesthetic; wrong for creative professionals |
| Pure black background | Cold; lacks depth |
| Rainbow gradient text | Visual noise masquerading as creativity |
| Particle mesh overlay | Background patterns obscure content |
| Large rounded "friendly" cards | SaaS dashboard trope |
| Over-saturated accent colors | Fatiguing during long creative sessions |

The design should make a user think: "This was made by people who understand both design and creative work." Not: "This was made by a startup that hired a CSS gradient artist."
