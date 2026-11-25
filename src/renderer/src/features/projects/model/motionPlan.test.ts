import { describe, expect, it } from 'vitest';

import { defaultMotionPlan, MAX_SEGMENTS, motionPlanSeconds, snapSegmentSeconds } from './motionPlan';

describe('motion plan', () => {
  it('covers the chapter with full segments', () => {
    const plan = defaultMotionPlan(14, 7);
    expect(plan.seed).toBe(7);
    expect(plan.segments).toHaveLength(3);
    expect(plan.segments.every((segment) => segment.seconds === 5)).toBe(true);
    expect(defaultMotionPlan(400).segments).toHaveLength(MAX_SEGMENTS);
  });

  it('snaps to the lengths Wan can render', () => {
    expect(snapSegmentSeconds(2)).toBe(1.7);
    expect(snapSegmentSeconds(3)).toBe(3.4);
    expect(snapSegmentSeconds(9)).toBe(5);
  });

  it('subtracts the frames dropped at each seam', () => {
    expect(motionPlanSeconds({ seed: 1, segments: [{ prompt: '', seconds: 5 }] })).toBe(5);
    expect(motionPlanSeconds({ seed: 1, segments: [{ prompt: '', seconds: 5 }, { prompt: '', seconds: 5 }] })).toBe(9.6);
  });
});
