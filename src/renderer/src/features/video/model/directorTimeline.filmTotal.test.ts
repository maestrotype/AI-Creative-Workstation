import { describe, expect, it } from 'vitest';

import { filmTotalSec, trimRunawayAudioClips, type TimelineClip } from './directorTimeline';

function clip(track: string, startSec: number, durationSec: number): TimelineClip {
  return {
    id: `${track}-${startSec}`,
    binId: 'bin',
    track: track as TimelineClip['track'],
    startSec,
    durationSec,
    sourceInSec: 0,
    label: track,
  };
}

describe('filmTotalSec', () => {
  it('ends with the picture on a short imported cut — no empty 8s pad', () => {
    expect(filmTotalSec([clip('v1', 0, 6)], [], 6)).toBe(6);
  });

  it('keeps a short audio overhang, not a blank ruler past the media', () => {
    expect(filmTotalSec([
      clip('v1', 0, 6),
      clip('a1', 0, 6.4),
    ], [], 6)).toBeCloseTo(6.4, 5);
  });

  it('keeps an empty canvas at 8s until media lands', () => {
    expect(filmTotalSec([], [], 0)).toBe(8);
  });

  it('does not chop a short respeak overhang on the picture', () => {
    const clips = [
      clip('v1', 0, 6),
      clip('a1', 0, 6.8),
    ];
    expect(trimRunawayAudioClips(clips)).toBe(clips);
  });
});
