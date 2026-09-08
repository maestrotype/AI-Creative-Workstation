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

export interface SceneAnalysis {
  index: number;
  start: number;
  end: number;
  duration?: number;
  visual_summary: string;
  objects?: string[];
  actions?: string[];
  ui_elements?: string[];
  product_features?: string[];
  user_doing?: string;
  changes_from_previous?: string;
  importance?: string;
  narration_recommended?: boolean;
  narration_goal?: string;
  pause_ok?: boolean;
  confidence?: number;
  frame_path?: string;
  caption?: string;
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
  scene_analysis?: SceneAnalysis[];
  visual_notes: Array<{
    time: number;
    caption: string;
    scene_index?: number;
    source?: string;
    frame_path?: string;
  }>;
  warnings?: string[];
  whisper_available?: boolean;
  cache_path?: string;
}

export function formatTimecode(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface NarrationIssue {
  kind: 'gap' | 'overrun' | 'ok_pause';
  start: number;
  end: number;
  seconds: number;
}

export function narrationHealth(
  durationSec: number,
  analysis: SceneAnalysis[] | undefined,
  segments: Array<{ start_sec: number; end_sec: number; text: string; speech_sec?: number }>,
): NarrationIssue[] {
  const issues: NarrationIssue[] = [];
  const spoken = segments
    .filter((seg) => seg.text.trim())
    .map((seg) => {
      const dur = seg.speech_sec ?? Math.max(0.4, seg.end_sec - seg.start_sec);
      return { start: seg.start_sec, end: seg.start_sec + dur };
    })
    .sort((a, b) => a.start - b.start);

  const covers = (start: number, end: number) => spoken.some((row) => (
    Math.min(end, row.end) - Math.max(start, row.start) > 0.35
  ));

  for (const beat of analysis || []) {
    const start = beat.start;
    const end = beat.end;
    const span = Math.max(0, end - start);
    if (span < 1.2) continue;
    const hasVoice = covers(start, end);
    if (beat.narration_recommended && !hasVoice) {
      issues.push({ kind: 'gap', start, end, seconds: span });
    } else if (!beat.narration_recommended && !hasVoice && beat.pause_ok) {
      if (span >= 2.5) issues.push({ kind: 'ok_pause', start, end, seconds: span });
    }
  }

  for (const seg of segments) {
    if (!seg.text.trim() || seg.speech_sec == null) continue;
    const window = Math.max(0.4, seg.end_sec - seg.start_sec);
    if (seg.speech_sec > window + 0.6) {
      issues.push({
        kind: 'overrun',
        start: seg.start_sec,
        end: seg.end_sec,
        seconds: Math.round((seg.speech_sec - window) * 10) / 10,
      });
    }
  }

  if (durationSec > 1 && spoken.length) {
    const last = Math.max(...spoken.map((row) => row.end));
    if (durationSec - last > 8) {
      const tailImportant = (analysis || []).some((beat) => (
        beat.start >= last && beat.narration_recommended
      ));
      if (tailImportant) {
        issues.push({ kind: 'gap', start: last, end: durationSec, seconds: durationSec - last });
      }
    }
  }

  return issues;
}
