import type { BinItem, TimelineClip, TrackId } from './directorTimeline';
import { clipSpan, fileName, packTrack } from './directorTimeline';
import type { VideoAnalysisContext } from './videoAnalysis';
import type { VoiceoverScript } from './voiceoverScript';

export type VoiceoverStatus = 'idle' | 'analyzed' | 'scripted' | 'voiced';

export interface VoiceoverSession {
  sourcePath: string | null;
  sourceBinId: string | null;
  analysis: VideoAnalysisContext | null;
  script: VoiceoverScript | null;
  scriptPrompt: string;
  /** Reusable product/project facts fed into every script generation. */
  projectContext: string;
  status: VoiceoverStatus;
  expanded: boolean;
}

export interface VoiceoverSource {
  path: string;
  binId: string | null;
  name: string;
  durationSec: number;
  from: 'selected_bin' | 'selected_clip' | 'v1_clip' | 'video_bin' | 'longest_video';
}

export function emptyVoiceoverSession(): VoiceoverSession {
  return {
    sourcePath: null,
    sourceBinId: null,
    analysis: null,
    script: null,
    scriptPrompt: '',
    projectContext: '',
    status: 'idle',
    expanded: false,
  };
}

const LEGACY_SCRIPT_PROMPT = /3D-модели сумки|3D handbag model|handbag model, friendly|обзор 3D-модели/i;

export function applyTemplateVoiceoverDefaults(
  session: VoiceoverSession,
  defaults: { scriptPrompt: string; projectContext: string },
): VoiceoverSession {
  const scriptPrompt = !session.scriptPrompt.trim() || LEGACY_SCRIPT_PROMPT.test(session.scriptPrompt)
    ? defaults.scriptPrompt
    : session.scriptPrompt;
  const projectContext = session.projectContext.trim()
    ? session.projectContext
    : defaults.projectContext;
  if (scriptPrompt === session.scriptPrompt && projectContext === session.projectContext) {
    return session;
  }
  return { ...session, scriptPrompt, projectContext };
}

function binPath(bin: BinItem): string {
  return bin.path;
}

export function binMediaDuration(bin: BinItem): number {
  return Math.max(0.4, bin.durationSec || 0);
}

export function pickLongestVideoBin(bins: BinItem[]): BinItem | null {
  const videos = bins.filter((item) => item.kind === 'video');
  if (videos.length === 0) return null;
  return videos.reduce((best, item) => (
    binMediaDuration(item) > binMediaDuration(best) ? item : best
  ));
}

/** Ignore 2–5s I2V / still-motion clips when a real screencast is on the board. */
export function isVoiceoverWorthyVideo(bin: BinItem, longest: BinItem): boolean {
  const duration = binMediaDuration(bin);
  const top = binMediaDuration(longest);
  if (top >= 8 && duration < 8) return false;
  if (top >= 20 && duration < top * 0.35) return false;
  return true;
}

function asSource(bin: BinItem, from: VoiceoverSource['from']): VoiceoverSource {
  return {
    path: binPath(bin),
    binId: bin.id,
    name: bin.name,
    durationSec: binMediaDuration(bin),
    from,
  };
}

/** Prefer the longest screencast. Short generated clips are never the voiceover source. */
export function resolveVoiceoverSource(
  bins: BinItem[],
  clips: TimelineClip[],
  selectedBin: string | null,
  selectedClip: string | null,
): VoiceoverSource | null {
  const longest = pickLongestVideoBin(bins);
  if (!longest) return null;

  const selected = selectedBin ? bins.find((b) => b.id === selectedBin) : null;
  if (selected?.kind === 'video' && isVoiceoverWorthyVideo(selected, longest)) {
    return asSource(selected, 'selected_bin');
  }

  const clip = selectedClip ? clips.find((c) => c.id === selectedClip) : null;
  if (clip?.binId) {
    const clipBin = bins.find((b) => b.id === clip.binId);
    if (clipBin?.kind === 'video' && isVoiceoverWorthyVideo(clipBin, longest)) {
      return asSource(clipBin, 'selected_clip');
    }
  }

  const v1Clips = clips
    .filter((c) => c.track === 'v1' && c.binId)
    .sort((a, b) => a.startSec - b.startSec);
  for (const v1 of v1Clips) {
    const bin = bins.find((b) => b.id === v1.binId);
    if (bin?.kind === 'video' && isVoiceoverWorthyVideo(bin, longest)) {
      return asSource(bin, 'v1_clip');
    }
  }

  return asSource(longest, longest.id === selected?.id ? 'selected_bin' : 'longest_video');
}

/**
 * How a still from Create sits on the timeline:
 * - intro: full-frame before the screencast (V1)
 * - pip: corner overlay on V2 while the recording plays
 * - off: keep the file in the bin, omit it from the cut
 */
export type StillCompose = 'intro' | 'pip' | 'off';

const INTRO_STILL_SEC = 5;

function imageBins(bins: BinItem[]): BinItem[] {
  return bins.filter((bin) => bin.kind === 'image');
}

function stillDuration(bin: BinItem): number {
  return Math.max(2.5, Math.min(8, clipSpan(bin) || INTRO_STILL_SEC));
}

function withoutImageClips(bins: BinItem[], clips: TimelineClip[]): TimelineClip[] {
  const imgIds = new Set(imageBins(bins).map((bin) => bin.id));
  return clips.filter((clip) => !clip.binId || !imgIds.has(clip.binId));
}

/** Pack V1, then pull every clip back so the picture starts at 0. */
function normalizePictureStart(clips: TimelineClip[]): TimelineClip[] {
  const packed = packTrack(clips, 'v1');
  const first = packed
    .filter((clip) => clip.track === 'v1')
    .sort((a, b) => a.startSec - b.startSec)[0];
  const delta = first?.startSec ?? 0;
  if (delta < 0.05) return packed;
  return packed.map((clip) => ({ ...clip, startSec: Math.max(0, clip.startSec - delta) }));
}

export function inferStillCompose(bins: BinItem[], clips: TimelineClip[]): StillCompose {
  const images = imageBins(bins);
  if (images.length === 0) return 'intro';
  const imgIds = new Set(images.map((bin) => bin.id));
  const imgClips = clips.filter((clip) => clip.binId && imgIds.has(clip.binId));
  if (imgClips.length === 0) return 'off';
  if (imgClips.some((clip) => clip.track !== 'v1')) return 'pip';
  return 'intro';
}

export function applyStillCompose(
  bins: BinItem[],
  clips: TimelineClip[],
  mode: StillCompose,
): TimelineClip[] {
  const images = imageBins(bins);
  const existingByBin = new Map<string, TimelineClip>();
  for (const clip of clips) {
    if (clip.binId && images.some((bin) => bin.id === clip.binId) && !existingByBin.has(clip.binId)) {
      existingByBin.set(clip.binId, clip);
    }
  }
  const base = normalizePictureStart(withoutImageClips(bins, clips));
  if (mode === 'off' || images.length === 0) return base;

  const makeStill = (img: BinItem, track: TrackId, startSec: number): TimelineClip => {
    const prev = existingByBin.get(img.id);
    return {
      id: prev?.id ?? `clip-still-${img.id}`,
      binId: img.id,
      track,
      startSec,
      durationSec: stillDuration(img),
      sourceInSec: 0,
      label: img.name,
      autoLength: true,
    };
  };

  if (mode === 'pip') {
    return [...base, ...images.map((img) => makeStill(img, 'v2', 0))];
  }

  let cursor = 0;
  const stills = images.map((img) => {
    const clip = makeStill(img, 'v1', cursor);
    cursor += clip.durationSec;
    return clip;
  });
  return [...stills, ...base.map((clip) => ({ ...clip, startSec: clip.startSec + cursor }))];
}

/** Keep the long screencast on V1; short AI clips go to V2. Stills follow StillCompose, not this. */
export function demoteShortClipsFromV1(bins: BinItem[], clips: TimelineClip[]): TimelineClip[] {
  const longest = pickLongestVideoBin(bins);
  if (!longest) return packTrack(clips, 'v1');
  const threshold = Math.max(8, binMediaDuration(longest) * 0.35);
  const next = clips.map((clip) => {
    if (clip.track !== 'v1') return clip;
    const bin = bins.find((item) => item.id === clip.binId);
    if (!bin) return clip;
    if (bin.kind === 'image') return clip;
    if (bin.kind === 'video' && bin.id !== longest.id && binMediaDuration(bin) < threshold) {
      return { ...clip, track: 'v2' as const, startSec: 0 };
    }
    return clip;
  });
  return packTrack(next, 'v1');
}

export function voiceoverSourceLabel(source: VoiceoverSource): string {
  return source.name || fileName(source.path);
}
