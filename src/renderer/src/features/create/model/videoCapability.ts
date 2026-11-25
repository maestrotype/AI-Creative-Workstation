/**
 * Keep in sync with sidecar/video_capability.py
 */
export type VideoCapability = 'IMAGE_ANIMATION' | 'IMAGE_TO_VIDEO' | 'TEXT_TO_VIDEO';
export type VideoGenMode = 'ai_video' | 'image_animation' | 't2v';
export type VideoRuntime = 'local' | 'cloud';
export type VideoProviderBadge = 'popular' | 'new' | 'free' | 'fast';

export interface VideoProviderSpec {
  readonly id: string;
  readonly name: string;
  readonly capability: VideoCapability;
  readonly supportsTextPrompt: boolean;
  readonly supportsImageConditioning: boolean;
  readonly runtime: VideoRuntime;
  readonly resolution: string;
  readonly maxDurationSec: number;
  readonly minDurationSec: number;
  readonly estimatedGenSec: number;
  readonly pricePerSec: number;
  readonly qualityRating: 1 | 2 | 3 | 4 | 5;
  readonly supportsAudio: boolean;
  readonly startEndMode: boolean;
  readonly apiKeyRequired: boolean;
  readonly badge?: VideoProviderBadge;
  readonly fps: number;
}

export const VIDEO_PROVIDERS: readonly VideoProviderSpec[] = [
  {
    id: 'Anes1032/Wan2.2-TI2V-5B-mlx-q8',
    name: 'Wan 2.2 TI2V-5B',
    capability: 'IMAGE_TO_VIDEO',
    supportsTextPrompt: true,
    supportsImageConditioning: true,
    runtime: 'local',
    resolution: '480p',
    maxDurationSec: 5,
    minDurationSec: 1.7,
    estimatedGenSec: 240,
    pricePerSec: 0,
    qualityRating: 3,
    supportsAudio: false,
    startEndMode: false,
    apiKeyRequired: false,
    badge: 'free',
    fps: 24,
  },
  {
    id: 'Wan-AI/Wan2.1-T2V-1.3B-Diffusers',
    name: 'Wan 2.1 T2V-1.3B',
    capability: 'TEXT_TO_VIDEO',
    supportsTextPrompt: true,
    supportsImageConditioning: false,
    runtime: 'local',
    resolution: '480p',
    maxDurationSec: 3,
    minDurationSec: 2,
    estimatedGenSec: 180,
    pricePerSec: 0,
    qualityRating: 2,
    supportsAudio: false,
    startEndMode: false,
    apiKeyRequired: false,
    badge: 'free',
    fps: 16,
  },
  {
    id: 'stabilityai/stable-video-diffusion-img2vid-xt',
    name: 'SVD XT',
    capability: 'IMAGE_ANIMATION',
    supportsTextPrompt: false,
    supportsImageConditioning: true,
    runtime: 'local',
    resolution: '576p',
    maxDurationSec: 3.5,
    minDurationSec: 2,
    estimatedGenSec: 120,
    pricePerSec: 0,
    qualityRating: 2,
    supportsAudio: false,
    startEndMode: false,
    apiKeyRequired: false,
    badge: 'free',
    fps: 7,
  },
  {
    id: 'runwayml/gen4.5',
    name: 'Runway Gen 4.5',
    capability: 'IMAGE_TO_VIDEO',
    supportsTextPrompt: true,
    supportsImageConditioning: true,
    runtime: 'cloud',
    resolution: '1080p',
    maxDurationSec: 10,
    minDurationSec: 5,
    estimatedGenSec: 60,
    pricePerSec: 0.05,
    qualityRating: 5,
    supportsAudio: false,
    startEndMode: false,
    apiKeyRequired: true,
    badge: 'popular',
    fps: 24,
  },
  {
    id: 'MiniMaxAI/MiniMax-H3',
    name: 'MiniMax H3',
    capability: 'IMAGE_TO_VIDEO',
    supportsTextPrompt: true,
    supportsImageConditioning: true,
    runtime: 'cloud',
    resolution: '1080p',
    maxDurationSec: 10,
    minDurationSec: 5,
    estimatedGenSec: 45,
    pricePerSec: 0.04,
    qualityRating: 4,
    supportsAudio: true,
    startEndMode: false,
    apiKeyRequired: true,
    fps: 24,
  },
  {
    id: 'kling-ai/kling-4.0',
    name: 'Kling 4.0',
    capability: 'IMAGE_TO_VIDEO',
    supportsTextPrompt: true,
    supportsImageConditioning: true,
    runtime: 'cloud',
    resolution: '1080p',
    maxDurationSec: 10,
    minDurationSec: 5,
    estimatedGenSec: 45,
    pricePerSec: 0.05,
    qualityRating: 5,
    supportsAudio: false,
    startEndMode: true,
    apiKeyRequired: true,
    badge: 'popular',
    fps: 24,
  },
  {
    id: 'seedance/seedance-2.5',
    name: 'Seedance 2.5',
    capability: 'IMAGE_TO_VIDEO',
    supportsTextPrompt: true,
    supportsImageConditioning: true,
    runtime: 'cloud',
    resolution: '1080p',
    maxDurationSec: 10,
    minDurationSec: 5,
    estimatedGenSec: 30,
    pricePerSec: 0.04,
    qualityRating: 5,
    supportsAudio: false,
    startEndMode: true,
    apiKeyRequired: true,
    badge: 'popular',
    fps: 24,
  },
  {
    id: 'alibaba/wan3.0-video',
    name: 'Wan 3.0',
    capability: 'IMAGE_TO_VIDEO',
    supportsTextPrompt: true,
    supportsImageConditioning: true,
    runtime: 'cloud',
    resolution: '720p',
    maxDurationSec: 10,
    minDurationSec: 2,
    estimatedGenSec: 50,
    pricePerSec: 0.04,
    qualityRating: 5,
    supportsAudio: false,
    startEndMode: false,
    apiKeyRequired: true,
    badge: 'new',
    fps: 24,
  },
  {
    id: 'luma/dream-machine-1.6',
    name: 'Luma Dream Machine',
    capability: 'IMAGE_TO_VIDEO',
    supportsTextPrompt: true,
    supportsImageConditioning: true,
    runtime: 'cloud',
    resolution: '720p',
    maxDurationSec: 5,
    minDurationSec: 5,
    estimatedGenSec: 60,
    pricePerSec: 0.04,
    qualityRating: 4,
    supportsAudio: false,
    startEndMode: false,
    apiKeyRequired: true,
    fps: 24,
  },
  {
    id: 'Lightricks/LTX-Video',
    name: 'LTX-Video 0.9.1',
    capability: 'IMAGE_TO_VIDEO',
    supportsTextPrompt: true,
    supportsImageConditioning: true,
    runtime: 'local',
    resolution: '720p',
    maxDurationSec: 5,
    minDurationSec: 2,
    estimatedGenSec: 25,
    pricePerSec: 0,
    qualityRating: 4,
    supportsAudio: false,
    startEndMode: false,
    apiKeyRequired: false,
    badge: 'fast',
    fps: 24,
  },
  {
    id: 'THUDM/CogVideoX-5B',
    name: 'CogVideoX-5B',
    capability: 'IMAGE_TO_VIDEO',
    supportsTextPrompt: true,
    supportsImageConditioning: true,
    runtime: 'local',
    resolution: '720p',
    maxDurationSec: 6,
    minDurationSec: 2,
    estimatedGenSec: 180,
    pricePerSec: 0,
    qualityRating: 4,
    supportsAudio: false,
    startEndMode: false,
    apiKeyRequired: false,
    badge: 'new',
    fps: 24,
  },
  {
    id: 'tencent/HunyuanVideo',
    name: 'HunyuanVideo (13B · NVIDIA)',
    capability: 'IMAGE_TO_VIDEO',
    supportsTextPrompt: true,
    supportsImageConditioning: true,
    runtime: 'local',
    resolution: '1080p',
    maxDurationSec: 5,
    minDurationSec: 2,
    estimatedGenSec: 360,
    pricePerSec: 0,
    qualityRating: 5,
    supportsAudio: false,
    startEndMode: false,
    apiKeyRequired: false,
    badge: 'popular',
    fps: 24,
  },
];

export type ModelSortKey = 'default' | 'speed' | 'price' | 'quality';

export function sortProviders(
  providers: readonly VideoProviderSpec[],
  key: ModelSortKey,
): VideoProviderSpec[] {
  const list = [...providers];
  switch (key) {
    case 'speed':
      return list.sort((a, b) => a.estimatedGenSec - b.estimatedGenSec);
    case 'price':
      return list.sort((a, b) => a.pricePerSec - b.pricePerSec);
    case 'quality':
      return list.sort((a, b) => b.qualityRating - a.qualityRating);
    default:
      return list;
  }
}

export function localProviders(): VideoProviderSpec[] {
  return VIDEO_PROVIDERS.filter((p) => p.runtime === 'local');
}

export function cloudProviders(): VideoProviderSpec[] {
  return VIDEO_PROVIDERS.filter((p) => p.runtime === 'cloud');
}

export function normalizeVideoModelId(modelId: string): string {
  const lower = (modelId || '').toLowerCase();
  if (lower.includes('stable-video-diffusion') || lower.includes('img2vid')) {
    return 'stabilityai/stable-video-diffusion-img2vid-xt';
  }
  if (lower.includes('runway')) return 'runwayml/gen4.5';
  if (lower.includes('minimax') || (lower.includes('h3') && !lower.includes('ti2v'))) {
    return 'MiniMaxAI/MiniMax-H3';
  }
  if (lower.includes('ti2v') || lower.includes('anes1032')) {
    return 'Anes1032/Wan2.2-TI2V-5B-mlx-q8';
  }
  if (lower.includes('ltx')) return 'Lightricks/LTX-Video';
  if (lower.includes('cogvideo')) return 'THUDM/CogVideoX-5B';
  if (lower.includes('hunyuan')) return 'tencent/HunyuanVideo';
  if (lower.includes('kling')) return 'kling-ai/kling-4.0';
  if (lower.includes('seedance')) return 'seedance/seedance-2.5';
  if (lower.includes('luma') || lower.includes('dream')) return 'luma/dream-machine-1.6';
  if (lower.includes('wan3') || lower.includes('wan-3') || lower.includes('wan3.0')) {
    return 'alibaba/wan3.0-video';
  }
  if (lower.includes('wan')) return 'Wan-AI/Wan2.1-T2V-1.3B-Diffusers';
  return modelId;
}

export function specForVideoModel(modelId: string): VideoProviderSpec | undefined {
  const id = normalizeVideoModelId(modelId);
  return VIDEO_PROVIDERS.find((item) => item.id === id);
}

export function isAiVideoProvider(modelId: string): boolean {
  return specForVideoModel(modelId)?.capability === 'IMAGE_TO_VIDEO';
}

export function isAnimationProvider(modelId: string): boolean {
  return specForVideoModel(modelId)?.capability === 'IMAGE_ANIMATION';
}

export function modeForMedium(medium: 'image' | 'video' | 'animate'): VideoGenMode | null {
  if (medium === 'video') return 'ai_video';
  if (medium === 'animate') return 'image_animation';
  return null;
}

/** Format estimated gen time as human-readable string. */
export function formatEstimatedTime(sec: number): string {
  if (sec < 60) return `~${sec} с`;
  const min = Math.floor(sec / 60);
  const remaining = sec % 60;
  return remaining > 0 ? `~${min} мин ${remaining} с` : `~${min} мин`;
}

/** Format price per second as human-readable string. */
export function formatPrice(pricePerSec: number): string {
  if (pricePerSec <= 0) return 'бесплатно';
  return `\$${pricePerSec.toFixed(2)}/с`;
}

/** Return quality stars string. */
export function qualityStars(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}
