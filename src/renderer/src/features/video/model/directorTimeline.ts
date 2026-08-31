export type BinKind = 'video' | 'image' | 'audio';

export type TrackId = `v${number}` | `a${number}` | `t${number}`;

export const MAX_VIDEO_TRACKS = 8;
export const MAX_AUDIO_TRACKS = 6;
export const MAX_TITLE_TRACKS = 4;

export interface TrackLayout {
  videos: number;
  audios: number;
  titles: number;
}

export const DEFAULT_TRACK_LAYOUT: TrackLayout = { videos: 1, audios: 1, titles: 1 };

export interface OverlayPos {
  x: number;
  y: number;
}

export const DEFAULT_OVERLAY_POS: Record<string, OverlayPos> = {
  v2: { x: 68, y: 58 },
  v3: { x: 4, y: 8 },
  v4: { x: 68, y: 8 },
  v5: { x: 4, y: 58 },
};

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
  /** Clip length follows bin In/Out until the user trims on the timeline. */
  autoLength?: boolean;
}

export interface DirectorSeed {
  title: string;
  totalSec: number;
  bins: Array<{ kind: BinKind; path: string; name: string; durationSec: number }>;
}

export interface TrackDef {
  id: TrackId;
  labelKey: string;
  labelParams?: Record<string, number>;
}

export function videoTrackId(n: number): TrackId {
  return `v${n}` as TrackId;
}

export function audioTrackId(n: number): TrackId {
  return `a${n}` as TrackId;
}

export function titleTrackId(n: number): TrackId {
  return `t${n}` as TrackId;
}

export function trackIndex(id: TrackId): number {
  return Number.parseInt(id.slice(1), 10) || 1;
}

export function isVideoTrack(track: TrackId): boolean {
  return track.startsWith('v');
}

export function isAudioTrack(track: TrackId): boolean {
  return track.startsWith('a');
}

export function isTitleTrack(track: TrackId): boolean {
  return track.startsWith('t');
}

export function isOverlayTrack(track: TrackId): boolean {
  return isVideoTrack(track) && trackIndex(track) > 1;
}

export function defaultTrackForKind(kind: BinKind): TrackId {
  if (kind === 'audio') return 'a1';
  return 'v1';
}

export function trackLabel(id: TrackId): TrackDef {
  const n = trackIndex(id);
  if (id === 'v1') return { id, labelKey: 'video.track_v1' };
  if (id.startsWith('v')) return { id, labelKey: 'video.track_v_overlay', labelParams: { n } };
  if (id === 'a1') return { id, labelKey: 'video.track_a1' };
  if (id.startsWith('a')) return { id, labelKey: 'video.track_a_extra', labelParams: { n } };
  if (id === 't1') return { id, labelKey: 'video.track_t1' };
  return { id, labelKey: 'video.track_t_extra', labelParams: { n } };
}

/** Visible lanes: used tracks + one empty drop row for overlays/audio when expanded. */
export function effectiveTrackLayout(clips: TimelineClip[], layout: TrackLayout): TrackLayout {
  let videos = layout.videos;
  let audios = layout.audios;
  let titles = layout.titles;
  let maxV = 1;
  let maxA = 1;
  let maxT = 1;

  for (const clip of clips) {
    if (clip.track.startsWith('v')) maxV = Math.max(maxV, trackIndex(clip.track));
    if (clip.track.startsWith('a')) maxA = Math.max(maxA, trackIndex(clip.track));
    if (clip.track.startsWith('t')) maxT = Math.max(maxT, trackIndex(clip.track));
  }

  videos = Math.max(videos, maxV);
  audios = Math.max(audios, maxA);
  titles = Math.max(titles, maxT);

  if (clips.some((c) => c.track.startsWith('v')) && videos < MAX_VIDEO_TRACKS) {
    videos = Math.max(videos, maxV + 1);
  }
  if (maxA >= 1 && audios < MAX_AUDIO_TRACKS && clips.some((c) => c.track.startsWith('a'))) {
    audios = Math.max(audios, maxA + 1);
  }

  return {
    videos: Math.min(MAX_VIDEO_TRACKS, Math.max(1, videos)),
    audios: Math.min(MAX_AUDIO_TRACKS, Math.max(1, audios)),
    titles: Math.min(MAX_TITLE_TRACKS, Math.max(1, titles)),
  };
}

export function buildTrackList(layout: TrackLayout): TrackDef[] {
  const out: TrackDef[] = [];
  for (let i = 1; i <= layout.videos; i += 1) out.push(trackLabel(videoTrackId(i)));
  for (let i = 1; i <= layout.audios; i += 1) out.push(trackLabel(audioTrackId(i)));
  for (let i = 1; i <= layout.titles; i += 1) out.push(trackLabel(titleTrackId(i)));
  return out;
}

export function overlayTrackIds(layout: TrackLayout): TrackId[] {
  const out: TrackId[] = [];
  for (let i = 2; i <= layout.videos; i += 1) out.push(videoTrackId(i));
  return out;
}

export function ensureTrackVisible(layout: TrackLayout, track: TrackId): TrackLayout {
  const n = trackIndex(track);
  if (track.startsWith('v')) {
    return { ...layout, videos: Math.min(MAX_VIDEO_TRACKS, Math.max(layout.videos, n)) };
  }
  if (track.startsWith('a')) {
    return { ...layout, audios: Math.min(MAX_AUDIO_TRACKS, Math.max(layout.audios, n)) };
  }
  return { ...layout, titles: Math.min(MAX_TITLE_TRACKS, Math.max(layout.titles, n)) };
}

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

export function avoidOverlap(
  clips: TimelineClip[],
  clipId: string,
  track: TrackId,
  startSec: number,
  durationSec: number,
): number {
  const others = clips
    .filter((c) => c.track === track && c.id !== clipId)
    .sort((a, b) => a.startSec - b.startSec);
  let start = Math.max(0, startSec);
  for (const other of others) {
    const oEnd = other.startSec + other.durationSec;
    if (start + durationSec <= other.startSec + 0.03) return start;
    if (start < oEnd) start = oEnd;
  }
  return start;
}

export function maxDurationBeforeNext(
  clips: TimelineClip[],
  clipId: string,
  track: TrackId,
  startSec: number,
  wanted: number,
): number {
  const next = clips
    .filter((c) => c.track === track && c.id !== clipId && c.startSec >= startSec - 0.001)
    .sort((a, b) => a.startSec - b.startSec)[0];
  if (!next) return wanted;
  return Math.max(0.4, Math.min(wanted, next.startSec - startSec));
}

/** Playhead only if it sits in a gap; otherwise append so clips do not stack. */
export function placementStart(
  clips: TimelineClip[],
  track: TrackId,
  playhead: number,
  durationSec: number,
  preferredSec?: number,
): number {
  let preferred = endOfTrack(clips, track);
  if (preferredSec != null && preferredSec >= 0) preferred = preferredSec;
  else if (playhead > 0.05 && !clipAtTime(clips, track, playhead)) preferred = playhead;
  return avoidOverlap(clips, '', track, preferred, durationSec);
}

export function unstackAllTracks(clips: TimelineClip[]): TimelineClip[] {
  const tracks = [...new Set(clips.map((c) => c.track))].filter((id) => !id.startsWith('t'));
  let next = clips;
  for (const track of tracks) next = unstackOverlaps(next, track);
  return next;
}

export const BIN_DRAG_MIME = 'application/x-acw-bin';

export function kindFromFileName(name: string): BinKind | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (['mp4', 'mov', 'm4v', 'webm', 'mkv'].includes(ext)) return 'video';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) return 'image';
  if (['wav', 'mp3', 'flac', 'm4a', 'aac', 'ogg'].includes(ext)) return 'audio';
  return null;
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

export function allowedTracksForClip(
  clip: TimelineClip,
  bins: BinItem[],
  layout: TrackLayout,
): TrackId[] {
  if (clip.track.startsWith('t') || clip.text) {
    return buildTrackList({ videos: 0, audios: 0, titles: layout.titles })
      .map((t) => t.id)
      .filter((id) => id.startsWith('t'));
  }
  const bin = bins.find((b) => b.id === clip.binId);
  if (!bin || bin.kind === 'audio') {
    return buildTrackList({ videos: 0, audios: layout.audios, titles: 0 })
      .map((t) => t.id)
      .filter((id) => id.startsWith('a'));
  }
  return buildTrackList({
    videos: Math.min(MAX_VIDEO_TRACKS, Math.max(layout.videos + 1, 2)),
    audios: 0,
    titles: 0,
  })
    .map((t) => t.id)
    .filter((id) => id.startsWith('v'));
}

export function videoTracksForBin(bin: BinItem | null, layout: TrackLayout): TrackId[] {
  if (!bin || bin.kind === 'audio') return [];
  const out: TrackId[] = [];
  for (let i = 1; i <= layout.videos; i += 1) out.push(videoTrackId(i));
  return out;
}

export function audioTracksForBin(bin: BinItem | null, layout: TrackLayout): TrackId[] {
  if (!bin || bin.kind !== 'audio') return [];
  const out: TrackId[] = [];
  for (let i = 1; i <= layout.audios; i += 1) out.push(audioTrackId(i));
  return out;
}

export function unstackOverlaps(clips: TimelineClip[], track: TrackId): TimelineClip[] {
  const on = clips
    .filter((c) => c.track === track)
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id));
  if (on.length < 2) return clips;
  let cursor = 0;
  const starts = new Map<string, number>();
  for (const clip of on) {
    const start = clip.startSec < cursor - 0.04 ? cursor : clip.startSec;
    starts.set(clip.id, start);
    cursor = start + clip.durationSec;
  }
  let changed = false;
  const next = clips.map((clip) => {
    const start = starts.get(clip.id);
    if (start == null || Math.abs(start - clip.startSec) < 0.02) return clip;
    changed = true;
    return { ...clip, startSec: start };
  });
  return changed ? next : clips;
}

export function canRemoveEmptyTrack(track: TrackId, clips: TimelineClip[], layout: TrackLayout): boolean {
  const n = trackIndex(track);
  if (clips.some((c) => c.track === track)) return false;
  if (track.startsWith('v')) {
    if (n <= 1) return false;
    const maxUsed = clips.reduce(
      (max, c) => (c.track.startsWith('v') ? Math.max(max, trackIndex(c.track)) : max),
      1,
    );
    return n > maxUsed && n === layout.videos;
  }
  if (track.startsWith('a')) {
    if (n <= 1) return false;
    const maxUsed = clips.reduce(
      (max, c) => (c.track.startsWith('a') ? Math.max(max, trackIndex(c.track)) : max),
      1,
    );
    return n > maxUsed && n === layout.audios;
  }
  if (n <= 1) return false;
  const maxUsed = clips.reduce(
    (max, c) => (c.track.startsWith('t') ? Math.max(max, trackIndex(c.track)) : max),
    1,
  );
  return n > maxUsed && n === layout.titles;
}

export function syncClipDuration(clip: TimelineClip, bin: BinItem): TimelineClip {
  if (!clip.autoLength || clip.binId !== bin.id) return clip;
  return {
    ...clip,
    durationSec: clipSpan(bin),
    sourceInSec: bin.inSec,
  };
}
