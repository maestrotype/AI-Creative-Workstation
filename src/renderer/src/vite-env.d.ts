/// <reference types="vite/client" />

interface Window {
  api: {
    getModels: () => Promise<any[]>;
    addModel: (model: any) => Promise<boolean>;
    downloadModel: (model: any) => Promise<boolean>;
    retryDownload: (model: any) => Promise<boolean>;
    unloadModel: (modelId: string) => Promise<{ unloaded: boolean; reason?: string }>;
    deleteModel: (modelId: string) => Promise<boolean>;
    getLoadedModels: () => Promise<string[]>;
    getActiveModel: () => Promise<string | null>;
    setActiveModel: (modelId: string) => Promise<boolean>;
    getEngineStatus: () => Promise<{ status: string; detail: string }>;
    generateImage: (payload: {
      prompt: string;
      format: string;
      style: string;
      model_id?: string;
      image_base64?: string;
      images_base64?: string[];
    }) => Promise<{ job_id: string; file_path: string | null; model_id: string }>;
    assembleVideo: (payload: {
      image_paths: string[];
      durations: number[];
      width: number;
      height: number;
      output_name: string;
    }) => Promise<{ file_path: string }>;
    pickVideo: () => Promise<string | null>;
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
    openPath: (filePath: string) => Promise<boolean>;
    getSetting: (key: string) => Promise<string | null>;
    setSetting: (key: string, value: string) => Promise<boolean>;
    onModelsUpdated: (callback: () => void) => (() => void);
    onEngineStatus: (callback: (data: { status: string; detail: string }) => void) => (() => void);
    onDownloadProgress: (callback: (data: { modelId: string; percent: number }) => void) => (() => void);
  };
}
