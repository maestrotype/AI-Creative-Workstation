/** Place each spoken line on the picture slot it belongs to.

A long line is shortened to that slot. It does not push the next line off its picture.
A short line keeps the rest of the slot as silence.
*/

export const SPEECH_TEMPO_MAX = 1.15;

export interface PictureSlot {
  startSec: number;
  endSec: number;
}

export interface PictureSpan {
  title: string;
  startSec: number;
  endSec: number;
}

export interface NarrationPiece {
  id: string;
  label: string;
  startSec: number;
  durationSec: number;
  /** Picture time this line was written for. */
  anchorSec?: number | null;
}

export interface NarrationAlignPlan {
  /** Every line, in input order. */
  placements: Array<{ id: string; startSec: number }>;
  /** Lines whose start actually changes. */
  moves: Array<{ id: string; startSec: number }>;
  summary: string;
}

const EPS = 0.4;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clock(sec: number): string {
  const whole = Math.max(0, Math.round(sec));
  const min = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${min}:${String(rest).padStart(2, '0')}`;
}

function comparePieces(a: NarrationPiece, b: NarrationPiece): number {
  if (a.startSec !== b.startSec) return a.startSec - b.startSec;
  const an = Number(a.id);
  const bn = Number(b.id);
  const aNumeric = Number.isInteger(an) && String(an) === a.id;
  const bNumeric = Number.isInteger(bn) && String(bn) === b.id;
  if (aNumeric && bNumeric) return an - bn;
  return a.id.localeCompare(b.id);
}

function chapterAt(chapters: PictureSpan[], time: number): PictureSpan | null {
  return chapters.find((chapter) => time >= chapter.startSec - 0.05 && time < chapter.endSec - 0.05) ?? null;
}

/**
 * Where each spoken line should begin.
 * One line per chapter starts with that chapter.
 * Several lines use the picture time they were written for.
 * A later line never starts while the previous one is still playing.
 */
export function alignedNarrationStarts(
  durations: number[],
  anchors: Array<number | null | undefined>,
  chapters: PictureSpan[],
): { starts: number[]; summary: string } {
  const pieces: NarrationPiece[] = durations.map((durationSec, index) => ({
    id: String(index),
    label: `Реплика ${index + 1}`,
    startSec: -1,
    durationSec,
    anchorSec: anchors[index],
  }));
  const plan = planNarrationAlign(chapters, pieces);
  return {
    starts: pieces.map((piece) => plan.placements.find((row) => row.id === piece.id)?.startSec ?? 0),
    summary: plan.summary,
  };
}

/**
 * How many spoken lines each picture clip receives.
 * Every clip gets one line when there are enough lines. Extra lines go to the longer clips.
 */
export function lineCountsForPicture(chapters: PictureSpan[], count: number): number[] {
  const n = chapters.length;
  if (n === 0 || count <= 0) return chapters.map(() => 0);
  if (count === n) return chapters.map(() => 1);
  if (count < n) {
    const ranked = chapters
      .map((chapter, index) => ({ index, len: chapter.endSec - chapter.startSec }))
      .sort((a, b) => b.len - a.len || a.index - b.index);
    const counts = chapters.map(() => 0);
    for (let i = 0; i < count; i += 1) counts[ranked[i].index] = 1;
    return counts;
  }
  const counts = chapters.map(() => 1);
  const extra = count - n;
  const weights = chapters.map((chapter) => Math.max(0.4, chapter.endSec - chapter.startSec));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const extras = weights.map((weight) => Math.floor((extra * weight) / total));
  let used = extras.reduce((sum, value) => sum + value, 0);
  const remainder = weights
    .map((weight, index) => ({ index, frac: (extra * weight) / total - extras[index] }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  let cursor = 0;
  while (used < extra) {
    extras[remainder[cursor % remainder.length].index] += 1;
    used += 1;
    cursor += 1;
  }
  return counts.map((base, index) => base + extras[index]);
}

/** Tile the current V1 clips with the spoken lines, in order. Slots meet the picture edges. */
export function pictureSlots(chapters: PictureSpan[], lineCount: number): PictureSlot[] {
  const pics = [...chapters]
    .filter((chapter) => chapter.endSec - chapter.startSec >= 0.4)
    .sort((a, b) => a.startSec - b.startSec);
  if (!pics.length || lineCount <= 0) return [];
  const counts = lineCountsForPicture(pics, lineCount);
  const starts: number[] = [];
  pics.forEach((chapter, index) => {
    const n = counts[index];
    const span = chapter.endSec - chapter.startSec;
    for (let step = 0; step < n; step += 1) {
      starts.push(round2(chapter.startSec + (span * step) / n));
    }
  });
  return starts.map((start, index) => {
    const next = starts[index + 1];
    const home = chapterAt(pics, start) ?? pics[pics.length - 1];
    const end = next != null && next < home.endSec - 0.05 ? next : home.endSec;
    return { startSec: start, endSec: round2(Math.max(start + 0.4, end)) };
  });
}

/** Each line runs until the next one starts, so A1 has no hole between chapters. */
export function abutSlots(slots: PictureSlot[]): PictureSlot[] {
  return slots.map((slot, index) => {
    const next = slots[index + 1];
    if (!next || next.startSec <= slot.startSec + 0.05) return slot;
    return { startSec: slot.startSec, endSec: round2(Math.max(slot.endSec, next.startSec)) };
  });
}

/** Speech longer than the picture is rewritten. A small overrun can be sped up. Short speech is padded with silence. */
export function speechLockPlan(speechSec: number, windowSec: number): 'keep' | 'pad' | 'tempo' | 'shorten' | 'expand' {
  const window = Math.max(0.4, windowSec);
  const ratio = speechSec / window;
  if (ratio > SPEECH_TEMPO_MAX) return 'shorten';
  if (ratio > 1.05) return 'tempo';
  if (ratio < 0.75) return 'expand';
  if (ratio < 0.98) return 'pad';
  return 'keep';
}

export function planNarrationAlign(chapters: PictureSpan[], pieces: NarrationPiece[]): NarrationAlignPlan {
  const pics = [...chapters]
    .filter((chapter) => chapter.endSec - chapter.startSec >= 0.4)
    .sort((a, b) => a.startSec - b.startSec);
  const lines = [...pieces].sort(comparePieces);
  if (!pics.length || !lines.length) {
    return {
      placements: lines.map((line) => ({ id: line.id, startSec: line.startSec })),
      moves: [],
      summary: 'На шкале нет глав видео или озвучки — подогнать не к чему.',
    };
  }

  const slots = pictureSlots(pics, lines.length);
  const resolved = slots.map((slot) => slot.startSec);
  const notes: string[] = [];
  lines.forEach((line, index) => {
    const slot = slots[index];
    const room = slot.endSec - slot.startSec;
    if (line.durationSec <= room + EPS) return;
    const home = chapterAt(pics, slot.startSec) ?? pics[0];
    notes.push(
      `«${line.label}» звучит ${line.durationSec.toFixed(1)} с, а кадр «${home.title}» даёт ей ${room.toFixed(1)} с. Реплика укорачивается под этот кадр и не сдвигает следующую.`,
    );
  });

  pics.forEach((chapter) => {
    const hasLine = resolved.some((start) => start >= chapter.startSec - 0.2 && start < chapter.endSec - 0.2);
    if (!hasLine) {
      notes.push(`В главе «${chapter.title}» (${clock(chapter.startSec)}) нет реплики, которая начинается вместе с кадром.`);
    }
  });

  const moves = lines
    .map((line, index) => ({ id: line.id, startSec: resolved[index] }))
    .filter((move, index) => Math.abs(move.startSec - lines[index].startSec) > 0.12);

  const unplaced = lines.every((line) => line.startSec < 0);
  let summary: string;
  if (unplaced) {
    summary = notes.length
      ? notes.join(' ')
      : 'Реплики поставлены на начало своих глав.';
  } else if (!moves.length && !notes.length) {
    summary = 'Озвучка уже начинается вместе с главами.';
  } else if (!moves.length) {
    summary = `Сдвигать нечего: реплики и так стоят вплотную. ${notes.join(' ')}`;
  } else {
    summary = [`Сдвинул ${moves.length} реплик к кадрам.`, ...notes].join(' ');
  }
  const byId = new Map(lines.map((line, index) => [line.id, resolved[index]]));
  return {
    placements: pieces.map((piece) => ({ id: piece.id, startSec: byId.get(piece.id) ?? piece.startSec })),
    moves,
    summary,
  };
}

