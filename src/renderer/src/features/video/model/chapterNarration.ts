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
}

export function v1ChapterSpans(
  clips: TimelineClip[],
  bins: BinItem[],
): Array<{ title: string; startSec: number; endSec: number }> {
  return clips
    .filter((clip) => clip.track === 'v1' && clip.binId)
    .map((clip) => {
      const bin = bins.find((item) => item.id === clip.binId);
      if (!bin || bin.kind !== 'video') return null;
      const dur = Math.max(0.5, clip.durationSec || bin.durationSec || 0);
      return {
        title: (clip.label || bin.name || '').trim() || 'Глава',
        startSec: clip.startSec,
        endSec: clip.startSec + dur,
      };
    })
    .filter((row): row is { title: string; startSec: number; endSec: number } => Boolean(row))
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
