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
  const withoutScheme = url.startsWith('asset://') ? url.slice('asset://'.length) : url;
  return decodeURIComponent(withoutScheme.split('?')[0]);
}
