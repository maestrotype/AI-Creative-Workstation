/**
 * Create feature — Zustand store (state machine).
 *
 * State machine:
 *   step: 'intent' → 'generating' → 'result'
 *                                       ↓ (Try variations)
 *                                    'generating'
 *   step: 'intent' → 'generating' → 'error' (retry / back)
 *
 * All business logic and side-effects live here.
 * UI components select slices and call actions only.
 */
import { create } from 'zustand';

import type { GenerationResult } from '../../../core/types';
import {
  runGeneration,
  GenerationError,
  type GenerationFormat,
  type GenerationStyle,
  type GenerationProgress,
} from '../api/generationApi';
import type { ReferenceImage } from '../../../shared/ui/IntentInput/IntentInput';

/* ─── Types ─────────────────────────────────────────────────────────── */

export type CreateStep = 'intent' | 'generating' | 'result' | 'error';

/** Error shown on ErrorStep. */
export interface GenerationErrorState {
  message: string;
  kind: 'sidecar_unavailable' | 'generation_failed' | 'no_model' | 'gpu_memory';
}

interface CreateState {
  /* ── Current step ────────────────────────────────────────────── */
  step: CreateStep;

  /* ── Intent step ──────────────────────────────────────────────── */
  prompt: string;
  format: GenerationFormat;
  style: GenerationStyle;
  referenceImages: ReferenceImage[];
  setPrompt: (prompt: string) => void;
  setFormat: (format: GenerationFormat) => void;
  setStyle: (style: GenerationStyle) => void;
  setReferenceImages: (images: ReferenceImage[]) => void;

  /* ── Generating step ─────────────────────────────────────────── */
  generationProgress: GenerationProgress | null;
  cancel: (() => void) | null;
  startGeneration: () => void;
  cancelGeneration: () => void;

  /* ── Error step ─────────────────────────────────────────────── */
  error: GenerationErrorState | null;
  retryGeneration: () => void;

  /* ── Result step ──────────────────────────────────────────────── */
  result: GenerationResult | null;
  /** Callback injected by HomePage to push result into recentAssets. */
  onResultReady: ((result: GenerationResult) => void) | null;
  setOnResultReady: (cb: (result: GenerationResult) => void) => void;
  tryVariation: () => void;

  /* ── Navigation ──────────────────────────────────────────────── */
  reset: () => void;
}

/* ─── Initial values ─────────────────────────────────────────────── */

const INITIAL: Pick<
  CreateState,
  'step' | 'prompt' | 'format' | 'style' | 'referenceImages' | 'generationProgress' | 'cancel' | 'result' | 'error'
> = {
  step: 'intent',
  prompt: '',
  format: 'square',
  style: 'subtle',
  referenceImages: [],
  generationProgress: null,
  cancel: null,
  result: null,
  error: null,
};

/* ─── Store ─────────────────────────────────────────────────────────── */

export const useCreateStore = create<CreateState>()((set, get) => ({
  ...INITIAL,
  onResultReady: null,

  /* ── Intent actions ─────────────────────────────────────────── */
  setPrompt: (prompt) => set({ prompt }),
  setFormat: (format) => set({ format }),
  setStyle: (style) => set({ style }),
  setReferenceImages: (images) => set({ referenceImages: images }),

  /* ── Generation ─────────────────────────────────────────────── */
  startGeneration: () => {
    const { prompt, format, style, referenceImages, onResultReady } = get();
    if (!prompt.trim()) return;

    const { promise, cancel } = runGeneration(
      { prompt, format, style, imageDataUrls: referenceImages.map((img) => img.dataUrl) },
      (generationProgress) => set({ generationProgress }),
    );

    set({ step: 'generating', generationProgress: null, cancel, result: null, error: null });

    promise.then((result) => {
      set({ step: 'result', result, generationProgress: null, cancel: null });
      onResultReady?.(result);
    }).catch((err: unknown) => {
      // AbortError means the user cancelled — go back to intent
      if (err instanceof DOMException && err.name === 'AbortError') {
        set({ step: 'intent', generationProgress: null, cancel: null });
      } else {
        // Surface real failures; do not fake a successful result.
        const state: GenerationErrorState =
          err instanceof GenerationError
            ? { message: err.message, kind: err.kind }
            : { message: String(err), kind: 'generation_failed' };
        set({ step: 'error', error: state, generationProgress: null, cancel: null });
      }
    });
  },

  retryGeneration: () => {
    get().startGeneration();
  },

  cancelGeneration: () => {
    get().cancel?.();
    // The catch block in startGeneration handles the state reset
  },

  /* ── Result actions ─────────────────────────────────────────── */
  setOnResultReady: (cb) => set({ onResultReady: cb }),

  tryVariation: () => {
    // Keep the prompt/format/style, just rerun generation
    get().startGeneration();
  },

  /* ── Navigation ─────────────────────────────────────────────── */
  reset: () => set({ ...INITIAL }),
}));
