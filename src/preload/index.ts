import { contextBridge } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';

import { ipcRenderer } from 'electron';

// Custom APIs for renderer
const api = {
  getModels: () => ipcRenderer.invoke('get-models'),
  getStudioResources: () => ipcRenderer.invoke('get-studio-resources'),
  getModelDiskUsage: () => ipcRenderer.invoke('get-model-disk-usage'),
  addModel: (model: any) => ipcRenderer.invoke('add-model', model),
  downloadModel: (model: any) => ipcRenderer.invoke('download-model', model),
  retryDownload: (model: any) => ipcRenderer.invoke('retry-download', model),
  unloadModel: (modelId: string) => ipcRenderer.invoke('unload-model', modelId),
  deleteModel: (modelId: string) => ipcRenderer.invoke('delete-model', modelId),
  getLoadedModels: () => ipcRenderer.invoke('get-loaded-models'),
  getActiveModel: () => ipcRenderer.invoke('get-active-model'),
  setActiveModel: (modelId: string) => ipcRenderer.invoke('set-active-model', modelId),
  getActive3dModel: () => ipcRenderer.invoke('get-active-3d-model'),
  setActive3dModel: (modelId: string) => ipcRenderer.invoke('set-active-3d-model', modelId),
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
  loadVideoHistory: () => ipcRenderer.invoke('load-video-history'),
  saveVideoHistory: (payload: unknown) => ipcRenderer.invoke('save-video-history', payload),
  listGeneratedStills: () => ipcRenderer.invoke('list-generated-stills') as Promise<{ path: string; mtime: number }[]>,
  pickVideo: () => ipcRenderer.invoke('pick-video'),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  pickImages: () => ipcRenderer.invoke('pick-images'),
  pickAudio: () => ipcRenderer.invoke('pick-audio'),
  listMediaLibrary: () => ipcRenderer.invoke('list-media-library'),
  startMicRecord: (format: string) => ipcRenderer.invoke('start-mic-record', format),
  stopMicRecord: () => ipcRenderer.invoke('stop-mic-record'),
  saveAudioBuffer: (payload: { data: ArrayBuffer; format: string; name?: string }) =>
    ipcRenderer.invoke('save-audio-buffer', payload),
  getVoiceProfile: () => ipcRenderer.invoke('get-voice-profile'),
  saveVoiceSample: (inputPath: string) => ipcRenderer.invoke('save-voice-sample', inputPath),
  synthesizeVoice: (payload: { text: string; language?: string }) =>
    ipcRenderer.invoke('synthesize-voice', payload),
  applyVideoTimeline: (payload: {
    prompt: string;
    video_path?: string;
    audio_path?: string;
    dry_run?: boolean;
  }) => ipcRenderer.invoke('apply-video-timeline', payload),
  cleanScreencast: (payload: { input_path: string; prompt: string; dry_run?: boolean }) =>
    ipcRenderer.invoke('clean-screencast', payload),
  get3dStatus: () => ipcRenderer.invoke('get-3d-status'),
  get3dProgress: () => ipcRenderer.invoke('get-3d-progress'),
  generateMesh: (payload: {
    image_path: string;
    model_id?: string;
    output_format?: 'glb' | 'obj';
    mc_resolution?: number;
    remove_background?: boolean;
  }) => ipcRenderer.invoke('generate-mesh', payload),
  saveMeshAs: (sourcePath: string) => ipcRenderer.invoke('save-mesh-as', sourcePath),
  readMeshFile: (sourcePath: string) => ipcRenderer.invoke('read-mesh-file', sourcePath) as Promise<ArrayBuffer>,
  readVideoDraft: (sourcePath: string) => ipcRenderer.invoke('read-video-draft', sourcePath) as Promise<ArrayBuffer>,
  readMediaFile: (sourcePath: string) => ipcRenderer.invoke('read-media-file', sourcePath) as Promise<ArrayBuffer>,
  ensureVideoPreview: (sourcePath: string, force?: boolean) =>
    ipcRenderer.invoke('ensure-video-preview', sourcePath, force) as Promise<{ path: string; transcoded: boolean }>,
  discardMeshDraft: (sourcePath: string) => ipcRenderer.invoke('discard-mesh-draft', sourcePath),
  saveVideoAs: (sourcePath: string) => ipcRenderer.invoke('save-video-as', sourcePath),
  discardVideoDraft: (sourcePath: string) => ipcRenderer.invoke('discard-video-draft', sourcePath),
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
  onDownloadProgress: (callback: (data: {
    modelId: string;
    percent: number;
    downloadedBytes: number;
    totalBytes: number;
  }) => void) => {
    const handler = (_: unknown, data: {
      modelId: string;
      percent: number;
      downloadedBytes: number;
      totalBytes: number;
    }) => callback(data);
    ipcRenderer.on('download-progress', handler);
    return () => { ipcRenderer.removeListener('download-progress', handler); };
  },
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
