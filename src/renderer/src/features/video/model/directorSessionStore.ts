import type { BinItem, OverlayPos, TimelineClip, TrackLayout } from './directorTimeline';
import { DEFAULT_TRACK_LAYOUT } from './directorTimeline';
import type { VoiceoverSession } from './voiceoverSession';
import { emptyVoiceoverSession } from './voiceoverSession';

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
  voiceover?: VoiceoverSession;
}

const STORAGE_KEY = 'acw-director-session-v2';

export function loadDirectorSession(): DirectorSession | null {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) raw = localStorage.getItem('acw-director-session-v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DirectorSession;
    if (!parsed || !Array.isArray(parsed.bins) || !Array.isArray(parsed.clips)) return null;
    return {
      ...parsed,
      trackLayout: parsed.trackLayout ?? DEFAULT_TRACK_LAYOUT,
      overlayPos: parsed.overlayPos ?? {},
      voiceover: parsed.voiceover
        ? { ...emptyVoiceoverSession(), ...parsed.voiceover, analysis: null }
        : emptyVoiceoverSession(),
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
