import type { YoutubeFormat, YoutubePlan } from './planYoutubeVideo';

export interface VideoDraftRecord {
  readonly id: string;
  readonly updatedAt: number;
  readonly topic: string;
  readonly format: YoutubeFormat;
  readonly durationSec: number;
  readonly plan: YoutubePlan | null;
  readonly outputPath: string | null;
}

export interface VideoHistoryFile {
  readonly savedAt: number;
  readonly currentId: string;
  readonly drafts: VideoDraftRecord[];
}

const LS_KEY = 'acw-video-idea-history-v1';
const MAX_DRAFTS = 16;

export function newDraftId(): string {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function drawnCount(plan: YoutubePlan | null): number {
  return plan?.scenes.filter((s) => Boolean(s.imagePath)).length ?? 0;
}

function readLocal(): VideoHistoryFile | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VideoHistoryFile;
    if (!parsed || !Array.isArray(parsed.drafts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeLocal(file: VideoHistoryFile): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(file));
  } catch {
    /* quota */
  }
}

export function upsertDraft(file: VideoHistoryFile, draft: VideoDraftRecord): VideoHistoryFile {
  const rest = file.drafts.filter((d) => d.id !== draft.id);
  const drafts = [draft, ...rest].slice(0, MAX_DRAFTS);
  return { savedAt: draft.updatedAt, currentId: draft.id, drafts };
}

export function removeDraft(file: VideoHistoryFile, id: string): VideoHistoryFile {
  const drafts = file.drafts.filter((d) => d.id !== id);
  const currentId = file.currentId === id ? (drafts[0]?.id ?? '') : file.currentId;
  return { ...file, savedAt: Date.now(), currentId, drafts };
}

export async function loadHistory(): Promise<VideoHistoryFile> {
  const local = readLocal();
  let disk: VideoHistoryFile | null = null;
  try {
    disk = ((await window.api?.loadVideoHistory?.()) ?? null) as VideoHistoryFile | null;
  } catch {
    disk = null;
  }
  if (disk && local) {
    return disk.savedAt >= local.savedAt ? disk : local;
  }
  return disk ?? local ?? { savedAt: 0, currentId: '', drafts: [] };
}

export async function persistHistory(file: VideoHistoryFile): Promise<void> {
  writeLocal(file);
  try {
    await window.api?.saveVideoHistory?.(file);
  } catch {
    /* sidecar/main may be restarting */
  }
}
