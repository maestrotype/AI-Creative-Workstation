import { contextBridge } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';

import { ipcRenderer } from 'electron';

// Custom APIs for renderer
const api = {
  getModels: () => ipcRenderer.invoke('get-models'),
  addModel: (model: any) => ipcRenderer.invoke('add-model', model),
  downloadModel: (model: any) => ipcRenderer.invoke('download-model', model),
  onModelsUpdated: (callback: () => void) => {
    ipcRenderer.on('models-updated', callback);
    return () => {
      ipcRenderer.removeListener('models-updated', callback);
    };
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
