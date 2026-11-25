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
  /** Meaning this line must carry. Set when a long window was split and the line is written from it. */
  brief?: string;
  /** What the text review still flags after its rewrites. Cleared when the line is edited. */
  review_issues?: string[];
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

/**
 * Same words that are already spoken. Short clips become one line: speaking
 * each whisper scrap on its own is what cuts words off and stacks noise.
 */
export function scriptFromTranscript(
  transcript: { segments: Array<{ start: number; end: number; text: string }>; language?: string; full_text?: string } | null | undefined,
  durationSec = 0,
): VoiceoverScript | null {
  const raw = (transcript?.segments ?? [])
    .map((seg) => ({
      start: Math.max(0, seg.start),
      end: Math.max(seg.start, seg.end),
      text: seg.text.replace(/\s+/g, ' ').trim(),
    }))
    .filter((seg) => seg.text)
    .sort((a, b) => a.start - b.start);
  const fallback = (transcript?.full_text || '').replace(/\s+/g, ' ').trim();
  const pieces = raw.length > 0
    ? raw
    : fallback
      ? [{ start: 0, end: Math.max(0.4, durationSec), text: fallback }]
      : [];
  if (!pieces.length) return null;
  const span = pieces[pieces.length - 1].end - pieces[0].start;
  const joined = span <= 22 || pieces.length <= 6
    ? [{
      start: pieces[0].start,
      end: Math.max(pieces[pieces.length - 1].end, pieces[0].start + 0.4),
      text: pieces.map((seg) => seg.text).join(' '),
    }]
    : pieces;
  const language = (transcript?.language || 'ru').toLowerCase();
  const english = language.startsWith('en');
  return {
    segments: joined.map((seg, index) => ({
      start_sec: seg.start,
      end_sec: Math.max(seg.end, seg.start + 0.4),
      text: english ? '' : seg.text,
      text_en: english ? seg.text : '',
      role: index === 0 ? 'hook' : index === joined.length - 1 ? 'outro' : 'body',
      anchor_sec: seg.start,
      purpose: 'respeak',
    })),
    meta: {
      tone: 'respeak',
      language: language.startsWith('en') ? 'en' : language.slice(0, 8) || 'ru',
      words_per_min: 130,
      provider: 'transcript',
      script_version: Date.now(),
    },
  };
}

export function scriptWordCount(script: VoiceoverScript | null): number {
  if (!script) return 0;
  return script.segments.reduce(
    (sum, seg) => sum + seg.text.split(/\s+/).filter(Boolean).length,
    0,
  );
}
