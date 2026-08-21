/**
 * Home feature — mock data source for recent assets.
 *
 * This is the only module that "fetches" asset records. In production
 * it will be swapped for a local-first SQLite repository without
 * touching any store or UI code.
 */
import type { Asset } from '../../../core/types';

/* ─── Helpers ───────────────────────────────────────────────────────── */

const hoursAgo = (h: number): string =>
  new Date(Date.now() - h * 3_600_000).toISOString();

/** Simulated network/disk latency for the mock endpoint. */
const LATENCY_MS = 800;

/* ─── Mock data ─────────────────────────────────────────────────────── */

const MOCK_ASSETS: readonly Asset[] = [
  {
    id: 'asset-01',
    name: 'Aria — Protagonist',
    kind: 'character',
    thumbnailUrl: null,
    updatedAt: hoursAgo(1),
  },
  {
    id: 'asset-02',
    name: 'Neon Alley — Keyframe 07',
    kind: 'image',
    thumbnailUrl: null,
    updatedAt: hoursAgo(4),
  },
  {
    id: 'asset-03',
    name: 'Project: Driftwood',
    kind: 'project',
    thumbnailUrl: null,
    updatedAt: hoursAgo(22),
  },
  {
    id: 'asset-04',
    name: 'Kael — Antagonist v3',
    kind: 'character',
    thumbnailUrl: null,
    updatedAt: hoursAgo(48),
  },
  {
    id: 'asset-05',
    name: 'Cover Art — Stormlight',
    kind: 'image',
    thumbnailUrl: null,
    updatedAt: hoursAgo(72),
  },
  {
    id: 'asset-06',
    name: 'Project: Night Market',
    kind: 'project',
    thumbnailUrl: null,
    updatedAt: hoursAgo(120),
  },
];

/* ─── Public API ────────────────────────────────────────────────────── */

/**
 * Fetches the user's most recent assets.
 * Resolves after simulated latency to exercise loading states.
 */
export function fetchRecentAssets(limit = 6): Promise<Asset[]> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(MOCK_ASSETS.slice(0, limit)), LATENCY_MS);
  });
}

/** Quick-start intent suggestions shown when the user hasn't typed anything. */
export const QUICK_SUGGESTIONS: readonly string[] = [
  'A cinematic character portrait with dramatic lighting',
  'A story outline in three acts with conflict arcs',
  'An image prompt from a vivid scene description',
];
