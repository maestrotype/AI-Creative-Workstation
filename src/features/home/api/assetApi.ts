/**
 * Home feature — mock data source for recent assets, projects, and inspiration.
 *
 * This is the only module that "fetches" records. In production
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

const MOCK_PROJECTS: readonly Asset[] = [
  {
    id: 'project-01',
    name: 'MacBook Pro Review — November',
    kind: 'project',
    thumbnailUrl: null,
    updatedAt: hoursAgo(2),
  },
  {
    id: 'project-02',
    name: 'Neon City Asset Build',
    kind: 'project',
    thumbnailUrl: null,
    updatedAt: hoursAgo(22),
  },
  {
    id: 'project-03',
    name: 'Social Media Pack',
    kind: 'project',
    thumbnailUrl: null,
    updatedAt: hoursAgo(120),
  },
];

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
];

export interface InspirationItem {
  id: string;
  prompt: string;
  thumbnailUrl: string | null;
}

const MOCK_INSPIRATION: readonly InspirationItem[] = [
  {
    id: 'insp-01',
    prompt: 'A cinematic portrait in Tokyo at night',
    thumbnailUrl: null, // We'll use CSS gradients for placeholders
  },
  {
    id: 'insp-02',
    prompt: 'Concept art for a sci-fi mech suit',
    thumbnailUrl: null,
  },
  {
    id: 'insp-03',
    prompt: 'Cozy isometric coffee shop',
    thumbnailUrl: null,
  },
  {
    id: 'insp-04',
    prompt: '3D stylized character rendered in clay',
    thumbnailUrl: null,
  },
];

/* ─── Public API ────────────────────────────────────────────────────── */

export function fetchRecentProjects(limit = 3): Promise<Asset[]> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(MOCK_PROJECTS.slice(0, limit)), LATENCY_MS);
  });
}

export function fetchRecentAssets(limit = 6): Promise<Asset[]> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(MOCK_ASSETS.slice(0, limit)), LATENCY_MS);
  });
}

export function fetchInspirationItems(limit = 4): Promise<InspirationItem[]> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(MOCK_INSPIRATION.slice(0, limit)), LATENCY_MS);
  });
}

/** Quick-start intent suggestions shown when the user hasn't typed anything. */
export const QUICK_SUGGESTIONS: readonly string[] = [
  'A cinematic character portrait with dramatic lighting',
  'A story outline in three acts with conflict arcs',
  'An image prompt from a vivid scene description',
];
