import type { BinItem, OverlayPos, TimelineClip, TrackLayout } from './directorTimeline';
import { DEFAULT_TRACK_LAYOUT } from './directorTimeline';

export interface DirectorSession {
  savedAt: number;
  bins: BinItem[];
  clips: TimelineClip[];
  playhead: number;
  selectedBin: string | null;
  selectedClip: string | null;
  captionDraft: string;
  pxPerSec: number;
  trackLayout?: TrackLayout;
  overlayPos?: Record<string, OverlayPos>;
}

const STORAGE_KEY = 'acw-director-session-v1';

export function loadDirectorSession(): DirectorSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DirectorSession;
    if (!parsed || !Array.isArray(parsed.bins) || !Array.isArray(parsed.clips)) return null;
    return {
      ...parsed,
      trackLayout: parsed.trackLayout ?? DEFAULT_TRACK_LAYOUT,
      overlayPos: parsed.overlayPos ?? {},
      bins: parsed.bins.map((b) => ({ ...b, proxying: false })),
    };
  } catch {
    return null;
  }
}

export function saveDirectorSession(session: DirectorSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...session, savedAt: Date.now() }));
  } catch {
    /* quota */
  }
}

export function clearDirectorSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
