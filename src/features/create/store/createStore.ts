import { create } from 'zustand';

export type CreateStatus = 'idle' | 'generating' | 'success' | 'error';

interface CreateState {
  status: CreateStatus;
  intent: string;
  progress: number;
  statusText: string;
  resultImageUrl: string | null;

  startGeneration: (intent: string) => void;
  reset: () => void;
}

export const useCreateStore = create<CreateState>()((set) => ({
  status: 'idle',
  intent: '',
  progress: 0,
  statusText: '',
  resultImageUrl: null,

  startGeneration: (intent) => {
    if (!intent.trim()) return;

    set({
      status: 'generating',
      intent,
      progress: 0,
      statusText: 'Initializing local model...',
      resultImageUrl: null,
    });

    // Simulate the generation pipeline locally
    let currentProgress = 0;
    const stages = [
      'Parsing creative intent...',
      'Allocating VRAM (Apple Silicon)...',
      'Composing scene elements...',
      'Refining lighting and details...',
      'Finalizing export...',
    ];

    const interval = setInterval(() => {
      currentProgress += 5;
      
      const stageIndex = Math.min(
        Math.floor((currentProgress / 100) * stages.length),
        stages.length - 1
      );

      set({
        progress: Math.min(currentProgress, 100),
        statusText: stages[stageIndex],
      });

      if (currentProgress >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          set({
            status: 'success',
            // Mock generated image placeholder
            resultImageUrl: 'https://images.unsplash.com/photo-1618331835717-801e976710b2?auto=format&fit=crop&q=80&w=1200&h=800',
            statusText: 'Done',
          });
        }, 400);
      }
    }, 250); // Takes ~5 seconds total for the simulation
  },

  reset: () => {
    set({
      status: 'idle',
      intent: '',
      progress: 0,
      statusText: '',
      resultImageUrl: null,
    });
  },
}));
