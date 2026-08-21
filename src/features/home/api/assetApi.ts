/**
 * Home feature — recent assets data source (mock API).
 * Data layer: the only place that "fetches" asset records. Swappable with a
 * real local-first repository later without touching UI or store logic.
 */
import type { Asset } from '../../../core/types';

const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

/** Simulated network latency for the mock endpoint. */
const NETWORK_LATENCY_MS = 900;

const RECENT_ASSETS: readonly Asset[] = [
  { id: 'asset-01', name: 'Aria — Protagonist', type: 'character', thumbnailUrl: null, updatedAt: hoursAgo(2) },
  { id: 'asset-02', name: 'Neon Alley — Keyframe 07', type: 'image', thumbnailUrl: null, updatedAt: hoursAgo(5) },
  { id: 'asset-03', name: 'Project: Driftwood', type: 'project', thumbnailUrl: null, updatedAt: hoursAgo(26) },
  { id: 'asset-04', name: 'Kael — Antagonist v3', type: 'character', thumbnailUrl: null, updatedAt: hoursAgo(50) },
  { id: 'asset-05', name: 'Cover Art — Stormlight', type: 'image', thumbnailUrl: null, updatedAt: hoursAgo(74) },
  { id: 'asset-06', name: 'Project: Night Market', type: 'project', thumbnailUrl: null, updatedAt: hoursAgo(120) },
];

/** Fetches the user's most recent assets (mocked; resolves after simulated latency). */
export function fetchRecentAssets(limit = 6): Promise<Asset[]> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(RECENT_ASSETS.slice(0, limit)), NETWORK_LATENCY_MS);
  });
}

/** Quick-start intents shown under the intent bar when idle. */
export const QUICK_CREATE_SUGGESTIONS: readonly string[] = [
  'A character sheet with personality and backstory',
  'An image prompt from a scene description',
  'A story outline in three acts',
];
