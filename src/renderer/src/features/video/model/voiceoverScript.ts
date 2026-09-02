export type ScriptSegmentRole = 'hook' | 'body' | 'outro' | 'cta';

export interface ScriptSegment {
  start_sec: number;
  end_sec: number;
  text: string;
  role: ScriptSegmentRole | string;
}

export interface VoiceoverScriptMeta {
  tone: string;
  language: string;
  words_per_min: number;
  provider: string;
  model?: string | null;
}

export interface VoiceoverScript {
  segments: ScriptSegment[];
  meta: VoiceoverScriptMeta;
}

export function emptyVoiceoverScript(): VoiceoverScript | null {
  return null;
}

export function scriptWordCount(script: VoiceoverScript | null): number {
  if (!script) return 0;
  return script.segments.reduce(
    (sum, seg) => sum + seg.text.split(/\s+/).filter(Boolean).length,
    0,
  );
}
