import { create } from 'zustand';

export interface MediaClip {
  path: string;
  name: string;
  mtime: number;
}

interface MediaLibraryState {
  audioClips: MediaClip[];
  voicePath: string | null;
  selectedAudioPath: string | null;
  loadLibrary: () => Promise<void>;
  setSelectedAudioPath: (path: string | null) => void;
}

export const useMediaLibraryStore = create<MediaLibraryState>()((set, get) => ({
  audioClips: [],
  voicePath: null,
  selectedAudioPath: null,

  loadLibrary: async () => {
    if (!window.api?.listMediaLibrary) return;
    const lib = await window.api.listMediaLibrary();
    const selected = get().selectedAudioPath;
    set({
      audioClips: lib.audio,
      voicePath: lib.voice_path,
      selectedAudioPath: selected ?? lib.audio[0]?.path ?? null,
    });
  },

  setSelectedAudioPath: (path) => set({ selectedAudioPath: path }),
}));
