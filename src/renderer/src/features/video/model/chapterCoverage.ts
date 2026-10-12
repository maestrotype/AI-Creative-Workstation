import type { ChapterWindow } from './chapterNarration';
import type { SceneAnalysis } from './videoAnalysis';

/** Speaking rate the timeline budget uses. Same 130 words/min as the script. */
export const NARRATION_WPM = 130;

const LINE_SEC = 14;
const MIN_BEAT_SEC = 8;

export interface PictureNote {
  start: number;
  end: number;
  text: string;
}

export interface CoverageBeat {
  startSec: number;
  endSec: number;
  targetWords: number;
  /** The ready-script sentence this beat has to say. */
  brief: string;
  /** What the chapter analysis shows while this beat plays. */
  seen: string;
}

export interface ChapterCoverage {
  title: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  /** Words that fill this chapter at the speaking rate. */
  targetWords: number;
  /** Words already written in the ready script. */
  authoredWords: number;
  script: string;
  beats: CoverageBeat[];
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function wordsForSeconds(sec: number, wpm = NARRATION_WPM): number {
  return Math.max(8, Math.round((Math.max(0.8, sec) * wpm) / 60));
}

export function pictureNotesFromAnalysis(rows: SceneAnalysis[] | undefined): PictureNote[] {
  return (rows ?? [])
    .map((row) => ({
      start: row.start,
      end: row.end,
      text: [
        row.visual_summary,
        row.demonstrated_feature,
        row.user_doing,
        ...(row.ui_elements ?? []).slice(0, 6),
      ].filter((part) => part && part.trim()).join('. '),
    }))
    .filter((note) => note.end > note.start + 0.2 && note.text.trim());
}

function sentencesOf(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const parts = clean.split(/(?<=[.!?…])\s+/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [clean];
}

function uniqueSorted(values: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of [...values].sort((a, b) => a - b)) {
    const key = Math.round(value * 100);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function mergeShortestPair(spans: Array<{ startSec: number; endSec: number }>): Array<{ startSec: number; endSec: number }> {
  let best = 0;
  let bestLen = Infinity;
  for (let i = 0; i < spans.length - 1; i += 1) {
    const len = spans[i + 1].endSec - spans[i].startSec;
    if (len < bestLen) {
      bestLen = len;
      best = i;
    }
  }
  return [
    ...spans.slice(0, best),
    { startSec: spans[best].startSec, endSec: spans[best + 1].endSec },
    ...spans.slice(best + 2),
  ];
}

/** Picture cuts become beats. Short cuts merge. A long stretch splits to about 14s. */
export function beatBounds(
  start: number,
  end: number,
  cuts: number[],
): Array<{ startSec: number; endSec: number }> {
  const duration = Math.max(0.5, end - start);
  const target = Math.max(1, Math.round(duration / LINE_SEC));
  const points = uniqueSorted([
    start,
    ...cuts.filter((cut) => cut > start + MIN_BEAT_SEC - 0.2 && cut < end - (MIN_BEAT_SEC - 0.2)),
    end,
  ]);
  let spans: Array<{ startSec: number; endSec: number }> = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    spans.push({ startSec: points[i], endSec: points[i + 1] });
  }
  let guard = 0;
  while (spans.length > 1 && spans.some((span) => span.endSec - span.startSec < MIN_BEAT_SEC) && guard < 24) {
    guard += 1;
    let idx = 0;
    let shortest = Infinity;
    spans.forEach((span, index) => {
      const len = span.endSec - span.startSec;
      if (len < shortest) {
        shortest = len;
        idx = index;
      }
    });
    const left = idx > 0 ? spans[idx - 1].endSec - spans[idx - 1].startSec : Infinity;
    const right = idx < spans.length - 1 ? spans[idx + 1].endSec - spans[idx + 1].startSec : Infinity;
    const partner = left <= right ? idx - 1 : idx + 1;
    if (partner < 0 || partner >= spans.length) break;
    const a = Math.min(idx, partner);
    const b = Math.max(idx, partner);
    spans = [
      ...spans.slice(0, a),
      { startSec: spans[a].startSec, endSec: spans[b].endSec },
      ...spans.slice(b + 1),
    ];
  }
  const split: Array<{ startSec: number; endSec: number }> = [];
  for (const span of spans) {
    const len = span.endSec - span.startSec;
    const parts = Math.max(1, Math.round(len / LINE_SEC));
    if (parts <= 1) {
      split.push(span);
      continue;
    }
    const step = len / parts;
    for (let i = 0; i < parts; i += 1) {
      split.push({
        startSec: span.startSec + i * step,
        endSec: i === parts - 1 ? span.endSec : span.startSec + (i + 1) * step,
      });
    }
  }
  let fitted = split.length ? split : [{ startSec: start, endSec: end }];
  while (fitted.length > target + 1) fitted = mergeShortestPair(fitted);
  const rounded = fitted.map((span) => ({
    startSec: Math.round(span.startSec * 100) / 100,
    endSec: Math.round(span.endSec * 100) / 100,
  }));
  if (rounded.length) {
    rounded[0].startSec = Math.round(start * 100) / 100;
    rounded[rounded.length - 1].endSec = Math.round(end * 100) / 100;
  }
  return rounded;
}

function seenIn(start: number, end: number, notes: PictureNote[]): string {
  const parts: string[] = [];
  for (const note of notes) {
    const overlap = Math.min(end, note.end) - Math.max(start, note.start);
    const text = note.text.trim();
    if (overlap > 0.4 && text && !parts.includes(text)) parts.push(text);
  }
  return parts.join(' ').slice(0, 320);
}

function briefsFor(script: string, count: number): string[] {
  const sentences = sentencesOf(script);
  if (!sentences.length) return Array.from({ length: count }, () => '');
  return Array.from({ length: count }, (_, index) => {
    const at = Math.min(sentences.length - 1, Math.floor((index * sentences.length) / count));
    return sentences[at];
  });
}

/**
 * How many words each chapter needs, from its real length.
 * The ready script is spread across those beats. Picture notes say what is visible.
 */
export function planChapterCoverage(
  chapters: ChapterWindow[],
  notes: PictureNote[] = [],
): ChapterCoverage[] {
  const cuts = notes.map((note) => note.start);
  return chapters
    .filter((chapter) => chapter.endSec - chapter.startSec >= 0.5)
    .map((chapter) => {
      const bounds = beatBounds(chapter.startSec, chapter.endSec, cuts);
      const script = chapter.draft.trim();
      const briefs = briefsFor(script, bounds.length);
      const beats = bounds.map((bound, index) => {
        const room = Math.max(4, bound.endSec - bound.startSec - 0.4);
        return {
          startSec: bound.startSec,
          endSec: bound.endSec,
          targetWords: wordsForSeconds(room),
          brief: briefs[index] || script,
          seen: seenIn(bound.startSec, bound.endSec, notes),
        };
      });
      return {
        title: chapter.title,
        startSec: chapter.startSec,
        endSec: chapter.endSec,
        durationSec: Math.round((chapter.endSec - chapter.startSec) * 100) / 100,
        targetWords: beats.reduce((sum, beat) => sum + beat.targetWords, 0),
        authoredWords: countWords(script),
        script,
        beats,
      };
    });
}
