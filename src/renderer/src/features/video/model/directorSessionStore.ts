import type { BinItem, OverlayPos, TimelineClip, TrackLayout } from './directorTimeline';
import { DEFAULT_TRACK_LAYOUT } from './directorTimeline';
import type { StillCompose, VoiceoverSession } from './voiceoverSession';
import { applyStillCompose, emptyVoiceoverSession } from './voiceoverSession';

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
  projectName?: string;
  stillCompose?: StillCompose;
}

const STANDALONE_KEY = 'acw-director-session-v2';
const LEGACY_KEY = 'acw-director-session-v1';

function storageKey(projectId?: string | null): string {
  const id = (projectId || '').trim();
  return id ? `acw-director-session-project:${id}` : STANDALONE_KEY;
}

function parseSession(raw: string | null): DirectorSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DirectorSession;
    if (!parsed || !Array.isArray(parsed.bins) || !Array.isArray(parsed.clips)) return null;
    const migrated = parsed.stillCompose == null;
    const stillCompose = parsed.stillCompose ?? 'intro';
    const clips = migrated
      ? applyStillCompose(parsed.bins, parsed.clips, stillCompose)
      : parsed.clips;
    return {
      ...parsed,
      clips,
      trackLayout: parsed.trackLayout ?? DEFAULT_TRACK_LAYOUT,
      overlayPos: parsed.overlayPos ?? {},
      stillCompose,
      voiceover: parsed.voiceover
        ? { ...emptyVoiceoverSession(), ...parsed.voiceover }
        : emptyVoiceoverSession(),
      bins: parsed.bins.map((b) => ({ ...b, proxying: false })),
    };
  } catch {
    return null;
  }
}

export function loadDirectorSession(projectId?: string | null): DirectorSession | null {
  const key = storageKey(projectId);
  try {
    let raw = localStorage.getItem(key);
    if (!raw && !projectId) raw = localStorage.getItem(LEGACY_KEY);
    return parseSession(raw);
  } catch {
    return null;
  }
}

export function saveDirectorSession(session: DirectorSession, projectId?: string | null): void {
  const stamped = { ...session, savedAt: Date.now() };
  const key = storageKey(projectId);
  try {
    localStorage.setItem(key, JSON.stringify(stamped));
  } catch {
    try {
      localStorage.setItem(key, JSON.stringify({
        ...stamped,
        voiceover: session.voiceover
          ? { ...session.voiceover, analysis: null }
          : undefined,
      }));
    } catch {
      /* quota */
    }
  }
}

export function clearDirectorSession(projectId?: string | null): void {
  try {
    localStorage.removeItem(storageKey(projectId));
  } catch {
    /* ignore */
  }
}
