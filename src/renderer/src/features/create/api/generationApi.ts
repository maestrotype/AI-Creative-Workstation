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
export type CreateJob = 'title' | 'frame' | 'product';
export type GenerationErrorKind =
  | 'sidecar_unavailable'
  | 'generation_failed'
  | 'no_model'
  | 'gpu_memory'
  | 'need_still'
  | 'no_video_model'
  | 'video_capability'
  | 'low_motion';

export interface GenerationOptions {
  readonly prompt: string;
  readonly format: GenerationFormat;
  readonly style: GenerationStyle;
  readonly job?: CreateJob;
  readonly modelId?: string;
  readonly imageDataUrl?: string;
  readonly imageDataUrls?: string[];
}

export interface VideoGenerationOptions {
  readonly prompt: string;
  readonly format: GenerationFormat;
  readonly modelId?: string;
  readonly imagePath?: string;
  readonly imageDataUrl?: string;
  readonly durationSec?: number;
  readonly mode?: 'ai_video' | 'image_animation' | 't2v';
  readonly numFrames?: number;
  readonly shotIndex?: number;
  readonly shotTotal?: number;
  readonly seed?: number;
}

const VIDEO_PROGRESS_MESSAGES: readonly string[] = [
  'Reading the still…',
  'Planning motion…',
  'Drawing frames…',
  'Encoding the clip…',
];

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
        job: options.job,
        model_id: options.modelId,
        image_base64: options.imageDataUrl,
        images_base64: options.imageDataUrls,
      });

      if (cancelled) throw new DOMException('Generation cancelled', 'AbortError');

      onProgress({ progress: 1, message: 'Done!', estimatedSecondsLeft: 0, elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000) });

      const assetUrl = data.file_path
        ? `asset://${data.file_path}?v=${encodeURIComponent(data.job_id)}`
        : null;

      return {
        id: data.job_id,
        prompt: options.prompt,
        thumbnailUrl: assetUrl,
        createdAt: new Date().toISOString(),
        kind: 'image',
      };
    } catch (err) {
      if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) {
        throw new DOMException('Generation cancelled', 'AbortError');
      }
      if (err instanceof GenerationError) throw err;
      const msg = (err instanceof Error ? err.message : String(err))
        .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '');
      if (msg === 'NO_MODEL' || msg.includes('NO_MODEL')) {
        throw new GenerationError(msg, 'no_model');
      }
      if (/sidecar|did not become ready|unavailable/i.test(msg)) {
        throw new GenerationError(msg, 'sidecar_unavailable');
      }
      if (/MPS_OOM|placeholder storage|not been allocated on MPS|Invalid buffer size|out of memory/i.test(msg)) {
        throw new GenerationError(msg, 'gpu_memory');
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

const VIDEO_RAMP_MS = 180_000;

function mapGenerationError(err: unknown, cancelled: boolean): never {
  if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) {
    throw new DOMException('Generation cancelled', 'AbortError');
  }
  if (err instanceof GenerationError) throw err;
  const msg = (err instanceof Error ? err.message : String(err))
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '');
  if (msg === 'NO_MODEL' || msg.includes('NO_MODEL')) {
    throw new GenerationError(msg, 'no_model');
  }
  if (msg === 'NO_VIDEO_MODEL' || msg.includes('NO_VIDEO_MODEL') || msg.includes('VIDEO_MODEL_MISSING') || msg.includes('H3_REQUIRED')) {
    throw new GenerationError(msg, 'no_video_model');
  }
  if (msg.includes('VIDEO_CAPABILITY_UNSUPPORTED')) {
    throw new GenerationError(msg, 'video_capability');
  }
  if (msg.includes('LOW_MOTION')) {
    throw new GenerationError(msg, 'low_motion');
  }
  if (msg === 'IMAGE_REQUIRED' || msg.includes('IMAGE_REQUIRED')) {
    throw new GenerationError(msg, 'need_still');
  }
  if (/sidecar|did not become ready|unavailable/i.test(msg)) {
    throw new GenerationError(msg, 'sidecar_unavailable');
  }
  if (/MPS_OOM|placeholder storage|not been allocated on MPS|Invalid buffer size|out of memory/i.test(msg)) {
    throw new GenerationError(msg, 'gpu_memory');
  }
  throw new GenerationError(msg, 'generation_failed');
}

export function runVideoGeneration(
  options: VideoGenerationOptions,
  onProgress: (progress: GenerationProgress) => void,
): { promise: Promise<GenerationResult>; cancel: () => void } {
  let cancelled = false;
  const startedAt = Date.now();

  const ticker = setInterval(() => {
    if (cancelled) return;
    const raw = Math.min((Date.now() - startedAt) / VIDEO_RAMP_MS, 1);
    const eased = 0.95 * (1 - Math.pow(1 - raw, 2));
    const messageIndex = Math.min(
      Math.floor(raw * VIDEO_PROGRESS_MESSAGES.length),
      VIDEO_PROGRESS_MESSAGES.length - 1,
    );
    onProgress({
      progress: eased,
      message: VIDEO_PROGRESS_MESSAGES[messageIndex],
      estimatedSecondsLeft: 0,
      elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
    });
  }, TICK_INTERVAL_MS);

  const promise = (async (): Promise<GenerationResult> => {
    try {
      onProgress({ progress: 0.02, message: VIDEO_PROGRESS_MESSAGES[0], estimatedSecondsLeft: 0, elapsedSeconds: 0 });
      if (!window.api?.generateVideo) {
        throw new GenerationError(
          'Local AI engine is not available in this window.',
          'sidecar_unavailable',
        );
      }
      const data = await window.api.generateVideo({
        prompt: options.prompt,
        format: options.format,
        duration_sec: options.durationSec ?? 5,
        model_id: options.modelId,
        image_path: options.imagePath,
        image_base64: options.imageDataUrl,
        mode: options.mode ?? 'ai_video',
        num_frames: options.numFrames,
        shot_index: options.shotIndex,
        shot_total: options.shotTotal,
        seed: options.seed,
      });
      if (cancelled) throw new DOMException('Generation cancelled', 'AbortError');
      onProgress({ progress: 1, message: 'Done!', estimatedSecondsLeft: 0, elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000) });
      const assetUrl = data.file_path
        ? `asset://${data.file_path}?v=${encodeURIComponent(data.job_id)}`
        : null;
      return {
        id: data.job_id,
        prompt: options.prompt,
        thumbnailUrl: assetUrl,
        createdAt: new Date().toISOString(),
        kind: 'video',
        capability: data.capability,
        providerId: data.provider_id,
        videoStatus: data.status,
        promptConsumed: data.prompt_consumed,
        quality: data.quality ?? undefined,
      };
    } catch (err) {
      mapGenerationError(err, cancelled);
    } finally {
      clearInterval(ticker);
    }
  })();

  const cancel = () => {
    cancelled = true;
  };

  return { promise, cancel };
}
