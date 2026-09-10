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

import type { Asset, GenerationResult } from '../../../core/types';
import {
  runGeneration,
  runVideoGeneration,
  GenerationError,
  type CreateJob,
  type GenerationFormat,
  type GenerationStyle,
  type GenerationProgress,
} from '../api/generationApi';
import type { ReferenceImage } from '../../../shared/ui/IntentInput/IntentInput';
import { filePathFromAssetUrl } from '../../studio/store/workspaceBridgeStore';
import { toAssetUrl } from '../../video/model/directorMedia';
import { modeForMedium } from '../model/videoCapability';

/* ─── Types ─────────────────────────────────────────────────────────── */

export type CreateStep = 'intent' | 'generating' | 'result' | 'error';
export type CreateMedium = 'image' | 'video' | 'animate';

/** Error shown on ErrorStep. */
export interface GenerationErrorState {
  message: string;
  kind: 'sidecar_unavailable' | 'generation_failed' | 'no_model' | 'gpu_memory' | 'need_still' | 'no_video_model' | 'video_capability' | 'low_motion';
}

interface CreateState {
  /* ── Current step ────────────────────────────────────────────── */
  step: CreateStep;

  /* ── Intent step ──────────────────────────────────────────────── */
  prompt: string;
  medium: CreateMedium;
  job: CreateJob;
  format: GenerationFormat;
  style: GenerationStyle;
  referenceImages: ReferenceImage[];
  setPrompt: (prompt: string) => void;
  setMedium: (medium: CreateMedium) => void;
  setJob: (job: CreateJob) => void;
  setFormat: (format: GenerationFormat) => void;
  setStyle: (style: GenerationStyle) => void;
  setReferenceImages: (images: ReferenceImage[]) => void;

  /* ── Generating step ─────────────────────────────────────────── */
  generationProgress: GenerationProgress | null;
  cancel: (() => void) | null;
  startGeneration: (stillPath?: string, modelId?: string) => void;
  cancelGeneration: () => void;
  /** Still used when making a clip so variations do not lose the photo. */
  clipStillPath: string | null;

  /* ── Error step ─────────────────────────────────────────────── */
  error: GenerationErrorState | null;
  retryGeneration: () => void;

  /* ── Result step ──────────────────────────────────────────────── */
  result: GenerationResult | null;
  /** Callback injected by HomePage to push result into recentAssets. */
  onResultReady: ((result: GenerationResult) => void) | null;
  setOnResultReady: (cb: (result: GenerationResult) => void) => void;
  tryVariation: () => void;
  makeClipFromResult: () => void;
  animateFromResult: () => void;
  /** Back to intent with the same prompt / refs so the user can edit or drop the reference. */
  startOver: () => void;
  /** Open a home-grid still on the result step (variation / download / delete). */
  openFromAsset: (asset: Asset) => void;

  /* ── Navigation ──────────────────────────────────────────────── */
  reset: () => void;
}

/* ─── Initial values ─────────────────────────────────────────────── */

const INITIAL: Pick<
  CreateState,
  'step' | 'prompt' | 'medium' | 'job' | 'format' | 'style' | 'referenceImages' | 'generationProgress' | 'cancel' | 'result' | 'error' | 'clipStillPath'
> = {
  step: 'intent',
  prompt: '',
  medium: 'image',
  job: 'title',
  format: 'wide',
  style: 'subtle',
  referenceImages: [],
  generationProgress: null,
  cancel: null,
  result: null,
  error: null,
  clipStillPath: null,
};

function isVideoPath(path: string | null | undefined): boolean {
  return Boolean(path && /\.(mp4|mov|m4v|webm|mkv)(\?|$)/i.test(path));
}

function stillFromState(state: {
  referenceImages: ReferenceImage[];
  result: GenerationResult | null;
  clipStillPath: string | null;
}): { path?: string; dataUrl?: string } {
  const photo = state.referenceImages.find((ref) => ref.kind !== 'video');
  if (photo?.sourcePath) return { path: photo.sourcePath };
  if (state.clipStillPath && !isVideoPath(state.clipStillPath)) return { path: state.clipStillPath };
  const resultPath = filePathFromAssetUrl(state.result?.thumbnailUrl);
  if (resultPath && !isVideoPath(resultPath)) return { path: resultPath };
  if (photo?.dataUrl) return { dataUrl: photo.dataUrl };
  return {};
}

/* ─── Store ─────────────────────────────────────────────────────────── */

export const useCreateStore = create<CreateState>()((set, get) => ({
  ...INITIAL,
  onResultReady: null,

  /* ── Intent actions ─────────────────────────────────────────── */
  setPrompt: (prompt) => set({ prompt }),
  setMedium: (medium) => set({
    medium,
    format: medium === 'image' ? get().format : 'wide',
  }),
  setJob: (job) => set({
    job,
    format: job === 'product' ? 'square' : 'wide',
  }),
  setFormat: (format) => set({ format }),
  setStyle: (style) => set({ style }),
  setReferenceImages: (images) => set({ referenceImages: images }),

  /* ── Generation ─────────────────────────────────────────────── */
  startGeneration: (stillPath, modelId) => {
    const state = get();
    const { prompt, format, style, job, medium, referenceImages, onResultReady } = state;
    if (!prompt.trim()) return;

    set({ step: 'generating', generationProgress: null, cancel: null, result: null, error: null });

    const still = stillPath ? { path: stillPath } : stillFromState(state);
    if ((medium === 'video' || medium === 'animate') && still.path) {
      set({ clipStillPath: still.path });
    }

    const videoMode = modeForMedium(medium);
    const { promise, cancel } = videoMode
      ? runVideoGeneration(
        {
          prompt,
          format,
          imagePath: still.path,
          imageDataUrl: still.path ? undefined : still.dataUrl,
          mode: videoMode,
          modelId: modelId || undefined,
        },
        (generationProgress) => set({ generationProgress }),
      )
      : runGeneration(
        { prompt, format, style, job, imageDataUrls: referenceImages.map((img) => img.dataUrl) },
        (generationProgress) => set({ generationProgress }),
      );

    set({ cancel });

    promise.then((result) => {
      set({ step: 'result', result, generationProgress: null, cancel: null });
      onResultReady?.(result);
    }).catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') {
        set({ step: 'intent', generationProgress: null, cancel: null });
      } else {
        const mapped: GenerationErrorState =
          err instanceof GenerationError
            ? { message: err.message, kind: err.kind }
            : { message: String(err), kind: 'generation_failed' };
        set({ step: 'error', error: mapped, generationProgress: null, cancel: null });
      }
    });
  },

  retryGeneration: () => {
    get().startGeneration();
  },

  cancelGeneration: () => {
    get().cancel?.();
  },

  /* ── Result actions ─────────────────────────────────────────── */
  setOnResultReady: (cb) => set({ onResultReady: cb }),

  tryVariation: () => {
    const state = get();
    const resultPath = filePathFromAssetUrl(state.result?.thumbnailUrl);
    if (state.result?.kind === 'video' || isVideoPath(resultPath)) {
      get().startGeneration(state.clipStillPath || undefined);
      return;
    }
    get().startGeneration();
  },

  makeClipFromResult: () => {
    const still = filePathFromAssetUrl(get().result?.thumbnailUrl);
    if (!still || isVideoPath(still)) return;
    set({ medium: 'video', clipStillPath: still });
    get().startGeneration(still);
  },

  animateFromResult: () => {
    const still = stillFromState(get()).path;
    if (!still || isVideoPath(still)) return;
    set({ medium: 'animate', clipStillPath: still });
    get().startGeneration(still);
  },

  startOver: () => {
    get().cancel?.();
    set({
      step: 'intent',
      generationProgress: null,
      cancel: null,
      result: null,
      error: null,
    });
  },

  openFromAsset: (asset) => {
    const mediaPath = (asset.kind === 'video' && isVideoPath(asset.id))
      ? asset.id
      : filePathFromAssetUrl(asset.thumbnailUrl);
    const video = asset.kind === 'video' || isVideoPath(mediaPath);
    const storedPrompt = (asset.prompt || '').trim();
    const nameIsJobId = /^vid_[a-f0-9]+$/i.test((asset.name || '').trim());
    const prompt = storedPrompt || (nameIsJobId ? '' : asset.name);
    set({
      step: 'result',
      medium: video ? 'video' : 'image',
      result: {
        id: asset.id,
        prompt: prompt || asset.name,
        thumbnailUrl: mediaPath
          ? toAssetUrl(mediaPath)
          : asset.thumbnailUrl,
        createdAt: asset.updatedAt,
        kind: video ? 'video' : 'image',
        capability: asset.capability ?? undefined,
        providerId: asset.providerId ?? undefined,
        videoStatus: asset.videoStatus ?? undefined,
        promptConsumed: asset.promptConsumed ?? undefined,
        quality: asset.quality ?? undefined,
      },
      error: null,
      generationProgress: null,
      cancel: null,
    });
    if (video && mediaPath && window.api?.probeMediaDuration && !(asset.quality?.duration_sec)) {
      void window.api.probeMediaDuration(mediaPath).then((sec) => {
        if (!(sec > 0)) return;
        const current = get().result;
        if (!current || current.id !== asset.id) return;
        set({
          result: {
            ...current,
            quality: {
              ...current.quality,
              duration_sec: Math.round(sec * 1000) / 1000,
            },
          },
        });
      }).catch(() => undefined);
    }
  },

  /* ── Navigation ─────────────────────────────────────────────── */
  reset: () => set({ ...INITIAL }),
}));
