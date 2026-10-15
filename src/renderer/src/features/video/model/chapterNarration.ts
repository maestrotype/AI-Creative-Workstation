import type { BinItem, TimelineClip } from './directorTimeline';
import { MARKETPLACE_V0_BLOCKS } from './marketplaceVoiceoverPack';
import type { TranscriptSegment } from './videoAnalysis';
import type { VoiceoverScript } from './voiceoverScript';

/** One picture chapter on V1, in timeline order. Times are the cut, not the template. */
export interface ChapterWindow {
  title: string;
  startSec: number;
  endSec: number;
  /** What this chapter is supposed to show. */
  intent: string;
  /** Prepared spoken line. The model rewrites it to the real picture and length. */
  draft: string;
  /** What the author actually said in this window. */
  said: string;
  /** Opening/closing cards are stills; screencast chapters are video. */
  mediaKind: 'video' | 'image';
}

export function v1ChapterSpans(
  clips: TimelineClip[],
  bins: BinItem[],
): Array<{ title: string; startSec: number; endSec: number; mediaKind: 'video' | 'image' }> {
  return clips
    .filter((clip) => clip.track === 'v1' && clip.binId)
    .map((clip) => {
      const bin = bins.find((item) => item.id === clip.binId);
      // Opening and closing cards are stills. They are chapters of the film.
      if (!bin || (bin.kind !== 'video' && bin.kind !== 'image')) return null;
      const dur = Math.max(0.5, clip.durationSec || bin.durationSec || 0);
      return {
        title: (clip.label || bin.name || '').trim() || 'Глава',
        startSec: clip.startSec,
        endSec: clip.startSec + dur,
        mediaKind: bin.kind === 'image' ? 'image' as const : 'video' as const,
      };
    })
    .filter((row): row is { title: string; startSec: number; endSec: number; mediaKind: 'video' | 'image' } => Boolean(row))
    .sort((a, b) => a.startSec - b.startSec);
}

export function useMarketplaceChapters(
  brief: string,
  prompt: string,
  script: VoiceoverScript | null | undefined,
): boolean {
  if (script?.meta.model === 'preset:marketplace_v0') return true;
  const blob = `${brief}\n${prompt}\n${(script?.segments ?? []).map((seg) => seg.purpose || '').join(' ')}`;
  return /Angular 3D Ecommerce|маркетплейс|3D Store/i.test(blob);
}

export function buildChapterPlan(
  clips: TimelineClip[],
  bins: BinItem[],
  options: {
    script?: VoiceoverScript | null;
    brief?: string;
    prompt?: string;
  } = {},
): ChapterWindow[] {
  const spans = v1ChapterSpans(clips, bins);
  if (spans.length < 2) return [];
  const drafts = options.script?.segments ?? [];
  const paired = drafts.length === spans.length;
  const pack = !paired && spans.length === MARKETPLACE_V0_BLOCKS.length
    && useMarketplaceChapters(options.brief || '', options.prompt || '', options.script);
  return spans.map((span, index) => {
    const block = pack ? MARKETPLACE_V0_BLOCKS[index] : null;
    const draft = paired ? drafts[index] : null;
    return {
      title: (draft?.purpose || block?.titleRu || span.title).trim(),
      startSec: span.startSec,
      endSec: span.endSec,
      intent: (draft?.visual_summary || block?.shootRu || '').trim(),
      draft: (draft?.text || block?.voiceoverRu || '').trim(),
      said: '',
      mediaKind: span.mediaKind,
    };
  });
}

export function withTranscript(
  chapters: ChapterWindow[],
  segments: TranscriptSegment[],
): ChapterWindow[] {
  return chapters.map((chapter) => ({
    ...chapter,
    said: segments
      .filter((seg) => Math.min(chapter.endSec, seg.end) - Math.max(chapter.startSec, seg.start) > 0.2)
      .map((seg) => seg.text.trim())
      .filter(Boolean)
      .join(' ')
      .slice(0, 700),
  }));
}

export function chaptersPayload(chapters: ChapterWindow[]): Array<{
  title: string;
  start: number;
  end: number;
  intent: string;
  draft: string;
  said: string;
}> {
  return chapters.map((chapter) => ({
    title: chapter.title,
    start: round2(chapter.startSec),
    end: round2(chapter.endSec),
    intent: chapter.intent,
    draft: chapter.draft,
    said: chapter.said,
  }));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * One spoken line per chapter, from the text already written on the chapter card.
 * Returns null when any chapter has no line, so the caller can ask the model.
 */
export function scriptFromChapterDrafts(
  chapters: ChapterWindow[],
  scenePrompts: Array<{ title: string; prompt: string }> = [],
): VoiceoverScript | null {
  if (chapters.length < 2) return null;
  const byTitle = new Map(
    scenePrompts
      .map((scene) => [scene.title.trim(), scene.prompt.trim()] as const)
      .filter((entry) => entry[1]),
  );
  const lines = chapters.map((chapter) => byTitle.get(chapter.title.trim()) || chapter.draft.trim());
  if (lines.some((line) => !line)) return null;
  return {
    segments: chapters.map((chapter, index) => ({
      start_sec: round2(chapter.startSec),
      end_sec: round2(chapter.endSec),
      anchor_sec: round2(chapter.startSec),
      text: lines[index],
      role: index === 0 ? 'hook' : index === chapters.length - 1 ? 'cta' : 'body',
      purpose: chapter.title,
      visual_summary: chapter.intent,
    })),
    meta: {
      tone: 'commercial',
      language: 'ru',
      words_per_min: 130,
      provider: 'chapters',
      model: 'authored-chapters',
      script_version: Date.now(),
    },
  };
}
