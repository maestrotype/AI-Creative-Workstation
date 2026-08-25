/// <reference types="vite/client" />

interface Window {
  api: {
    getModels: () => Promise<any[]>;
    addModel: (model: any) => Promise<boolean>;
    downloadModel: (model: any) => Promise<boolean>;
    onModelsUpdated: (callback: () => void) => (() => void);
  };
}
