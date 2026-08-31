/// <reference types="vite/client" />

interface Window {
  api: {
    getModels: () => Promise<any[]>;
    getStudioResources: () => Promise<{
      ram_total: number;
      ram_free: number;
      disk_total: number;
      disk_free: number;
      models_dir: string;
    }>;
    getModelDiskUsage: () => Promise<Record<string, number>>;
    addModel: (model: any) => Promise<boolean>;
    downloadModel: (model: any) => Promise<boolean>;
    retryDownload: (model: any) => Promise<boolean>;
    unloadModel: (modelId: string) => Promise<{ unloaded: boolean; reason?: string }>;
    deleteModel: (modelId: string) => Promise<boolean>;
    getLoadedModels: () => Promise<string[]>;
    getActiveModel: () => Promise<string | null>;
    setActiveModel: (modelId: string) => Promise<boolean>;
    getActive3dModel: () => Promise<string | null>;
    setActive3dModel: (modelId: string) => Promise<boolean>;
    getEngineStatus: () => Promise<{ status: string; detail: string }>;
    generateImage: (payload: {
      prompt: string;
      format: string;
      style: string;
      model_id?: string;
      image_base64?: string;
      images_base64?: string[];
    }) => Promise<{ job_id: string; file_path: string | null; model_id: string }>;
    renderTimeline: (payload: {
      clips: Array<{
        kind: string;
        track: string;
        path: string | null;
        text: string | null;
        start_sec: number;
        duration_sec: number;
        source_in_sec: number;
      }>;
      width: number;
      height: number;
      fps: number;
    }) => Promise<{ file_path: string }>;
    loadVideoHistory: () => Promise<{
      savedAt: number;
      currentId: string;
      drafts: Array<{
        id: string;
        updatedAt: number;
        topic: string;
        format: 'landscape' | 'shorts';
        durationSec: number;
        plan: unknown;
        outputPath: string | null;
      }>;
    } | null>;
    saveVideoHistory: (payload: unknown) => Promise<boolean>;
    listGeneratedStills: () => Promise<{ path: string; mtime: number }[]>;
    pickVideo: () => Promise<string | null>;
    probeMediaDuration: (filePath: string) => Promise<number>;
    rememberDroppedMedia: (filePath: string) => Promise<string | null>;
    getPathForFile: (file: File) => string;
    pickImage: () => Promise<string | null>;
    pickImages: () => Promise<string[] | null>;
    pickAudio: () => Promise<string | null>;
    listMediaLibrary: () => Promise<{
      audio: { path: string; name: string; mtime: number }[];
      voice_path: string | null;
    }>;
    startMicRecord: (format: string) => Promise<{ file_path: string }>;
    stopMicRecord: () => Promise<{ file_path: string }>;
    saveAudioBuffer: (payload: { data: ArrayBuffer; format: string; name?: string }) => Promise<{ file_path: string }>;
    getVoiceProfile: () => Promise<{ has_sample: boolean; file_path: string | null; tts_ready: boolean }>;
    saveVoiceSample: (inputPath: string) => Promise<{ file_path: string }>;
    synthesizeVoice: (payload: { text: string; language?: string }) => Promise<{ file_path: string }>;
    applyVideoTimeline: (payload: {
      prompt: string;
      video_path?: string;
      audio_path?: string;
      dry_run?: boolean;
    }) => Promise<{
      status: string;
      file_path: string | null;
      plan?: { notes: string[]; cues?: { at_sec: number; kind: string; body: string }[] };
    }>;
    cleanScreencast: (payload: {
      input_path: string;
      prompt: string;
      dry_run?: boolean;
    }) => Promise<{
      status: string;
      file_path: string | null;
      plan?: { notes: string[]; trim_end_sec: number };
    }>;
    get3dStatus: () => Promise<{
      ready: boolean;
      detail?: string | null;
      model_id?: string;
      weights?: string;
      weights_local?: boolean;
      loaded?: boolean;
      hunyuan_id?: string;
      hunyuan_ready?: boolean;
      hunyuan_detail?: string | null;
      hunyuan_weights_local?: boolean;
      hunyuan_loaded?: boolean;
    }>;
    get3dProgress: () => Promise<{
      stage: string;
      percent: number;
      detail?: string;
      device?: string;
      engine?: string;
      weights_cached?: boolean;
    }>;
    generateMesh: (payload: {
      image_path: string;
      model_id?: string;
      output_format?: 'glb' | 'obj';
      mc_resolution?: number;
      remove_background?: boolean;
    }) => Promise<{
      job_id: string;
      file_path: string | null;
      model_id: string;
      format: string;
    }>;
    saveMeshAs: (sourcePath: string) => Promise<string | null>;
    readMeshFile: (sourcePath: string) => Promise<ArrayBuffer>;
    readVideoDraft: (sourcePath: string) => Promise<ArrayBuffer>;
    readMediaFile: (sourcePath: string) => Promise<ArrayBuffer>;
    ensureVideoPreview: (sourcePath: string, force?: boolean) => Promise<{ path: string; transcoded: boolean }>;
    discardMeshDraft: (sourcePath: string) => Promise<boolean>;
    saveVideoAs: (sourcePath: string) => Promise<string | null>;
    discardVideoDraft: (sourcePath: string) => Promise<boolean>;
    openPath: (filePath: string) => Promise<boolean>;
    getSetting: (key: string) => Promise<string | null>;
    setSetting: (key: string, value: string) => Promise<boolean>;
    onModelsUpdated: (callback: () => void) => (() => void);
    onEngineStatus: (callback: (data: { status: string; detail: string }) => void) => (() => void);
    onDownloadProgress: (callback: (data: {
    modelId: string;
    percent: number;
    downloadedBytes: number;
    totalBytes: number;
  }) => void) => (() => void);
  };
}
