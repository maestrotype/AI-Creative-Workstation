/** Turn the ready chapter script into lines that can fill the picture. */

export const NARRATION_WPM = 130;
const BEAT_SEC = 14;
const ONE_BEAT_MAX = 18;

export interface SpeechChapter {
  title: string;
  startSec: number;
  endSec: number;
  /** The authored voiceover. This is the meaning. */
  script: string;
}

export interface SpeechBeat {
  title: string;
  startSec: number;
  endSec: number;
  targetWords: number;
  /** The sentences of the ready script that belong to this beat. */
  brief: string;
  /** The whole chapter, so a short beat is expanded from the same facts. */
  script: string;
  part: number;
  parts: number;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function wordsForSeconds(sec: number): number {
  return Math.max(8, Math.round((Math.max(0.4, sec) * NARRATION_WPM) / 60));
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function beatCount(durationSec: number): number {
  if (durationSec <= ONE_BEAT_MAX) return 1;
  return Math.max(1, Math.round(durationSec / BEAT_SEC));
}

function chunks(parts: string[], count: number): string[] {
  if (count <= 1) return [parts.join(' ')];
  const out = Array.from({ length: count }, () => '');
  if (!parts.length) return out;
  const size = Math.ceil(parts.length / count);
  for (let index = 0; index < count; index += 1) {
    out[index] = parts.slice(index * size, (index + 1) * size).join(' ');
  }
  return out;
}

/** One beat per short chapter. A long chapter is split so each line has a word budget. */
export function planSpeechBeats(chapters: SpeechChapter[]): SpeechBeat[] {
  const beats: SpeechBeat[] = [];
  chapters.forEach((chapter) => {
    const duration = Math.max(0.4, chapter.endSec - chapter.startSec);
    const parts = beatCount(duration);
    const slices = chunks(sentences(chapter.script), parts);
    for (let index = 0; index < parts; index += 1) {
      const start = chapter.startSec + (duration * index) / parts;
      const end = index === parts - 1
        ? chapter.endSec
        : chapter.startSec + (duration * (index + 1)) / parts;
      beats.push({
        title: chapter.title,
        startSec: Math.round(start * 100) / 100,
        endSec: Math.round(end * 100) / 100,
        targetWords: wordsForSeconds(end - start),
        brief: slices[index] || '',
        script: chapter.script.trim(),
        part: index + 1,
        parts,
      });
    }
  });
  return beats;
}

/** The ready line is kept when it can already fill the beat. Otherwise it must be rewritten to the budget. */
export function lineNeedsFit(text: string, targetWords: number): 'keep' | 'expand' | 'trim' {
  const words = countWords(text);
  if (!words) return 'expand';
  if (words < Math.round(targetWords * 0.75)) return 'expand';
  if (words > Math.round(targetWords * 1.18)) return 'trim';
  return 'keep';
}
