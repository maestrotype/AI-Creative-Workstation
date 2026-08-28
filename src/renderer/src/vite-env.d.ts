/// <reference types="vite/client" />

interface Window {
  api: {
    getModels: () => Promise<any[]>;
    addModel: (model: any) => Promise<boolean>;
    downloadModel: (model: any) => Promise<boolean>;
    retryDownload: (model: any) => Promise<boolean>;
    deleteModel: (modelId: string) => Promise<boolean>;
    getSetting: (key: string) => Promise<string | null>;
    setSetting: (key: string, value: string) => Promise<boolean>;
    onModelsUpdated: (callback: () => void) => (() => void);
    onDownloadProgress: (callback: (data: { modelId: string; percent: number }) => void) => (() => void);
  };
}
