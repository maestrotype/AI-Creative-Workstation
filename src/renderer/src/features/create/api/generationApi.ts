/**
 * Create feature — generation API.
 *
 * Generation goes through Electron main (not a renderer fetch to :57291),
 * so the sidecar can be started/restarted and CORS/PNA cannot block it.
 */
import type { GenerationResult } from '../../../core/types';

/* ─── Types ─────────────────────────────────────────────────────────── */

export type GenerationFormat = 'square' | 'portrait' | 'wide';
export type GenerationStyle = 'subtle' | 'cinematic' | 'bold';
export type GenerationErrorKind = 'sidecar_unavailable' | 'generation_failed' | 'no_model';

export interface GenerationOptions {
  readonly prompt: string;
  readonly format: GenerationFormat;
  readonly style: GenerationStyle;
  readonly modelId?: string;
  readonly imageDataUrl?: string;
}

export interface GenerationProgress {
  /** 0–1 */
  readonly progress: number;
  readonly message: string;
  /** Remaining seconds estimate; 0 means unknown (UI shows elapsed). */
  readonly estimatedSecondsLeft: number;
  /** Seconds since the request was sent. */
  readonly elapsedSeconds: number;
}

/** Generation failure shown on ErrorStep. */
export class GenerationError extends Error {
  constructor(
    message: string,
    public readonly kind: GenerationErrorKind,
  ) {
    super(message);
    this.name = 'GenerationError';
  }
}

const PROGRESS_MESSAGES: readonly string[] = [
  'Interpreting your vision…',
  'Composing the scene…',
  'Placing light and shadow…',
  'Building depth and atmosphere…',
  'Refining details…',
  'Finalising the image…',
];

const PROGRESS_RAMP_MS = 45_000;
const TICK_INTERVAL_MS = 80;

export function runGeneration(
  options: GenerationOptions,
  onProgress: (progress: GenerationProgress) => void,
): { promise: Promise<GenerationResult>; cancel: () => void } {
  let cancelled = false;
  const startedAt = Date.now();

  const ticker = setInterval(() => {
    if (cancelled) return;
    const raw = Math.min((Date.now() - startedAt) / PROGRESS_RAMP_MS, 1);
    const eased = 0.95 * (1 - Math.pow(1 - raw, 2));
    const messageIndex = Math.min(Math.floor(raw * PROGRESS_MESSAGES.length), PROGRESS_MESSAGES.length - 1);
    onProgress({
      progress: eased,
      message: PROGRESS_MESSAGES[messageIndex],
      estimatedSecondsLeft: 0,
      elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
    });
  }, TICK_INTERVAL_MS);

  const promise = (async (): Promise<GenerationResult> => {
    try {
      onProgress({ progress: 0.02, message: 'Starting generation engine...', estimatedSecondsLeft: 0, elapsedSeconds: 0 });

      if (!window.api?.generateImage) {
        throw new GenerationError(
          'Local AI engine is not available in this window.',
          'sidecar_unavailable',
        );
      }

      const data = await window.api.generateImage({
        prompt: options.prompt,
        format: options.format,
        style: options.style,
        model_id: options.modelId,
        image_base64: options.imageDataUrl,
      });

      if (cancelled) throw new DOMException('Generation cancelled', 'AbortError');

      onProgress({ progress: 1, message: 'Done!', estimatedSecondsLeft: 0, elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000) });

      const assetUrl = data.file_path ? `asset://${data.file_path}` : null;

      return {
        id: data.job_id,
        prompt: options.prompt,
        thumbnailUrl: assetUrl,
        createdAt: new Date().toISOString(),
      };
    } catch (err) {
      if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) {
        throw new DOMException('Generation cancelled', 'AbortError');
      }
      if (err instanceof GenerationError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'NO_MODEL' || msg.includes('NO_MODEL')) {
        throw new GenerationError(msg, 'no_model');
      }
      if (/sidecar|did not become ready|unavailable/i.test(msg)) {
        throw new GenerationError(msg, 'sidecar_unavailable');
      }
      throw new GenerationError(msg, 'generation_failed');
    } finally {
      clearInterval(ticker);
    }
  })();

  const cancel = () => {
    cancelled = true;
  };

  return { promise, cancel };
}
