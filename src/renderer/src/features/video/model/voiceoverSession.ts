import type { BinItem, TimelineClip } from './directorTimeline';
import { fileName } from './directorTimeline';
import type { VideoAnalysisContext } from './videoAnalysis';

export type VoiceoverStatus = 'idle' | 'analyzed' | 'scripted' | 'voiced';

export interface VoiceoverSession {
  sourcePath: string | null;
  sourceBinId: string | null;
  analysis: VideoAnalysisContext | null;
  status: VoiceoverStatus;
  expanded: boolean;
}

export interface VoiceoverSource {
  path: string;
  binId: string | null;
  name: string;
  from: 'selected_bin' | 'selected_clip' | 'v1_clip' | 'video_bin';
}

export function emptyVoiceoverSession(): VoiceoverSession {
  return {
    sourcePath: null,
    sourceBinId: null,
    analysis: null,
    status: 'idle',
    expanded: false,
  };
}

function binPath(bin: BinItem): string {
  return bin.path;
}

/** Pick the best video to voiceover: selection → V1 clip → any video bin. */
export function resolveVoiceoverSource(
  bins: BinItem[],
  clips: TimelineClip[],
  selectedBin: string | null,
  selectedClip: string | null,
): VoiceoverSource | null {
  const selected = selectedBin ? bins.find((b) => b.id === selectedBin) : null;
  if (selected?.kind === 'video') {
    return {
      path: binPath(selected),
      binId: selected.id,
      name: selected.name,
      from: 'selected_bin',
    };
  }

  const clip = selectedClip ? clips.find((c) => c.id === selectedClip) : null;
  if (clip?.binId) {
    const clipBin = bins.find((b) => b.id === clip.binId);
    if (clipBin?.kind === 'video') {
      return {
        path: binPath(clipBin),
        binId: clipBin.id,
        name: clipBin.name,
        from: 'selected_clip',
      };
    }
  }

  const v1Clips = clips
    .filter((c) => c.track === 'v1' && c.binId)
    .sort((a, b) => a.startSec - b.startSec);
  for (const v1 of v1Clips) {
    const bin = bins.find((b) => b.id === v1.binId);
    if (bin?.kind === 'video') {
      return {
        path: binPath(bin),
        binId: bin.id,
        name: bin.name,
        from: 'v1_clip',
      };
    }
  }

  const videoBin = bins.find((b) => b.kind === 'video');
  if (videoBin) {
    return {
      path: binPath(videoBin),
      binId: videoBin.id,
      name: videoBin.name,
      from: 'video_bin',
    };
  }

  return null;
}

export function voiceoverSourceLabel(source: VoiceoverSource): string {
  return source.name || fileName(source.path);
}
