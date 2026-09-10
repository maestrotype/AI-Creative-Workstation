import type { BinItem, TimelineClip } from './directorTimeline';

export const SCREENCAST_MIN_SEC = 8;

export function binDuration(bin: BinItem): number {
  return Math.max(0.4, bin.durationSec || 0);
}

export function hasScreencastBin(bins: BinItem[]): boolean {
  return bins.some((bin) => bin.kind === 'video' && binDuration(bin) >= SCREENCAST_MIN_SEC);
}

export function v1Clips(clips: TimelineClip[]): TimelineClip[] {
  return clips.filter((clip) => clip.track === 'v1').sort((a, b) => a.startSec - b.startSec);
}

/** Stable id of the current picture cut. Used to invalidate narration/preview. */
export function visualTimelineFingerprint(clips: TimelineClip[], bins: BinItem[]): string {
  return v1Clips(clips).map((clip) => {
    const bin = bins.find((item) => item.id === clip.binId);
    return [
      clip.startSec.toFixed(2),
      clip.durationSec.toFixed(2),
      clip.sourceInSec.toFixed(2),
      bin?.path ?? '',
      bin?.kind ?? '',
    ].join('|');
  }).join(';');
}

export function v1NeedsAssembledPreview(clips: TimelineClip[]): boolean {
  return v1Clips(clips).length > 1;
}
