import { contextBridge } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';

import { ipcRenderer } from 'electron';

// Custom APIs for renderer
const api = {
  getModels: () => ipcRenderer.invoke('get-models'),
  addModel: (model: any) => ipcRenderer.invoke('add-model', model),
  downloadModel: (model: any) => ipcRenderer.invoke('download-model', model),
  retryDownload: (model: any) => ipcRenderer.invoke('retry-download', model),
  unloadModel: (modelId: string) => ipcRenderer.invoke('unload-model', modelId),
  deleteModel: (modelId: string) => ipcRenderer.invoke('delete-model', modelId),
  getLoadedModels: () => ipcRenderer.invoke('get-loaded-models'),
  getActiveModel: () => ipcRenderer.invoke('get-active-model'),
  setActiveModel: (modelId: string) => ipcRenderer.invoke('set-active-model', modelId),
  getEngineStatus: () => ipcRenderer.invoke('get-engine-status'),
  generateImage: (payload: {
    prompt: string;
    format: string;
    style: string;
    model_id?: string;
    image_base64?: string;
    images_base64?: string[];
  }) => ipcRenderer.invoke('generate-image', payload),
  assembleVideo: (payload: {
    image_paths: string[];
    durations: number[];
    width: number;
    height: number;
    output_name: string;
  }) => ipcRenderer.invoke('assemble-video', payload),
  pickVideo: () => ipcRenderer.invoke('pick-video'),
  cleanScreencast: (payload: { input_path: string; prompt: string; dry_run?: boolean }) =>
    ipcRenderer.invoke('clean-screencast', payload),
  openPath: (filePath: string) => ipcRenderer.invoke('open-path', filePath),
  getSetting: (key: string) => ipcRenderer.invoke('get-setting', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('set-setting', key, value),
  onModelsUpdated: (callback: () => void) => {
    ipcRenderer.on('models-updated', callback);
    return () => { ipcRenderer.removeListener('models-updated', callback); };
  },
  onEngineStatus: (callback: (data: { status: string; detail: string }) => void) => {
    const handler = (_: unknown, data: { status: string; detail: string }) => callback(data);
    ipcRenderer.on('engine-status', handler);
    return () => { ipcRenderer.removeListener('engine-status', handler); };
  },
  onDownloadProgress: (callback: (data: { modelId: string; percent: number }) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('download-progress', handler);
    return () => { ipcRenderer.removeListener('download-progress', handler); };
  }
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
}
