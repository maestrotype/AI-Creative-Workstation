export type ScriptSegmentRole = 'hook' | 'body' | 'outro' | 'cta';

export type NarrationLang = 'ru' | 'en';

export interface ScriptSegment {
  start_sec: number;
  end_sec: number;
  /** Russian source. Empty when the line was generated in English. */
  text: string;
  /** English narration. Filled by generation or by the Перевод tab. */
  text_en?: string;
  role: ScriptSegmentRole | string;
  purpose?: string;
  visual_summary?: string;
  estimated_sec?: number;
  /** Picture time this line belongs to. Speech may start later if the previous line is still playing. */
  anchor_sec?: number;
  audio_path?: string;
  /** Measured TTS duration after last A1 apply (seconds). */
  speech_sec?: number;
  /** Tempo factor applied to fit the scene window (1 = none). */
  speech_tempo?: number;
}

export interface VoiceoverScriptMeta {
  tone: string;
  language: string;
  words_per_min: number;
  provider: string;
  model?: string | null;
  /** Changes every time Generate replaces the script. A1 must be voiced for this value. */
  script_version?: number;
}

export interface VoiceoverScript {
  segments: ScriptSegment[];
  meta: VoiceoverScriptMeta;
}

export function emptyVoiceoverScript(): VoiceoverScript | null {
  return null;
}

/** The line that should be spoken and shown for the open language tab. */
export function segmentSpoken(segment: Pick<ScriptSegment, 'text' | 'text_en'>, lang: NarrationLang): string {
  if (lang === 'en') return (segment.text_en || '').trim();
  return segment.text.trim();
}

export function scriptWordCount(script: VoiceoverScript | null): number {
  if (!script) return 0;
  return script.segments.reduce(
    (sum, seg) => sum + seg.text.split(/\s+/).filter(Boolean).length,
    0,
  );
}
