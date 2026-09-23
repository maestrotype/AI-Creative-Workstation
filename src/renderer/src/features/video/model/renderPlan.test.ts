import { describe, expect, it } from 'vitest';

import { normalizeCallout } from './callout';
import { buildRenderPlan } from './renderPlan';

describe('buildRenderPlan', () => {
  it('uses vertical settings and preserves audio/hint composition', () => {
    const plan = buildRenderPlan({
      format: 'shorts',
      bins: [{
        id: 'audio',
        kind: 'audio',
        path: '/tmp/voice.wav',
        name: 'voice',
        durationSec: 3,
        inSec: 0,
        outSec: 3,
      }],
      clips: [{
        id: 'clip',
        binId: 'audio',
        track: 'a1',
        startSec: 1,
        durationSec: 2,
        sourceInSec: 0,
        label: 'voice',
        volume: 0.7,
      }],
      callouts: [normalizeCallout({
        id: 'hint',
        startSec: 0,
        endSec: 2,
        targetX: 20,
        targetY: 30,
        boxX: 25,
        boxY: 35,
        text: 'Checkout',
        type: 'card',
      })],
      overlayPos: { v2: { x: 70, y: 10 } },
    });

    expect([plan.width, plan.height]).toEqual([1080, 1920]);
    expect(plan.clips[0].volume).toBe(0.7);
    expect(plan.callouts?.[0].type).toBe('card');
    expect(plan.overlay_positions.v2).toEqual({ x: 70, y: 10 });
  });
});
