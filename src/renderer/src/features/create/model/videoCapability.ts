/**
 * Keep in sync with sidecar/video_capability.py
 */
export type VideoCapability = 'IMAGE_ANIMATION' | 'IMAGE_TO_VIDEO' | 'TEXT_TO_VIDEO';
export type VideoGenMode = 'ai_video' | 'image_animation' | 't2v';

export interface VideoProviderSpec {
  readonly id: string;
  readonly capability: VideoCapability;
  readonly supportsTextPrompt: boolean;
  readonly supportsImageConditioning: boolean;
}

export const VIDEO_PROVIDERS: readonly VideoProviderSpec[] = [
  {
    id: 'stabilityai/stable-video-diffusion-img2vid-xt',
    capability: 'IMAGE_ANIMATION',
    supportsTextPrompt: false,
    supportsImageConditioning: true,
  },
  {
    id: 'runwayml/gen4.5',
    capability: 'IMAGE_TO_VIDEO',
    supportsTextPrompt: true,
    supportsImageConditioning: true,
  },
  {
    id: 'Anes1032/Wan2.2-TI2V-5B-mlx-q8',
    capability: 'IMAGE_TO_VIDEO',
    supportsTextPrompt: true,
    supportsImageConditioning: true,
  },
  {
    id: 'MiniMaxAI/MiniMax-H3',
    capability: 'IMAGE_TO_VIDEO',
    supportsTextPrompt: true,
    supportsImageConditioning: true,
  },
  {
    id: 'Wan-AI/Wan2.1-T2V-1.3B-Diffusers',
    capability: 'TEXT_TO_VIDEO',
    supportsTextPrompt: true,
    supportsImageConditioning: false,
  },
];

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
