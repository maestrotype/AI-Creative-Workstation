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
    importLibraryAudio: (paths?: string[]) => Promise<{ imported: string[] }>;
    deleteLibraryAudio: (filePath: string) => Promise<{ deleted: boolean }>;
    prepareLibraryAudio: (filePath: string) => Promise<{ path: string; converted: boolean }>;
    installVoiceEngine: () => Promise<{ ok: boolean }>;
    deleteVoiceEngine: () => Promise<{ deleted: boolean }>;
    getVoiceEngineStatus: () => Promise<{
      packages_ready: boolean;
      weights_ready: boolean;
      installing: boolean;
      stage: string;
      percent: number;
      detail: string;
      cache_path: string;
    }>;
    onVoiceEngineUpdated: (callback: (data: {
      packages_ready: boolean;
      weights_ready: boolean;
      installing: boolean;
      stage: string;
      percent: number;
      detail: string;
      cache_path: string;
    }) => void) => () => void;
    installOllamaEngine: () => Promise<{ ok: boolean }>;
    deleteOllamaModel: () => Promise<{ deleted: boolean }>;
    startOllamaServe: () => Promise<{ ok: boolean }>;
    getOllamaEngineStatus: () => Promise<{
      binary_found: boolean;
      server_running: boolean;
      model_ready: boolean;
      installing: boolean;
      stage: string;
      percent: number;
      detail: string;
      model: string;
      started_by_app: boolean;
    }>;
    onOllamaEngineUpdated: (callback: (data: {
      binary_found: boolean;
      server_running: boolean;
      model_ready: boolean;
      installing: boolean;
      stage: string;
      percent: number;
      detail: string;
      model: string;
      started_by_app: boolean;
    }) => void) => () => void;
    startMicRecord: (format: string) => Promise<{ file_path: string }>;
    stopMicRecord: () => Promise<{ file_path: string }>;
    saveAudioBuffer: (payload: { data: ArrayBuffer; format: string; name?: string }) => Promise<{ file_path: string }>;
    getVoiceProfile: () => Promise<{
      has_sample: boolean;
      file_path: string | null;
      source_path?: string | null;
      source_name?: string | null;
      tts_ready: boolean;
      engine?: 'xtts' | 'macos' | 'none' | string;
      sample_sec?: number | null;
      sample_warning?: string | null;
      sample_peak_db?: number | null;
    }>;
    getVoiceTtsProgress: () => Promise<{
      active: boolean;
      stage: string;
      percent: number;
      detail: string;
      elapsed_sec: number;
      error: string | null;
    }>;
    saveVoiceSample: (inputPath: string) => Promise<{ file_path: string }>;
    synthesizeVoice: (payload: {
      text: string;
      language?: string;
      skip_prepare?: boolean;
      prepared_text?: string;
    }) => Promise<{ file_path: string; spoken_text?: string }>;
    synthesizeVoiceBatch?: (payload: {
      items: Array<{ text: string; index: number; prepared_text?: string }>;
      language?: string;
      seed?: number;
    }) => Promise<{
      status: string;
      engine: string;
      results: Array<{
        index: number;
        file_path: string;
        duration_sec?: number;
        skipped?: boolean;
        spoken_text?: string;
      }>;
    }>;
    mixVoiceoverTrack?: (payload: {
      parts: Array<{ file_path: string; start_sec: number; max_duration_sec?: number }>;
      total_sec?: number;
      output_name?: string;
    }) => Promise<{
      status: string;
      file_path: string;
      parts: number;
      fit?: Array<{
        index: number;
        source_sec: number;
        output_sec: number;
        window_sec: number;
        tempo: number;
        fitted: boolean;
      }>;
    }>;
    prepareVoiceText: (payload: { text: string; language?: string; apply_stress?: boolean }) => Promise<{
      status: string;
      original: string;
      normalized: string;
      stressed: string;
      spoken: string;
      language: string;
      warnings: string[];
      stress_available: boolean;
      lexicon_applied?: string[];
    }>;
    getVoiceLexicon: () => Promise<{
      path: string;
      entries: Array<{ word: string; spoken: string; stress?: string; note?: string }>;
    }>;
    fixVoicePronunciation: (payload: {
      prompt: string;
      word?: string;
      context_text?: string;
    }) => Promise<{
      status: string;
      word: string;
      entry: { spoken: string; stress?: string; note?: string };
      parsed_as?: string;
      needs_spoken_hint?: boolean;
      prepared?: {
        original: string;
        normalized: string;
        stressed: string;
        spoken: string;
        lexicon_applied?: string[];
      };
    }>;
    deleteVoiceLexicon: (word: string) => Promise<{ status: string; word: string }>;
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
    analyzeVideo: (payload: {
      video_path: string;
      transcribe?: boolean;
      scene_detect?: boolean;
      language?: string;
      use_cache?: boolean;
    }) => Promise<{ status: string; context: Record<string, unknown> }>;
    getVideoAnalyzeProgress: () => Promise<{
      active: boolean;
      stage: string;
      percent: number;
      detail: string;
      elapsed_sec: number;
      error: string | null;
      whisper_available?: boolean;
    }>;
    getVideoAnalyzeCache: (videoPath: string) => Promise<{
      status: 'hit' | 'miss';
      context: Record<string, unknown> | null;
    }>;
    generateScript: (payload: {
      video_context: Record<string, unknown>;
      prompt?: string;
      project_context?: string;
      language?: string;
      target_wpm?: number;
      prefer_ollama?: boolean;
      ollama_model?: string;
    }) => Promise<{
      segments: Array<{ start_sec: number; end_sec: number; text: string; role: string }>;
      meta: { tone: string; language: string; words_per_min: number; provider: string; model?: string | null };
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
