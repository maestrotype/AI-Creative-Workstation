import type { BinItem, TimelineClip } from './directorTimeline';
import { fileName, packTrack } from './directorTimeline';
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

/** Keep the screencast on V1; shove short AI clips and stills onto V2 as overlays. */
export function demoteShortClipsFromV1(bins: BinItem[], clips: TimelineClip[]): TimelineClip[] {
  const longest = pickLongestVideoBin(bins);
  if (!longest) return packTrack(clips, 'v1');
  const threshold = Math.max(8, binMediaDuration(longest) * 0.35);
  const next = clips.map((clip) => {
    if (clip.track !== 'v1') return clip;
    const bin = bins.find((item) => item.id === clip.binId);
    if (!bin) return clip;
    if (bin.kind === 'image') {
      return { ...clip, track: 'v2' as const, startSec: 0 };
    }
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
