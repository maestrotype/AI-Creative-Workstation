/**
 * Create feature — mock generation API.
 *
 * Simulates the local-first generation pipeline with progressive
 * status messages. In production this will be replaced with a
 * FastAPI sidecar call (local) or fal.ai fetch (cloud), without
 * touching the store or UI code.
 */
import type { GenerationResult } from '../../../core/types';

/* ─── Types ─────────────────────────────────────────────────────────── */

export type GenerationFormat = 'square' | 'portrait' | 'wide';
export type GenerationStyle = 'subtle' | 'cinematic' | 'bold';

export interface GenerationOptions {
  readonly prompt: string;
  readonly format: GenerationFormat;
  readonly style: GenerationStyle;
}

export interface GenerationProgress {
  /** 0–1 */
  readonly progress: number;
  readonly message: string;
  readonly estimatedSecondsLeft: number;
}

/* ─── Constants ─────────────────────────────────────────────────────── */

/** Creative-language progress messages shown during generation. */
const PROGRESS_MESSAGES: readonly string[] = [
  'Interpreting your vision…',
  'Composing the scene…',
  'Placing light and shadow…',
  'Building depth and atmosphere…',
  'Refining details…',
  'Finalising the image…',
];

/** Total mock generation time in ms. */
const GENERATION_DURATION_MS = 5_200;
const TICK_INTERVAL_MS = 80;

/* ─── Public API ────────────────────────────────────────────────────── */

/**
 * Runs a mock generation pipeline. Calls `onProgress` on every tick
 * and resolves with a `GenerationResult` when complete.
 *
 * Returns a cancel function — call it to abort mid-generation.
 */
export function runGeneration(
  options: GenerationOptions,
  onProgress: (progress: GenerationProgress) => void,
): { promise: Promise<GenerationResult>; cancel: () => void } {
  let cancelled = false;
  let intervalId: ReturnType<typeof setInterval>;

  const promise = new Promise<GenerationResult>((resolve, reject) => {
    const startTime = Date.now();

    intervalId = setInterval(() => {
      if (cancelled) {
        clearInterval(intervalId);
        reject(new DOMException('Generation cancelled', 'AbortError'));
        return;
      }

      const elapsed = Date.now() - startTime;
      const rawProgress = Math.min(elapsed / GENERATION_DURATION_MS, 1);
      // Ease the progress so it feels organic (slows near 100%)
      const progress = 1 - Math.pow(1 - rawProgress, 2.5);

      const messageIndex = Math.min(
        Math.floor(rawProgress * PROGRESS_MESSAGES.length),
        PROGRESS_MESSAGES.length - 1,
      );
      const estimatedSecondsLeft = Math.ceil(
        ((GENERATION_DURATION_MS - elapsed) / 1_000),
      );

      onProgress({
        progress,
        message: PROGRESS_MESSAGES[messageIndex],
        estimatedSecondsLeft: Math.max(0, estimatedSecondsLeft),
      });

      if (rawProgress >= 1) {
        clearInterval(intervalId);
        resolve({
          id: `gen-${Date.now()}`,
          prompt: options.prompt,
          thumbnailUrl: null, // Real URL comes from inference in production
          createdAt: new Date().toISOString(),
        });
      }
    }, TICK_INTERVAL_MS);
  });

  const cancel = () => {
    cancelled = true;
    clearInterval(intervalId);
  };

  return { promise, cancel };
}
