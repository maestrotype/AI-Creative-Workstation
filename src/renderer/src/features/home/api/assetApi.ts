/**
 * Home feature — recent projects, generated stills, and job prompts.
 */
import type { Asset } from '../../../core/types';
import { toAssetUrl } from '../../video/model/directorMedia';

function fileName(path: string): string {
  return path.split('/').pop()?.replace(/\.[^.]+$/, '') || path;
}

function isVideoPath(path: string): boolean {
  return /\.(mp4|mov|m4v|webm|mkv)$/i.test(path);
}

export interface InspirationItem {
  id: string;
  prompt: string;
  job: 'title' | 'frame' | 'product';
  thumbnailUrl: string | null;
}

export async function fetchRecentProjects(limit = 3): Promise<Asset[]> {
  if (!window.api?.listProjects) return [];
  const list = await window.api.listProjects();
  return list.slice(0, limit).map((item) => ({
    id: item.id,
    name: item.name,
    kind: 'project' as const,
    thumbnailUrl: item.coverPath
      ? toAssetUrl(item.coverPath)
      : item.assembledPath
        ? toAssetUrl(item.assembledPath)
        : null,
    updatedAt: new Date(item.updatedAt).toISOString(),
  }));
}

export async function fetchRecentAssets(limit = 80): Promise<Asset[]> {
  if (!window.api?.listGeneratedStills) return [];
  const stills = await window.api.listGeneratedStills();
  return stills.slice(0, limit).map((row) => {
    const video = isVideoPath(row.path);
    const prompt = (row.prompt || '').trim();
    const fallbackName = fileName(row.path);
    return {
      id: row.path,
      name: prompt || fallbackName,
      kind: (video ? 'video' : 'image') as Asset['kind'],
      thumbnailUrl: toAssetUrl(row.path),
      posterUrl: row.poster ? toAssetUrl(row.poster) : null,
      updatedAt: new Date(row.mtime).toISOString(),
      prompt: prompt || null,
      capability: row.capability ?? null,
      providerId: row.provider_id ?? null,
      promptConsumed: row.prompt_consumed ?? null,
      videoStatus: row.status ?? null,
      quality: (row.quality ?? null) as Asset['quality'],
    };
  });
}

export async function fetchInspirationItems(): Promise<InspirationItem[]> {
  return [
    {
      id: 'insp-title',
      job: 'title',
      prompt: 'Title card: Angular 3D Store — dark UI, 3D catalog, admin, page builder. No fake screenshot.',
      thumbnailUrl: null,
    },
    {
      id: 'insp-frame',
      job: 'frame',
      prompt: 'Storyboard frame: dark product grid of a 3D store template, real software UI, no invented shop interior.',
      thumbnailUrl: null,
    },
    {
      id: 'insp-product',
      job: 'product',
      prompt: 'Grey silk tote bag based on this reference, same shape and stitching, studio light.',
      thumbnailUrl: null,
    },
    {
      id: 'insp-vary',
      job: 'frame',
      prompt: 'Same shot as the reference, cooler grade, light film grain, keep the composition.',
      thumbnailUrl: null,
    },
  ];
}
