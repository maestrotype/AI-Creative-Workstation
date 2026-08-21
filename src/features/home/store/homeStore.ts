/**
 * Home feature — UI state (Zustand).
 * Business logic lives here, not in React components (Rule 3 / Rule 9).
 */
import { create } from 'zustand';

import type { Asset, NavItemId } from '../../../core/types';

import { fetchRecentAssets } from '../api/assetApi';

export type AssetsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface HomeState {
  /** Primary navigation state. */
  activeNavId: NavItemId;
  setActiveNavId: (id: NavItemId) => void;

  /** Recent assets feed. */
  assetsStatus: AssetsStatus;
  recentAssets: readonly Asset[];
  loadRecentAssets: () => Promise<void>;

  /** Intent draft + creation state machine. */
  intentDraft: string;
  isCreating: boolean;
  setIntentDraft: (draft: string) => void;
  submitIntent: () => void;
}

export const useHomeStore = create<HomeState>()((set, get) => ({
  activeNavId: 'home',
  setActiveNavId: (id) => {
    // Only "Home" is implemented in this milestone.
    if (id === 'home') set({ activeNavId: id });
  },

  assetsStatus: 'idle',
  recentAssets: [],
  loadRecentAssets: async () => {
    if (get().assetsStatus === 'loading' || get().assetsStatus === 'ready') return;
    set({ assetsStatus: 'loading' });
    try {
      const recentAssets = await fetchRecentAssets();
      // Guard against a slower request resolving after a newer one.
      if (get().assetsStatus !== 'loading') return;
      set({ recentAssets, assetsStatus: 'ready' });
    } catch {
      if (get().assetsStatus !== 'loading') return;
      set({ assetsStatus: 'error', recentAssets: [] });
    }
  },

  intentDraft: '',
  isCreating: false,
  setIntentDraft: (draft) => set({ intentDraft: draft }),
  submitIntent: () => {
    const draft = get().intentDraft.trim();
    if (!draft || get().isCreating) return;
    set({ isCreating: true });

    // Simulated local-first creation pipeline (mocked).
    setTimeout(() => {
      set((state) => ({
        isCreating: false,
        intentDraft: '',
        // We have local data now — a still-pending fetch must not clobber it.
        assetsStatus: 'ready',
        recentAssets: [
          {
            id: `asset-${Date.now()}`,
            name: draft.length > 48 ? `${draft.slice(0, 45)}…` : draft,
            type: 'image' as const,
            thumbnailUrl: null,
            updatedAt: new Date().toISOString(),
          },
          ...state.recentAssets,
        ].slice(0, 6),
      }));
    }, 1200);
  },
}));
