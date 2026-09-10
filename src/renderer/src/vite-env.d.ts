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
    getActiveVideoModel: () => Promise<string | null>;
    setActiveVideoModel: (modelId: string) => Promise<boolean>;
    getEngineStatus: () => Promise<{ status: string; detail: string }>;
    restartEngine: () => Promise<{ ok: boolean; error?: string }>;
    getRuntimeStatus: () => Promise<{
      job: {
        active: boolean;
        kind: string;
        stage: string;
        percent: number;
        detail: string;
        model_id: string;
        elapsed_sec: number;
        error: string | null;
      };
      loaded: string[];
      memory: { sidecar_rss_bytes: number; mps_allocated_bytes: number };
      busy: boolean;
      ram_total: number;
      ram_free: number;
      ram_available?: number;
      ram_used?: number;
      ram_percent?: number;
      engine: string;
      video_backend?: {
        id: string;
        state: string;
        installed: boolean;
        approx_bytes: number;
      };
    }>;
    cancelRuntimeJob: () => Promise<{ ok: boolean }>;
    unloadAllModels: () => Promise<{ ok: boolean; unloaded?: number; reason?: string }>;
    generateVideo: (payload: {
      prompt: string;
      format: string;
      duration_sec?: number;
      model_id?: string;
      image_path?: string;
      image_base64?: string;
      mode?: string;
      num_frames?: number;
      shot_index?: number;
      shot_total?: number;
      seed?: number;
    }) => Promise<{
      job_id: string;
      file_path: string | null;
      model_id: string;
      status?: string;
      capability?: string;
      provider_id?: string;
      prompt_consumed?: boolean;
      quality?: {
        duration_sec?: number;
        fps?: number;
        frame_count?: number;
        motion_score?: number | null;
        motion_mae?: number;
        identity_mae?: number | null;
        identity_warning?: boolean;
        low_motion?: boolean;
        prompt_wan?: string;
        prompt_intent?: string;
        prompt_english?: string;
      } | null;
    }>;
    generateImage: (payload: {
      prompt: string;
      format: string;
      style: string;
      job?: string;
      model_id?: string;
      image_base64?: string;
      images_base64?: string[];
    }) => Promise<{ job_id: string; file_path: string | null; model_id: string }>;
    listProjects: () => Promise<Array<{
      id: string;
      name: string;
      format: 'landscape' | 'shorts';
      sceneCount: number;
      updatedAt: number;
      coverPath: string | null;
      assembledPath: string | null;
    }>>;
    createProject: (payload?: {
      name?: string;
      format?: 'landscape' | 'shorts';
      preset?: 'marketplace' | 'hero' | 'youtube' | 'shorts';
    }) => Promise<{
      id: string;
      name: string;
      kind: string;
      format: 'landscape' | 'shorts';
      preset: 'marketplace' | 'hero' | 'youtube' | 'shorts';
      brief: string;
      scenes: Array<{
        id: string;
        title: string;
        prompt: string;
        effectPrompt: string;
        textOverlay: string;
        durationSec: number;
        stillPath: string | null;
        clipPath: string | null;
        motion: 'still_motion' | 'import' | 'i2v';
      }>;
      shots?: unknown[];
      timeline?: unknown;
      productStillPath?: string | null;
      assembledPath: string | null;
      assembledFingerprint?: string | null;
      createdAt: number;
      updatedAt: number;
    }>;
    loadProject: (id: string) => Promise<{
      id: string;
      name: string;
      kind: string;
      format: 'landscape' | 'shorts';
      preset: 'marketplace' | 'hero' | 'youtube' | 'shorts';
      brief: string;
      scenes: Array<{
        id: string;
        title: string;
        prompt: string;
        effectPrompt: string;
        textOverlay: string;
        durationSec: number;
        stillPath: string | null;
        clipPath: string | null;
        motion: 'still_motion' | 'import' | 'i2v';
      }>;
      shots?: unknown[];
      timeline?: unknown;
      productStillPath?: string | null;
      assembledPath: string | null;
      assembledFingerprint?: string | null;
      createdAt: number;
      updatedAt: number;
    } | null>;
    saveProject: (doc: unknown) => Promise<unknown>;
    deleteProject: (id: string) => Promise<{ deleted: boolean }>;
    importIntoProject: (payload: { projectId: string; path: string }) => Promise<{ file_path: string }>;
    renderTimeline: (payload: {
      clips: Array<{
        kind: string;
        track: string;
        path: string | null;
        text: string | null;
        start_sec: number;
        duration_sec: number;
      source_in_sec: number;
      effect?: string | null;
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
    listGeneratedStills: () => Promise<Array<{
      path: string;
      mtime: number;
      poster?: string | null;
      prompt?: string | null;
      capability?: string | null;
      prompt_consumed?: boolean | null;
      status?: string | null;
      provider_id?: string | null;
      quality?: Record<string, unknown> | null;
    }>>;
    deleteGeneratedStill: (sourcePath: string) => Promise<boolean>;
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
    deleteLibraryAudioMany: (filePaths: string[]) => Promise<{ deleted: number; skipped: string[] }>;
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
      model_on_disk: boolean;
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
      model_on_disk: boolean;
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
      segments: Array<{
        start_sec: number;
        end_sec: number;
        text: string;
        role: string;
        purpose?: string;
        visual_summary?: string;
        estimated_sec?: number;
      }>;
      meta: { tone: string; language: string; words_per_min: number; provider: string; model?: string | null };
    }>;
    shortenScript: (payload: {
      text: string;
      target_sec: number;
      language?: string;
      target_wpm?: number;
      visual_summary?: string;
      purpose?: string;
    }) => Promise<{ text: string }>;
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
    saveMediaAs: (sourcePath: string) => Promise<string | null>;
    gradeVideo: (payload: {
      video_path: string;
      prompt?: string;
      overlay_path?: string | null;
    }) => Promise<{ file_path: string | null }>;
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
