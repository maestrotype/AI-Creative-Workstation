import { filePathFromAssetUrl } from '../../studio/store/workspaceBridgeStore';
import type { ReferenceImage } from '../../../shared/ui/IntentInput/IntentInput';
import type { GenerationResult } from '../../../core/types';

/** Wan needs an English camera line. Image captions alone often freeze the shot. */
export const DEFAULT_AI_VIDEO_PROMPT =
  'Slow cinematic camera push-in with a slight orbit, keep the product recognizable.';

export const DEFAULT_ANIMATE_PROMPT = 'Short animation of this still.';

export function isJobLikeId(text: string | null | undefined): boolean {
  return /^(job|vid|mesh)_[a-f0-9]+$/i.test((text || '').trim());
}

export function isVideoPath(path: string | null | undefined): boolean {
  return Boolean(path && /\.(mp4|mov|m4v|webm|mkv)(\?|$)/i.test(path));
}

function displayPrompt(text: string | null | undefined): string {
  const trimmed = (text || '').trim();
  if (!trimmed || isJobLikeId(trimmed)) return '';
  return trimmed;
}

function hasCameraLanguage(text: string): boolean {
  return /\b(camera|orbit|push-in|push in|dolly|pan|tilt|zoom|наезд|облёт|камер)/i.test(text);
}

export function promptForVideoAction(
  storePrompt: string,
  resultPrompt: string,
  medium: 'video' | 'animate',
): string {
  const real = [storePrompt, resultPrompt].map(displayPrompt).find(Boolean) || '';
  if (medium === 'animate') return real || DEFAULT_ANIMATE_PROMPT;
  if (!real) return DEFAULT_AI_VIDEO_PROMPT;
  if (hasCameraLanguage(real)) return real;
  return `${DEFAULT_AI_VIDEO_PROMPT} Subject: ${real}`;
}

export function stillPathFromCreateState(state: {
  referenceImages: ReferenceImage[];
  result: GenerationResult | null;
  clipStillPath: string | null;
}): string | null {
  const fromResult = filePathFromAssetUrl(state.result?.thumbnailUrl);
  if (fromResult && !isVideoPath(fromResult)) return fromResult;
  if (state.clipStillPath && !isVideoPath(state.clipStillPath)) return state.clipStillPath;
  const photo = state.referenceImages.find((ref) => ref.kind !== 'video');
  if (photo?.sourcePath && !isVideoPath(photo.sourcePath)) return photo.sourcePath;
  return null;
}

export function stillFromState(state: {
  referenceImages: ReferenceImage[];
  result: GenerationResult | null;
  clipStillPath: string | null;
}): { path?: string; dataUrl?: string } {
  const path = stillPathFromCreateState(state);
  if (path) return { path };
  const photo = state.referenceImages.find((ref) => ref.kind !== 'video');
  if (photo?.dataUrl) return { dataUrl: photo.dataUrl };
  return {};
}
