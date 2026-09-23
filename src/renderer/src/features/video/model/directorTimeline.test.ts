import { describe, expect, it } from 'vitest';

import {
  moveClipWithRipple,
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

  it('sanitizes legacy overlaps and trims runaway narration', () => {
    const sanitized = sanitizeClips([clip('a', 'v1', 0, 3), clip('b', 'v1', 1, 2)]);
    const lane = sanitized.sort((a, b) => a.startSec - b.startSec);
    expect(lane[1].startSec).toBeGreaterThanOrEqual(3);

    const trimmed = trimRunawayAudioClips([clip('v', 'v1', 0, 5), clip('a', 'a1', 0, 12)]);
    expect(trimmed.find((item) => item.id === 'a')?.durationSec).toBe(5);
  });
});
