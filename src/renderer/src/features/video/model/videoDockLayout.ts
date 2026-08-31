export type DockPanelId = 'timeline' | 'preview' | 'sources' | 'storyboard' | 'recording';
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
}

export const DOCK_PANEL_IDS: DockPanelId[] = ['timeline', 'preview', 'sources', 'storyboard', 'recording'];

export const DOCK_TITLE_KEYS: Record<DockPanelId, string> = {
  timeline: 'video.dir_timeline',
  preview: 'video.preview',
  sources: 'video.dir_bin',
  storyboard: 'video.panel_storyboard',
  recording: 'video.panel_recording',
};

export function defaultDockState(): DockState {
  return {
    mode: 'tile',
    panels: {
      sources: { x: 0.5, y: 0.5, w: 32, h: 48, z: 2, span: 4, hpx: 340, order: 1, visible: true },
      preview: { x: 33.5, y: 0.5, w: 66, h: 48, z: 3, span: 8, hpx: 340, order: 2, visible: true },
      timeline: { x: 0.5, y: 50, w: 99, h: 48, z: 1, span: 12, hpx: 268, order: 3, visible: true },
      storyboard: { x: 4, y: 3, w: 88, h: 90, z: 8, span: 8, hpx: 480, order: 4, visible: false },
      recording: { x: 8, y: 6, w: 82, h: 84, z: 8, span: 8, hpx: 360, order: 5, visible: false },
    },
  };
}

const STORAGE_KEY = 'video-dock-layout-v4';

export function loadDockState(): DockState {
  const base = defaultDockState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<DockState>;
    if (parsed.mode === 'tile' || parsed.mode === 'free') base.mode = parsed.mode;
    for (const id of DOCK_PANEL_IDS) {
      const next = parsed.panels?.[id];
      if (next && typeof next.span === 'number') base.panels[id] = { ...base.panels[id], ...next };
    }
  } catch {
    /* defaults */
  }
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

export function clampHpx(hpx: number): number {
  return Math.min(1200, Math.max(220, Math.round(hpx)));
}
