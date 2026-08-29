import { create } from 'zustand';

interface WorkspaceBridgeState {
  lastImagePath: string | null;
  setLastImagePath: (path: string | null) => void;
}

export const useWorkspaceBridgeStore = create<WorkspaceBridgeState>()((set) => ({
  lastImagePath: null,
  setLastImagePath: (path) => set({ lastImagePath: path }),
}));

export function filePathFromAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith('asset://')) return url;
  return decodeURIComponent(url.slice('asset://'.length).split('?')[0]);
}
