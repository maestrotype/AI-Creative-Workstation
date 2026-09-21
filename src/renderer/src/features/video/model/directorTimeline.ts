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
  shotId?: string;
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
  /** Bin to restore after an AI regenerate. Original file stays in the library. */
  previousBinId?: string;
  previousDurationSec?: number;
  muted?: boolean;
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
  if (id === 'a2') return { id, labelKey: 'video.track_a2' };
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

export function packTrack(clips: TimelineClip[], track: TrackId): TimelineClip[] {
  const on = clips
    .filter((c) => c.track === track)
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id));
  if (on.length === 0) return clips;
  let cursor = 0;
  const starts = new Map<string, number>();
  for (const clip of on) {
    starts.set(clip.id, cursor);
    cursor += clip.durationSec;
  }
  return clips.map((clip) => {
    const start = starts.get(clip.id);
    if (start == null || Math.abs(start - clip.startSec) < 0.02) return clip;
    return { ...clip, startSec: start };
  });
}

export function snapStart(
  clips: TimelineClip[],
  clipId: string,
  track: TrackId,
  startSec: number,
  durationSec: number,
  magnet = 0.35,
): number {
  const others = clips.filter((c) => c.track === track && c.id !== clipId);
  let start = Math.max(0, startSec);
  let best = magnet;
  for (const other of others) {
    const oEnd = other.startSec + other.durationSec;
    const dStart = Math.abs(start - other.startSec);
    const dEnd = Math.abs(start - oEnd);
    const dTail = Math.abs(start + durationSec - other.startSec);
    if (dEnd < best) {
      start = oEnd;
      best = dEnd;
    }
    if (dStart < best) {
      start = other.startSec;
      best = dStart;
    }
    if (dTail < best) {
      start = Math.max(0, other.startSec - durationSec);
      best = dTail;
    }
  }
  return avoidOverlap(clips, clipId, track, start, durationSec);
}

export function trackHasGap(clips: TimelineClip[], track: TrackId): boolean {
  const on = clips
    .filter((c) => c.track === track)
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id));
  if (on.length === 0) return false;
  let cursor = 0;
  for (const clip of on) {
    if (clip.startSec > cursor + 0.08) return true;
    cursor = clip.startSec + clip.durationSec;
  }
  return false;
}

export function packAllGaps(clips: TimelineClip[]): TimelineClip[] {
  const tracks = [...new Set(clips.map((c) => c.track))].filter((id) => !id.startsWith('t'));
  let next = clips;
  for (const track of tracks) {
    if (trackHasGap(next, track)) next = packTrack(next, track);
  }
  return next;
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
  if (['wav', 'mp3', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'caf'].includes(ext)) return 'audio';
  return null;
}

export function timelineLength(clips: TimelineClip[], fallback: number): number {
  if (clips.length === 0) return Math.max(8, fallback);
  return Math.max(...clips.map((c) => c.startSec + c.durationSec), 1);
}

/**
 * Ruler / playhead length for the Film editor.
 * Picture + callouts define the film. A runaway narration/source probe must not
 * stretch the timeline into empty minutes.
 */
export function filmTotalSec(
  clips: TimelineClip[],
  callouts: Array<{ endSec: number }> = [],
  voiceoverSourceDur = 0,
): number {
  const pictureEnd = Math.max(
    0,
    ...clips
      .filter((c) => c.track.startsWith('v') || c.track.startsWith('t'))
      .map((c) => c.startSec + c.durationSec),
  );
  const audioEnd = Math.max(
    0,
    ...clips.filter((c) => c.track.startsWith('a')).map((c) => c.startSec + c.durationSec),
  );
  const calloutEnd = Math.max(0, ...callouts.map((c) => c.endSec));

  if (pictureEnd > 0.5) {
    // Allow short audio overhang; ignore narration that dwarfs the picture.
    const audioSlack = Math.max(pictureEnd + 2, pictureEnd * 1.08);
    const usableAudio = audioEnd > audioSlack * 1.35 ? 0 : Math.min(audioEnd, audioSlack);
    return Math.max(8, pictureEnd, usableAudio, calloutEnd);
  }

  const audioOrSource = Math.max(audioEnd, voiceoverSourceDur > 0.5 ? voiceoverSourceDur : 0);
  return Math.max(8, audioOrSource, calloutEnd);
}

/** Cap audio clips that wildly overshoot the picture (e.g. 20min narration on a 2min cut). */
export function trimRunawayAudioClips(clips: TimelineClip[]): TimelineClip[] {
  const pictureEnd = Math.max(
    0,
    ...clips
      .filter((c) => c.track.startsWith('v') || c.track.startsWith('t'))
      .map((c) => c.startSec + c.durationSec),
  );
  if (pictureEnd < 1) return clips;
  const limit = pictureEnd;
  let changed = false;
  const next = clips.map((clip) => {
    if (!clip.track.startsWith('a')) return clip;
    const end = clip.startSec + clip.durationSec;
    if (end <= limit + 0.35) return clip;
    const durationSec = Math.max(0.4, Math.round((limit - clip.startSec) * 100) / 100);
    if (durationSec <= 0.4 && clip.startSec >= limit) return clip;
    if (Math.abs(durationSec - clip.durationSec) < 0.05) return clip;
    changed = true;
    return { ...clip, durationSec, autoLength: false };
  });
  return changed ? next : clips;
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
    // Hard collision: never allow start inside a previous clip's span.
    // Gaps (start > cursor) are preserved.
    const start = Math.max(0, Math.max(clip.startSec, cursor));
    starts.set(clip.id, Math.round(start * 1000) / 1000);
    cursor = start + Math.max(0.05, clip.durationSec);
  }
  let changed = false;
  const next = clips.map((clip) => {
    const start = starts.get(clip.id);
    if (start == null || Math.abs(start - clip.startSec) < 0.001) return clip;
    changed = true;
    return { ...clip, startSec: start };
  });
  return changed ? next : clips;
}

/** Shift a lane so the first clip starts at 0; keeps gaps between clips. */
export function trimLeadingGap(clips: TimelineClip[], track: TrackId): TimelineClip[] {
  const on = clips
    .filter((c) => c.track === track)
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id));
  if (on.length === 0) return clips;
  const lead = on[0].startSec;
  if (lead < 0.05) return clips;
  return clips.map((clip) => (
    clip.track === track
      ? { ...clip, startSec: Math.round((clip.startSec - lead) * 1000) / 1000 }
      : clip
  ));
}

/**
 * Guarantee no overlaps on video/audio lanes. Safe to run on every commit.
 * Preserves intentional leading silence (e.g. music starting mid-film).
 * Use packGaps / trimLeadingGap only when the user asks to close gaps.
 */
export function sanitizeClips(clips: TimelineClip[]): TimelineClip[] {
  return unstackAllTracks(clips);
}

/**
 * Moves a clip to `targetStartSec` on its track and magnetically pushes neighbors
 * apart so clips on the same lane never stack. Pass a drag-start snapshot as
 * `clips` for stable live previews while dragging.
 */
export function moveClipWithRipple(
  clips: TimelineClip[],
  clipId: string,
  targetStartSec: number,
): TimelineClip[] {
  const target = clips.find((c) => c.id === clipId);
  if (!target) return clips;

  const track = target.track;
  const duration = Math.max(0.4, target.durationSec);
  const others = clips
    .filter((c) => c.track === track && c.id !== clipId)
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id));

  let startSec = Math.max(0, targetStartSec);

  const snapThreshold = 0.35;
  const snapPoints = [0];
  for (const other of others) {
    snapPoints.push(other.startSec);
    snapPoints.push(other.startSec + other.durationSec);
    snapPoints.push(Math.max(0, other.startSec - duration));
  }
  let best = snapThreshold;
  for (const point of snapPoints) {
    const dist = Math.abs(startSec - point);
    if (dist < best) {
      best = dist;
      startSec = point;
    }
  }

  // Order by drop start vs neighbor midpoints so a drop at 0 lands first,
  // and a drop between two clips parts them instead of stacking.
  let insertAt = others.length;
  for (let i = 0; i < others.length; i += 1) {
    const otherMid = others[i].startSec + others[i].durationSec / 2;
    if (startSec < otherMid) {
      insertAt = i;
      break;
    }
  }

  const ordered: TimelineClip[] = [
    ...others.slice(0, insertAt),
    { ...target, startSec, durationSec: duration },
    ...others.slice(insertAt),
  ];

  const newPositions = new Map<string, number>();
  let cursor = 0;
  for (let i = 0; i < ordered.length; i += 1) {
    const clip = ordered[i];
    const desired = i === insertAt ? startSec : clip.startSec;
    const pos = Math.max(0, Math.max(desired, cursor));
    newPositions.set(clip.id, Math.round(pos * 100) / 100);
    cursor = pos + clip.durationSec;
  }

  return clips.map((clip) => {
    if (clip.track !== track) return clip;
    const newPos = newPositions.get(clip.id);
    if (newPos == null) return clip;
    if (clip.id === clipId) {
      return { ...clip, startSec: newPos, durationSec: duration };
    }
    if (Math.abs(newPos - clip.startSec) < 0.001) return clip;
    return { ...clip, startSec: newPos };
  });
}

/** Shift callouts on the hints lane so they do not stack when one is moved. */
export function moveTimedRangeWithRipple<T extends { id: string; startSec: number; endSec: number }>(
  items: T[],
  itemId: string,
  targetStartSec: number,
): T[] {
  const target = items.find((item) => item.id === itemId);
  if (!target) return items;
  const duration = Math.max(0.4, target.endSec - target.startSec);
  const asClips: TimelineClip[] = items.map((item) => ({
    id: item.id,
    binId: null,
    track: 't1',
    startSec: item.startSec,
    durationSec: Math.max(0.4, item.endSec - item.startSec),
    sourceInSec: 0,
    label: item.id,
  }));
  const next = moveClipWithRipple(asClips, itemId, targetStartSec);
  const byId = new Map(next.map((clip) => [clip.id, clip]));
  return items.map((item) => {
    const clip = byId.get(item.id);
    if (!clip) return item;
    return {
      ...item,
      startSec: clip.startSec,
      endSec: clip.startSec + (item.id === itemId ? duration : clip.durationSec),
    };
  });
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

/** Place a clip at `atSec` on a track, splitting if needed and shifting later clips. Does not stretch. */
export function insertClipOnTrack(
  clips: TimelineClip[],
  track: TrackId,
  atSec: number,
  clip: TimelineClip,
): TimelineClip[] {
  const at = Math.max(0, atSec);
  let next = clips;
  const hit = clipAtTime(next, track, at);
  if (hit && at > hit.startSec + 0.08 && at < hit.startSec + hit.durationSec - 0.08) {
    next = splitClipAt(next, hit.id, at);
  }
  const duration = Math.max(0.4, clip.durationSec);
  next = next.map((item) => {
    if (item.track !== track || item.startSec < at - 0.001) return item;
    return { ...item, startSec: item.startSec + duration };
  });
  return [...next, { ...clip, track, startSec: at, durationSec: duration }];
}

export function splitClipAt(
  clips: TimelineClip[],
  clipId: string,
  atSec: number,
): TimelineClip[] {
  const clip = clips.find((item) => item.id === clipId);
  if (!clip) return clips;
  const local = atSec - clip.startSec;
  if (local < 0.2 || local > clip.durationSec - 0.2) return clips;
  const left: TimelineClip = {
    ...clip,
    durationSec: local,
    autoLength: false,
  };
  const right: TimelineClip = {
    ...clip,
    id: newId('clip'),
    startSec: atSec,
    durationSec: clip.durationSec - local,
    sourceInSec: clip.sourceInSec + local,
    autoLength: false,
  };
  return clips.flatMap((item) => (item.id === clipId ? [left, right] : [item]));
}

export function detachAudioFromClip(
  clips: TimelineClip[],
  bins: BinItem[],
  clipId: string,
): { nextClips: TimelineClip[]; nextBins: BinItem[]; newClipId: string | null } {
  const target = clips.find((c) => c.id === clipId);
  if (!target || !target.binId || !target.track.startsWith('v')) {
    return { nextClips: clips, nextBins: bins, newClipId: null };
  }
  const bin = bins.find((b) => b.id === target.binId);
  if (!bin || bin.kind !== 'video') {
    return { nextClips: clips, nextBins: bins, newClipId: null };
  }

  const existingAudioBin = bins.find((b) => b.path === bin.path && b.kind === 'audio');
  let audioBinId = existingAudioBin?.id;
  let nextBins = bins;

  if (!audioBinId) {
    audioBinId = newId('bin');
    const newBin: BinItem = {
      ...bin,
      id: audioBinId,
      kind: 'audio',
      name: `${bin.name.replace(/\.[^.]+$/, '')} (Аудио)`,
    };
    nextBins = [...bins, newBin];
  }

  const newAudioClipId = newId('clip');
  const audioClip: TimelineClip = {
    id: newAudioClipId,
    binId: audioBinId,
    track: 'a1',
    startSec: target.startSec,
    durationSec: target.durationSec,
    sourceInSec: target.sourceInSec,
    label: `${target.label.replace(/\.[^.]+$/, '')} (Аудио)`,
    autoLength: target.autoLength,
  };

  const nextClips = clips.map((c) => (c.id === target.id ? { ...c, muted: true } : c));
  nextClips.push(audioClip);

  return { nextClips, nextBins, newClipId: newAudioClipId };
}

