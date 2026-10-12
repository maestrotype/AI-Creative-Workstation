import { describe, expect, it } from 'vitest';

import {
  contiguousNarrationStarts,
  exciseTimelineRange,
  moveClipWithRipple,
  resizeClipAndRipple,
  sanitizeClips,
  splitClipAt,
  trimRunawayAudioClips,
  type TimelineClip,
} from './directorTimeline';

function clip(id: string, track: TimelineClip['track'], startSec: number, durationSec: number): TimelineClip {
  return {
    id,
    binId: `bin-${id}`,
    track,
    startSec,
    durationSec,
    sourceInSec: 1,
    label: id,
  };
}

describe('director timeline editing', () => {
  it('places narration clips flush, with no seam between scenes', () => {
    expect(contiguousNarrationStarts([33.68, 8.06, 7.5])).toEqual([0, 33.68, 41.74]);
  });

  it('splits without changing source coverage', () => {
    const result = splitClipAt([clip('a', 'v1', 2, 6)], 'a', 5);
    expect(result).toHaveLength(2);
    expect(result[0].durationSec + result[1].durationSec).toBe(6);
    expect(result[1].sourceInSec).toBe(4);
    expect(result[1].startSec).toBe(5);
  });

  it('ripples clips without overlap', () => {
    const result = moveClipWithRipple([
      clip('a', 'v1', 0, 2),
      clip('b', 'v1', 2, 2),
      clip('c', 'v1', 4, 2),
    ], 'c', 0);
    const lane = result.filter((item) => item.track === 'v1').sort((a, b) => a.startSec - b.startSec);
    expect(lane.map((item) => item.id)).toEqual(['c', 'a', 'b']);
    for (let i = 1; i < lane.length; i += 1) {
      expect(lane[i].startSec).toBeGreaterThanOrEqual(lane[i - 1].startSec + lane[i - 1].durationSec);
    }
  });

  it('cuts a middle span out and closes the gap on every track', () => {
    const result = exciseTimelineRange([
      clip('picture', 'v1', 0, 40),
      clip('voice', 'a1', 0, 40),
      clip('later', 'v1', 40, 10),
    ], 12, 18);
    const picture = result.filter((item) => item.track === 'v1').sort((a, b) => a.startSec - b.startSec);
    expect(picture.map((item) => [item.startSec, item.durationSec])).toEqual([
      [0, 12],
      [12, 22],
      [34, 10],
    ]);
    expect(picture[1].sourceInSec).toBe(19);
    const voice = result.filter((item) => item.track === 'a1');
    expect(voice.map((item) => [item.startSec, item.durationSec])).toEqual([[0, 12], [12, 22]]);
  });

  it('drops a clip that sits entirely inside the cut', () => {
    const result = exciseTimelineRange([
      clip('keep', 'v1', 0, 5),
      clip('gone', 'v1', 6, 2),
      clip('after', 'v1', 10, 4),
    ], 5.5, 9);
    expect(result.map((item) => item.id)).toEqual(['keep', 'after']);
    expect(result.find((item) => item.id === 'after')?.startSec).toBe(6.5);
  });

  it('pushes later clips when a replaced chapter is longer', () => {
    const result = resizeClipAndRipple([
      clip('chapter', 'v1', 12, 20),
      clip('next', 'v1', 32, 10),
      clip('voice', 'a1', 32, 8),
    ], 'chapter', 30);
    expect(result.find((item) => item.id === 'chapter')?.durationSec).toBe(30);
    expect(result.find((item) => item.id === 'next')?.startSec).toBe(42);
    expect(result.find((item) => item.id === 'voice')?.startSec).toBe(42);
  });

  it('sanitizes legacy overlaps and trims runaway narration', () => {
    const sanitized = sanitizeClips([clip('a', 'v1', 0, 3), clip('b', 'v1', 1, 2)]);
    const lane = sanitized.sort((a, b) => a.startSec - b.startSec);
    expect(lane[1].startSec).toBeGreaterThanOrEqual(3);

    const trimmed = trimRunawayAudioClips([clip('v', 'v1', 0, 5), clip('a', 'a1', 0, 12)]);
    expect(trimmed.find((item) => item.id === 'a')?.durationSec).toBe(5);
  });
});
