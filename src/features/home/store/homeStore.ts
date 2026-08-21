/**
 * Home feature — Zustand store.
 *
 * All business logic lives here, NOT in React components.
 * Components select slices of this store and call its actions.
 *
 * State machine:
 *   assets: idle → loading → ready | error
 *   intent: draft ↔ creating → idle
 */
import { create } from 'zustand';

import type { Asset, NavId } from '../../../core/types';
import { fetchRecentAssets } from '../api/assetApi';

/* ─── Types ─────────────────────────────────────────────────────────── */

export type AssetsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface HomeState {
  /* Navigation */
  activeNavId: NavId;
  setActiveNavId: (id: NavId) => void;

  /* Recent assets */
  assetsStatus: AssetsStatus;
  recentAssets: readonly Asset[];
  loadRecentAssets: () => Promise<void>;

  /* Intent bar */
  intentDraft: string;
  isCreating: boolean;
  setIntentDraft: (draft: string) => void;
  submitIntent: () => void;
}

/* ─── Store ─────────────────────────────────────────────────────────── */

export const useHomeStore = create<HomeState>()((set, get) => ({
  /* ── Navigation ────────────────────────────────────────────────── */
  activeNavId: 'home',
  setActiveNavId: (id) => {
    // Only "Home" is functional in this milestone.
    if (id === 'home') set({ activeNavId: id });
  },

  /* ── Recent assets ─────────────────────────────────────────────── */
  assetsStatus: 'idle',
  recentAssets: [],

  loadRecentAssets: async () => {
    const { assetsStatus } = get();
    if (assetsStatus === 'loading' || assetsStatus === 'ready') return;

    set({ assetsStatus: 'loading' });
    try {
      const assets = await fetchRecentAssets();
      // Guard: only apply if we're still in the loading state.
      if (get().assetsStatus !== 'loading') return;
      set({ recentAssets: assets, assetsStatus: 'ready' });
    } catch {
      if (get().assetsStatus !== 'loading') return;
      set({ assetsStatus: 'error', recentAssets: [] });
    }
  },

  /* ── Intent bar ────────────────────────────────────────────────── */
  intentDraft: '',
  isCreating: false,

  setIntentDraft: (draft) => set({ intentDraft: draft }),

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
        ].slice(0, 6),
      }));
    }, 1_200);
  },
}));
