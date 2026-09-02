export type DockPanelId = 'timeline' | 'preview' | 'sources' | 'storyboard' | 'recording' | 'fromvideo';
export type DockMode = 'tile' | 'free';

export interface DockRect {
  /* free mode, in % of the canvas */
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  /* tile mode */
  span: number; // 3..12 grid columns
  hpx: number; // pixel height
  order: number;
  visible: boolean;
}

export interface DockState {
  mode: DockMode;
  panels: Record<DockPanelId, DockRect>;
  /** Pixel height of the free-layout surface (derived from tile rows). */
  freeCanvasHpx?: number;
}

export const DOCK_PANEL_IDS: DockPanelId[] = ['timeline', 'preview', 'sources', 'storyboard', 'recording', 'fromvideo'];

export const DOCK_TITLE_KEYS: Record<DockPanelId, string> = {
  timeline: 'video.dir_timeline',
  preview: 'video.preview',
  sources: 'video.dir_bin',
  storyboard: 'video.panel_storyboard',
  recording: 'video.panel_recording',
  fromvideo: 'video.panel_fromvideo',
};

export function defaultDockState(): DockState {
  return {
    mode: 'tile',
    panels: {
      sources: { x: 0.5, y: 0.5, w: 32, h: 48, z: 2, span: 4, hpx: 340, order: 1, visible: true },
      preview: { x: 33.5, y: 0.5, w: 66, h: 48, z: 3, span: 8, hpx: 340, order: 2, visible: true },
      timeline: { x: 0.5, y: 50, w: 99, h: 48, z: 1, span: 12, hpx: 268, order: 3, visible: true },
      storyboard: { x: 4, y: 3, w: 88, h: 90, z: 8, span: 8, hpx: 480, order: 4, visible: false },
      recording: { x: 8, y: 6, w: 82, h: 84, z: 8, span: 4, hpx: 360, order: 5, visible: false },
      fromvideo: { x: 10, y: 8, w: 80, h: 82, z: 8, span: 6, hpx: 400, order: 6, visible: false },
    },
  };
}

const STORAGE_KEY = 'video-dock-layout-v6';

export function loadDockState(): DockState {
  const base = defaultDockState();
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) raw = localStorage.getItem('video-dock-layout-v5');
    if (!raw) raw = localStorage.getItem('video-dock-layout-v4');
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<DockState>;
    if (parsed.mode === 'tile' || parsed.mode === 'free') base.mode = parsed.mode;
    for (const id of DOCK_PANEL_IDS) {
      const next = parsed.panels?.[id];
      if (next && typeof next.span === 'number') base.panels[id] = { ...base.panels[id], ...next };
    }
    if (!base.panels.fromvideo) {
      base.panels.fromvideo = defaultDockState().panels.fromvideo;
    }
    if (base.panels.recording.span >= 8) {
      base.panels.recording = { ...base.panels.recording, span: 4 };
    }
  } catch {
    /* defaults */
  }
  if (base.mode === 'tile') return packTileLayout(base);
  if (!base.freeCanvasHpx) return tileToFreeLayout({ ...base, mode: 'tile' });
  return base;
}

export function saveDockState(state: DockState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function clampFree(rect: DockRect): DockRect {
  const w = Math.min(99, Math.max(20, rect.w));
  const h = Math.min(97, Math.max(18, rect.h));
  const x = Math.min(99.5 - w, Math.max(0.25, rect.x));
  const y = Math.min(99.5 - h, Math.max(0.25, rect.y));
  return { ...rect, x, y, w, h };
}

export function clampSpan(span: number): number {
  return Math.min(12, Math.max(3, Math.round(span)));
}

/** Float version for smooth interactive resize — no rounding, snap only on pointerUp. */
export function clampSpanFloat(span: number): number {
  return Math.min(12, Math.max(3, span));
}

export function clampHpx(hpx: number): number {
  return Math.min(1200, Math.max(220, Math.round(hpx)));
}

/** Remaining columns on the current grid row before placing `id` (tile mode). */
export function tileRowRemainder(state: DockState, id: DockPanelId): number {
  const visible = DOCK_PANEL_IDS
    .filter((pid) => state.panels[pid].visible && pid !== id)
    .sort((a, b) => state.panels[a].order - state.panels[b].order);

  let col = 0;
  for (const pid of visible) {
    const span = clampSpan(state.panels[pid].span);
    if (col > 0 && col + span > 12) col = 0;
    col += span;
    if (col >= 12) col = 0;
  }
  return col === 0 ? 12 : 12 - col;
}

/** Shrink span so a panel can sit beside siblings on the same row when space allows. */
export function fitTileSpan(state: DockState, id: DockPanelId): number {
  const current = clampSpan(state.panels[id].span);
  const remainder = tileRowRemainder(state, id);
  if (remainder >= 3 && remainder < 12) {
    return clampSpan(Math.min(current, remainder));
  }
  return current;
}

/** Pack visible tile panels so siblings share rows when columns remain. */
export function packTileLayout(state: DockState): DockState {
  if (state.mode !== 'tile') return state;
  let next: DockState = { ...state, panels: { ...state.panels } };
  for (const id of DOCK_PANEL_IDS) {
    if (!next.panels[id].visible) continue;
    next = {
      ...next,
      panels: {
        ...next.panels,
        [id]: { ...next.panels[id], span: fitTileSpan(next, id) },
      },
    };
  }
  return next;
}

const TILE_GAP_PX = 8;
const GRID_COLS = 12;

/** Convert current tile layout into non-overlapping free positions (same visual grid). */
export function tileToFreeLayout(state: DockState): DockState {
  const packed = packTileLayout({ ...state, mode: 'tile' });
  const visible = DOCK_PANEL_IDS
    .filter((id) => packed.panels[id].visible)
    .sort((a, b) => packed.panels[a].order - packed.panels[b].order);

  if (visible.length === 0) {
    return { ...packed, mode: 'free', freeCanvasHpx: 400 };
  }

  type Slot = { id: DockPanelId; col: number; span: number; yPx: number; hpx: number };
  const slots: Slot[] = [];
  let col = 0;
  let yPx = 0;
  let rowMaxH = 0;

  for (let i = 0; i < visible.length; i++) {
    const id = visible[i];
    const span = clampSpan(packed.panels[id].span);
    const hpx = clampHpx(packed.panels[id].hpx);
    if (col > 0 && col + span > GRID_COLS) {
      yPx += rowMaxH + TILE_GAP_PX;
      col = 0;
      rowMaxH = 0;
    }
    slots.push({ id, col, span, yPx, hpx });
    col += span;
    rowMaxH = Math.max(rowMaxH, hpx);
    if (col >= GRID_COLS && i < visible.length - 1) {
      yPx += rowMaxH + TILE_GAP_PX;
      col = 0;
      rowMaxH = 0;
    }
  }

  const totalHeightPx = Math.max(
    slots.reduce((max, s) => Math.max(max, s.yPx + s.hpx), 0),
    400,
  );
  const panels = { ...packed.panels };

  slots.forEach((slot, index) => {
    panels[slot.id] = {
      ...panels[slot.id],
      x: (slot.col / GRID_COLS) * 100,
      y: totalHeightPx > 0 ? (slot.yPx / totalHeightPx) * 100 : 0,
      w: (slot.span / GRID_COLS) * 100,
      h: totalHeightPx > 0 ? (slot.hpx / totalHeightPx) * 100 : 20,
      z: index + 1,
    };
  });

  return { ...packed, mode: 'free', panels, freeCanvasHpx: totalHeightPx };
}

/** Grow free canvas when panels extend below the current surface. */
export function recalcFreeCanvasH(state: DockState): number {
  const base = state.freeCanvasHpx ?? 720;
  let maxBottom = 0;
  for (const id of DOCK_PANEL_IDS) {
    if (!state.panels[id].visible) continue;
    const p = state.panels[id];
    maxBottom = Math.max(maxBottom, ((p.y + p.h) / 100) * base);
  }
  return Math.ceil(Math.max(maxBottom + TILE_GAP_PX, 400));
}

export function applyFreePanelPatch(state: DockState, id: DockPanelId, patch: Partial<DockRect>): DockState {
  const panels = {
    ...state.panels,
    [id]: clampFree({ ...state.panels[id], ...patch, visible: true }),
  };
  return { ...state, panels };
}
