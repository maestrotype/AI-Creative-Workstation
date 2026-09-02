export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface VideoScene {
  index: number;
  start: number;
  end: number;
}

export interface VideoAnalysisContext {
  source_path: string;
  duration_sec: number;
  transcript: {
    segments: TranscriptSegment[];
    language: string;
    full_text: string;
  };
  scenes: VideoScene[];
  visual_notes: Array<{ time: number; caption: string }>;
  warnings?: string[];
  whisper_available?: boolean;
  cache_path?: string;
}

export function formatTimecode(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
