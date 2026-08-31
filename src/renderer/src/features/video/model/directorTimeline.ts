export type BinKind = 'video' | 'image' | 'audio';
export type TrackId = 'v1' | 'v2' | 'a1' | 't1';

export interface BinItem {
  id: string;
  kind: BinKind;
  path: string;
  name: string;
  durationSec: number;
  inSec: number;
  outSec: number;
  durationKnown?: boolean;
  proxying?: boolean;
}

export interface TimelineClip {
  id: string;
  binId: string | null;
  track: TrackId;
  startSec: number;
  durationSec: number;
  sourceInSec: number;
  label: string;
  text?: string;
}

export interface DirectorSeed {
  title: string;
  totalSec: number;
  bins: Array<{ kind: BinKind; path: string; name: string; durationSec: number }>;
}

export const TRACKS: { id: TrackId; labelKey: string }[] = [
  { id: 'v1', labelKey: 'video.track_v1' },
  { id: 'v2', labelKey: 'video.track_v2' },
  { id: 'a1', labelKey: 'video.track_a1' },
  { id: 't1', labelKey: 'video.track_t1' },
];

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function fileName(path: string): string {
  return path.split('/').pop() || path;
}

export function clipSpan(item: BinItem): number {
  return Math.max(0.4, item.outSec - item.inSec);
}

export function endOfTrack(clips: TimelineClip[], track: TrackId): number {
  const on = clips.filter((c) => c.track === track);
  if (on.length === 0) return 0;
  return Math.max(...on.map((c) => c.startSec + c.durationSec));
}

export function timelineLength(clips: TimelineClip[], fallback: number): number {
  if (clips.length === 0) return Math.max(8, fallback);
  return Math.max(...clips.map((c) => c.startSec + c.durationSec), 1);
}

export function clipAtTime(clips: TimelineClip[], track: TrackId, t: number): TimelineClip | null {
  const hits = clips.filter((c) => c.track === track && t >= c.startSec && t < c.startSec + c.durationSec);
  return hits.at(-1) ?? null;
}

export function mediaTimeForClip(clip: TimelineClip, t: number): number {
  return Math.max(0, clip.sourceInSec + (t - clip.startSec));
}

export function formatClock(sec: number): string {
  const clamped = Math.max(0, sec);
  const m = Math.floor(clamped / 60);
  const s = Math.floor(clamped % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function allowedTracksForClip(clip: TimelineClip, bins: BinItem[]): TrackId[] {
  if (clip.track === 't1' || clip.text) return ['t1'];
  const bin = bins.find((b) => b.id === clip.binId);
  if (!bin || bin.kind === 'audio') return ['a1'];
  return ['v1', 'v2'];
}
