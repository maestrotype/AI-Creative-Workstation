import type { ProjectDoc } from './project';
import { sceneHasMedia } from './project';

/** One-shot leftover from older Film → Director navigation. Consumed and discarded; not the Film identity. */
export const PROJECT_VIDEO_HANDOFF_KEY = 'acw-open-project-video';
/** Resume hint on the Films list only. Not the source of truth; project.json is. */
export const LAST_PROJECT_KEY = 'acw-last-project-id';

export type ProjectHandoffSource = {
  kind: 'video' | 'image';
  path: string;
  name?: string;
  durationSec?: number;
};

export type ProjectHandoff = {
  projectId: string;
  projectName: string;
  brief?: string;
  sources: ProjectHandoffSource[];
};

export function sourcesFromScenes(doc: ProjectDoc): ProjectHandoffSource[] {
  return doc.scenes.filter(sceneHasMedia).map((scene) => {
    if (scene.clipPath) {
      return {
        kind: 'video' as const,
        path: scene.clipPath,
        name: scene.title || undefined,
        durationSec: scene.durationSec,
      };
    }
    return {
      kind: 'image' as const,
      path: scene.stillPath as string,
      name: scene.title || undefined,
      durationSec: scene.durationSec,
    };
  });
}

let handoffCache: { at: number; value: ProjectHandoff | null } | null = null;

export function writeProjectHandoff(payload: ProjectHandoff): void {
  handoffCache = null;
  localStorage.setItem(PROJECT_VIDEO_HANDOFF_KEY, JSON.stringify(payload));
}

export function peekProjectHandoff(): ProjectHandoff | null {
  if (handoffCache && Date.now() - handoffCache.at < 2500) {
    return handoffCache.value;
  }
  return parseHandoff(localStorage.getItem(PROJECT_VIDEO_HANDOFF_KEY), false);
}

export function takeProjectHandoff(): ProjectHandoff | null {
  if (handoffCache && Date.now() - handoffCache.at < 2500) {
    return handoffCache.value;
  }
  const raw = localStorage.getItem(PROJECT_VIDEO_HANDOFF_KEY);
  if (raw) localStorage.removeItem(PROJECT_VIDEO_HANDOFF_KEY);
  const value = parseHandoff(raw, true);
  handoffCache = { at: Date.now(), value };
  return value;
}

function parseHandoff(raw: string | null, allowLegacyPath: boolean): ProjectHandoff | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ProjectHandoff | string;
    if (typeof parsed === 'string' && parsed) {
      return {
        projectId: '',
        projectName: '',
        sources: [{ kind: 'video', path: parsed }],
      };
    }
    if (typeof parsed !== 'string' && parsed && Array.isArray(parsed.sources) && parsed.sources.length > 0) {
      return parsed;
    }
  } catch {
    if (allowLegacyPath && (raw.startsWith('/') || raw.startsWith('file:'))) {
      return {
        projectId: '',
        projectName: '',
        sources: [{ kind: 'video', path: raw }],
      };
    }
  }
  return null;
}

export function readLastProjectId(): string | null {
  try {
    const id = localStorage.getItem(LAST_PROJECT_KEY);
    return id && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

export function writeLastProjectId(id: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    /* ignore */
  }
}

export function clearLastProjectId(id?: string): void {
  try {
    if (!id || localStorage.getItem(LAST_PROJECT_KEY) === id) {
      localStorage.removeItem(LAST_PROJECT_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function handoffPathsOf(handoff: ProjectHandoff): string[] {
  return handoff.sources.map((s) => s.path).filter(Boolean).sort();
}
