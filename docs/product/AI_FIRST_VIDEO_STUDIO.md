# AI-first Video Studio — product direction

> **Status:** authoritative direction for the video product
> **Decision date:** 27 October 2026
> **Replaces:** the former “generator/chapters → stitch → voice” product model

## Product

AI Creative Workstation is a local-first video editor with integrated AI production.
It is neither a prompt wrapper nor a collection of separate generators exchanging
files. The product has one project, one media library, one timeline, and contextual
AI operations that create reversible changes.

We choose a hybrid product:

- **Quick start** for a new user: idea or imported material → proposed script and
  storyboard → draft edit → manual refinement.
- **Editor** for an experienced user: open a blank project or an existing video
  directly in the timeline.

Both paths end in the same editor and use the same project data. Quick start must
never create a second, simplified project format.

## User outcomes

The interface is organized around outcomes:

- make or import a video;
- change a selected clip or time range;
- generate a missing shot;
- repair speech or sound;
- add titles and captions;
- review and export a version.

Users must not have to understand internal pipeline stages such as “stitching” or
the names of Python workers. Rendering is an export implementation detail.

## Three product levels

### Project

Owns media, versions, script, storyboard, timelines, export variants and job
history. Opening an existing project goes directly to its editor.

### Workspace

The persistent editing environment:

- project media and storyboard on the left;
- viewer in the center;
- contextual inspector and AI actions on the right;
- multi-track timeline below.

Panels are resizable, hideable and persisted.

### Result

Review, validation and export. Export can produce several deliverables from one
project, such as 16:9 and 9:16, without duplicating source media or the project.

## Domain boundaries

### Project

Durable owner of settings, assets, sequences, scenes, AI jobs and exports.

### Media asset and version

An imported or generated source. A generated alternative is a new version or
derivation; it does not overwrite the original file.

### Timeline / sequence

The edit decision list: tracks, clips, source ranges, transforms, effects,
transitions, audio controls, titles and keyframes. This is the source of truth for
what the viewer and exporter produce.

### Scene / storyboard card

A planning object with a stable id and links to timeline clips. A scene may use
many clips; one source may be reused by many scenes. Scenes do not own timing by
implication and do not rebuild an edited timeline.

### Generation job

A persistent request with operation, inputs, model capability, parameters,
progress, outputs, alternatives and errors. Completion adds media to the project;
replacement happens only after user acceptance.

## AI interaction

AI actions are contextual, not one universal button.

- Image: animate, vary, change environment.
- Video clip: analyze, make an alternative, extend when supported.
- Audio: transcribe, repair speech, denoise.
- Text/title: rewrite, translate, create captions.
- Time range: propose replacement or insert.
- Project: propose script, storyboard or draft edit.

The UI must show capability limits. Image-to-video is not video editing. A model
that cannot preserve product identity or edit motion must not be presented as if
it can.

AI proposes an operation and its consequences before mutating an existing edit.
Originals and previous versions remain available.

## Audio and narration invariants

Narration quality is part of the product model, not a post-processing trick.

1. Script word budgets are calculated from timeline windows at the configured
   natural speaking rate.
2. Text is rewritten to fit before TTS.
3. Measured TTS duration is validated after synthesis.
4. A small tempo correction may stay within a natural range (0.94–1.08).
5. Large gaps require another text fit or a visible editorial decision.
6. Speech must never be slowed dramatically to fill a clip.
7. Timeline blocks represent real audible media duration; silence is explicit.
8. Cuts use short fades/crossfades to avoid clicks.

“No gaps” does not mean hiding missing content with padded silence. It means
creating enough meaningful narration, or explicitly showing that coverage is
incomplete.

## Delivery order

### P0 — dependable editor core

- canonical project schema and migrations;
- media assets separated from timeline clip instances;
- multiple video/audio/title tracks;
- frame/timebase-safe edit operations;
- trim, split, move, ripple delete, undo/redo, snapping;
- reliable save/reopen and preview/export parity.

### P1 — AI in the edit

- generation results added as related media;
- safe clip alternatives and replace/revert;
- storyboard linked to timeline;
- narration, music, captions and audio controls;
- persistent generation queue.

### P2 — assisted editing

- selected-range AI operations;
- proposed draft edits;
- multiple output sequences/aspect ratios.

Advanced color, masks and professional finishing remain later work.

## Acceptance principles

- Existing imported media is never overwritten.
- A failed generation cannot damage the timeline.
- Reopening a project restores the same edit.
- Preview and export use the same timeline semantics.
- “Undo” reverses every editor mutation.
- Every generated result records provenance and real duration.
- UI language describes creative outcomes, not internal architecture.
