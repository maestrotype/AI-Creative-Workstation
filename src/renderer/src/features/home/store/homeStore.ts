/**
 * Home feature — Zustand store.
 *
 * All business logic lives here, NOT in React components.
 * Components select slices of this store and call its actions.
 */
import { create } from 'zustand';

import type { Asset, GenerationResult, NavId } from '../../../core/types';
import type { ReferenceImage } from '../../../shared/ui/IntentInput/IntentInput';
import { filePathFromAssetUrl } from '../../studio/store/workspaceBridgeStore';
import {
  fetchRecentAssets,
  fetchRecentProjects,
  fetchInspirationItems,
  type InspirationItem,
} from '../api/assetApi';

/* ─── Types ─────────────────────────────────────────────────────────── */

export type LoadingStatus = 'idle' | 'loading' | 'ready' | 'error';

interface HomeState {
  /* Navigation */
  activeNavId: NavId;
  setActiveNavId: (id: NavId) => void;

  /* Recent projects (Continue Working) */
  projectsStatus: LoadingStatus;
  recentProjects: readonly Asset[];
  loadRecentProjects: () => Promise<void>;

  /* Recent assets */
  assetsStatus: LoadingStatus;
  recentAssets: readonly Asset[];
  loadRecentAssets: () => Promise<void>;
  addGeneratedAsset: (result: GenerationResult) => void;
  removeAssetByUrl: (thumbnailUrl: string | null | undefined) => void;
  deleteRecentAsset: (asset: Asset) => Promise<void>;

  /* Inspiration */
  inspirationStatus: LoadingStatus;
  inspirationItems: readonly InspirationItem[];
  loadInspirationItems: () => Promise<void>;

  /* Intent bar */
  intentDraft: string;
  intentJob: 'title' | 'frame' | 'product' | null;
  referenceDrafts: ReferenceImage[];
  isCreating: boolean;
  setIntentDraft: (draft: string) => void;
  setIntentJob: (job: 'title' | 'frame' | 'product' | null) => void;
  setReferenceDrafts: (images: ReferenceImage[]) => void;
  submitIntent: () => void;
}

/* ─── Store ─────────────────────────────────────────────────────────── */

export const useHomeStore = create<HomeState>()((set, get) => ({
  /* ── Navigation ────────────────────────────────────────────────── */
  activeNavId: 'home',
  setActiveNavId: (id) => {
    if (id === 'home') set({ activeNavId: id });
  },

  /* ── Recent projects ───────────────────────────────────────────── */
  projectsStatus: 'idle',
  recentProjects: [],

  loadRecentProjects: async () => {
    if (get().projectsStatus === 'loading') return;

    set({ projectsStatus: 'loading' });
    try {
      const projects = await fetchRecentProjects();
      if (get().projectsStatus !== 'loading') return;
      set({ recentProjects: projects, projectsStatus: 'ready' });
    } catch {
      if (get().projectsStatus !== 'loading') return;
      set({ projectsStatus: 'error', recentProjects: [] });
    }
  },

  /* ── Recent assets ─────────────────────────────────────────────── */
  assetsStatus: 'idle',
  recentAssets: [],

  loadRecentAssets: async () => {
    if (get().assetsStatus === 'loading') return;

    set({ assetsStatus: 'loading' });
    try {
      const assets = await fetchRecentAssets();
      if (get().assetsStatus !== 'loading') return;
      set({ recentAssets: assets, assetsStatus: 'ready' });
    } catch {
      if (get().assetsStatus !== 'loading') return;
      set({ assetsStatus: 'error', recentAssets: [] });
    }
  },

  addGeneratedAsset: (result) => {
    set((state) => {
      const path = filePathFromAssetUrl(result.thumbnailUrl);
      const newAsset: Asset = {
        id: path || result.id,
        name: result.prompt,
        kind: result.kind === 'video' ? 'video' : 'image',
        thumbnailUrl: result.thumbnailUrl,
        updatedAt: result.createdAt,
        prompt: result.prompt,
        capability: result.capability ?? null,
        providerId: result.providerId ?? null,
        promptConsumed: result.promptConsumed ?? null,
        videoStatus: result.videoStatus ?? null,
        quality: result.quality ?? null,
      };
      
      return {
        assetsStatus: 'ready',
        recentAssets: [newAsset, ...state.recentAssets.filter((asset) => asset.id !== newAsset.id)].slice(0, 80),
      };
    });
  },

  removeAssetByUrl: (thumbnailUrl) => {
    if (!thumbnailUrl) return;
    set((state) => ({
      recentAssets: state.recentAssets.filter((asset) => asset.thumbnailUrl !== thumbnailUrl),
    }));
  },

  deleteRecentAsset: async (asset) => {
    const path = asset.kind === 'video' && asset.id.startsWith('/')
      ? asset.id
      : filePathFromAssetUrl(asset.thumbnailUrl);
    try {
      if (path && window.api?.deleteGeneratedStill) {
        await window.api.deleteGeneratedStill(path);
      }
    } catch {
      /* already gone from disk */
    }
    get().removeAssetByUrl(asset.thumbnailUrl);
  },

  /* ── Inspiration ───────────────────────────────────────────────── */
  inspirationStatus: 'idle',
  inspirationItems: [],

  loadInspirationItems: async () => {
    if (get().inspirationStatus === 'loading') return;

    set({ inspirationStatus: 'loading' });
    try {
      const items = await fetchInspirationItems();
      if (get().inspirationStatus !== 'loading') return;
      set({ inspirationItems: items, inspirationStatus: 'ready' });
    } catch {
      if (get().inspirationStatus !== 'loading') return;
      set({ inspirationStatus: 'error', inspirationItems: [] });
    }
  },

  /* ── Intent bar ────────────────────────────────────────────────── */
  intentDraft: '',
  intentJob: null,
  referenceDrafts: [],
  isCreating: false,

  setIntentDraft: (draft) => set({ intentDraft: draft }),
  setIntentJob: (job) => set({ intentJob: job }),
  setReferenceDrafts: (images) => set({ referenceDrafts: images }),

  submitIntent: () => {
    const draft = get().intentDraft.trim();
    if (!draft || get().isCreating) return;

    set({ isCreating: true });

    // Simulated local-first creation pipeline.
    setTimeout(() => {
      set((state) => ({
        isCreating: false,
        intentDraft: '',
        assetsStatus: 'ready',
        recentAssets: [
          {
            id: `asset-${Date.now()}`,
            name: draft.length > 48 ? `${draft.slice(0, 45)}…` : draft,
            kind: 'image' as const,
            thumbnailUrl: null,
            updatedAt: new Date().toISOString(),
          },
          ...state.recentAssets,
        ].slice(0, 80),
      }));
    }, 1_200);
  },
}));
