/**
 * Create feature — generation API (local Python sidecar).
 *
 * Calls the FastAPI sidecar on 127.0.0.1:57291 and surfaces real errors
 * (sidecar unavailable / model failure) instead of faking success.
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
  /** >0 — оценка оставшегося времени; 0 — неизвестно (UI показывает прошедшее) */
  readonly estimatedSecondsLeft: number;
  /** Секунд с момента отправки запроса */
  readonly elapsedSeconds: number;
}

/** Ошибка генерации с типом, чтобы UI мог показать подходящий текст. */
export class GenerationError extends Error {
  constructor(
    message: string,
    public readonly kind: 'sidecar_unavailable' | 'generation_failed',
  ) {
    super(message);
    this.name = 'GenerationError';
  }
}

/* ─── Constants ─────────────────────────────────────────────────────── */

const SIDECAR_URL = 'http://127.0.0.1:57291';

/** Fallback-модель, если DB недоступна (чистый браузерный dev). */
const FALLBACK_MODEL_ID = 'OFA-Sys/small-stable-diffusion-v0';

/** Creative-language progress messages shown while the model is working. */
const PROGRESS_MESSAGES: readonly string[] = [
  'Interpreting your vision…',
  'Composing the scene…',
  'Placing light and shadow…',
  'Building depth and atmosphere…',
  'Refining details…',
  'Finalising the image…',
];

/** За сколько мс "косметический" прогресс доходит до 95%. */
const PROGRESS_RAMP_MS = 45_000;
const TICK_INTERVAL_MS = 80;

/* ─── Public API ────────────────────────────────────────────────────── */

/**
 * Runs a real generation on the local sidecar. Calls `onProgress` on every tick
 * and resolves with a `GenerationResult` when complete.
 *
 * Rejects with `GenerationError` on real failures (sidecar down, model error) —
 * UI показывает её пользователю вместо имитации успеха.
 *
 * Returns a cancel function — call it to abort waiting for the result.
 */
export function runGeneration(
  options: GenerationOptions,
  onProgress: (progress: GenerationProgress) => void,
): { promise: Promise<GenerationResult>; cancel: () => void } {
  let cancelled = false;
  const controller = new AbortController();
  const startedAt = Date.now();

  // Реальный инференс пока не шлёт прогресс-событий (в будущем — SSE),
  // поэтому плавно двигаем полосу до 95%, пока ждём результат.
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

      // Находим установленную модель
      let selectedModelId = FALLBACK_MODEL_ID;
      if (window.api) {
        const models = await window.api.getModels();
        // Ищем нормальную модель (не Tiny SD) которая готова, либо берем первую готовую
        const readyModels = models.filter((m) => m.status === 'ready');
        const bestModel = readyModels.find((m) => !m.id.includes('small-stable-diffusion')) || readyModels[0];
        if (bestModel) selectedModelId = bestModel.id;
      }

      let res: Response;
      try {
        res = await fetch(`${SIDECAR_URL}/api/generate/image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: options.prompt,
            format: options.format,
            style: options.style,
            model_id: selectedModelId,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          throw new DOMException('Generation cancelled', 'AbortError');
        }
        // Сеть недоступна: sidecar не запущен или ещё стартует (импорт torch ~10-30 c)
        throw new GenerationError(
          'Local AI engine is not responding. It may still be starting — try again in a few seconds.',
          'sidecar_unavailable',
        );
      }

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body: unknown = await res.json();
          if (body && typeof body === 'object' && 'detail' in body) {
            detail += `: ${String((body as { detail: unknown }).detail).slice(0, 300)}`;
          }
        } catch {
          /* non-JSON error body */
        }
        throw new GenerationError(detail, 'generation_failed');
      }

      const data = (await res.json()) as { job_id: string; file_path?: string | null };
      if (cancelled) throw new DOMException('Generation cancelled', 'AbortError');

      onProgress({ progress: 1, message: 'Done!', estimatedSecondsLeft: 0, elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000) });

      // Build asset:// URL from the absolute file path returned by the server
      const assetUrl = data.file_path ? `asset://${data.file_path}` : null;

      return {
        id: data.job_id,
        prompt: options.prompt,
        thumbnailUrl: assetUrl,
        createdAt: new Date().toISOString(),
      };
    } finally {
      clearInterval(ticker);
    }
  })();

  const cancel = () => {
    cancelled = true;
    controller.abort();
  };

  return { promise, cancel };
}
