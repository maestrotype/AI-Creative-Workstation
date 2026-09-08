import { create } from 'zustand';

interface WorkspaceBridgeState {
  lastImagePath: string | null;
  pendingTitleCardPath: string | null;
  setLastImagePath: (path: string | null) => void;
  setPendingTitleCard: (path: string | null) => void;
  takePendingTitleCard: () => string | null;
}

export const useWorkspaceBridgeStore = create<WorkspaceBridgeState>()((set, get) => ({
  lastImagePath: null,
  pendingTitleCardPath: null,
  setLastImagePath: (path) => set({ lastImagePath: path }),
  setPendingTitleCard: (path) => set({ pendingTitleCardPath: path }),
  takePendingTitleCard: () => {
    const path = get().pendingTitleCardPath;
    if (path) set({ pendingTitleCardPath: null });
    return path;
  },
}));

export function filePathFromAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const withoutScheme = url.startsWith('asset://') ? url.slice('asset://'.length) : url;
  return decodeURIComponent(withoutScheme.split('?')[0]);
}
