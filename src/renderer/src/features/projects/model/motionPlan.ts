/**
 * A long AI shot made of Wan 2.2 TI2V segments.
 * Each segment starts from the previous segment's last frame, so the shot has no cuts.
 */
export interface MotionSegment {
  /** What changes in this segment. Empty uses the chapter's own description. */
  prompt: string;
  seconds: number;
}

export interface MotionPlan {
  seed: number;
  segments: MotionSegment[];
}

const FPS = 24;
/** Frames a continuation loses at its seam (handoff still + two VAE groups settling colour). */
const SEAM_SKIP_FRAMES = 9;
/** Wan latent lengths at 24 fps: 41, 81 and 121 frames. */
export const SEGMENT_SECONDS = [1.7, 3.4, 5] as const;
export const MAX_SEGMENTS = 8;

export function snapSegmentSeconds(seconds: number): number {
  return SEGMENT_SECONDS.reduce((best, option) => (
    Math.abs(option - seconds) < Math.abs(best - seconds) ? option : best
  ), SEGMENT_SECONDS[SEGMENT_SECONDS.length - 1]);
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

/** Enough full 5 s segments to cover the chapter. */
export function defaultMotionPlan(durationSec: number, seed = randomSeed()): MotionPlan {
  const count = Math.max(1, Math.min(MAX_SEGMENTS, Math.ceil(Math.max(1, durationSec) / 5)));
  return { seed, segments: Array.from({ length: count }, () => ({ prompt: '', seconds: 5 })) };
}

/** Joined length before the sharp-frame handoff trims a tail. */
export function motionPlanSeconds(plan: MotionPlan): number {
  const frames = plan.segments.reduce(
    (sum, segment, index) => sum + Math.round(snapSegmentSeconds(segment.seconds) * FPS) - (index ? SEAM_SKIP_FRAMES : 0),
    0,
  );
  return Math.round((frames / FPS) * 10) / 10;
}
