/** Place narration on the picture it belongs to, without laying two lines on top of each other. */

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

export function planNarrationAlign(chapters: PictureSpan[], pieces: NarrationPiece[]): NarrationAlignPlan {
  const pics = [...chapters]
    .filter((chapter) => chapter.endSec - chapter.startSec >= 0.4)
    .sort((a, b) => a.startSec - b.startSec);
  const lines = [...pieces].sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id));
  if (!pics.length || !lines.length) {
    return {
      placements: lines.map((line) => ({ id: line.id, startSec: line.startSec })),
      moves: [],
      summary: 'На шкале нет глав видео или озвучки — подогнать не к чему.',
    };
  }

  const targets = targetStarts(pics, lines);
  const resolved: number[] = [];
  const notes: string[] = [];
  let cursor = 0;
  lines.forEach((line, index) => {
    const want = targets[index];
    const start = round2(Math.max(want, cursor));
    resolved.push(start);
    const dur = Math.max(0.05, line.durationSec);
    const home = chapterAt(pics, want) ?? pics[Math.min(index, pics.length - 1)];
    if (start > want + EPS) {
      notes.push(
        `«${line.label}» должна начаться в ${clock(want)} вместе с «${home.title}», но предыдущая речь заканчивается только в ${clock(start)}.`,
      );
    }
    cursor = start + dur;
  });

  lines.forEach((line, index) => {
    const start = resolved[index];
    const end = start + Math.max(0.05, line.durationSec);
    const home = chapterAt(pics, start);
    if (!home || end <= home.endSec + EPS) return;
    const extra = end - home.endSec;
    const next = pics.find((chapter) => chapter.startSec >= home.endSec - 0.05 && chapter !== home);
    const chapterLen = home.endSec - home.startSec;
    notes.push(
      next
        ? `«${line.label}» длится ${line.durationSec.toFixed(1)} с, глава «${home.title}» — ${chapterLen.toFixed(1)} с. Речь на ${extra.toFixed(1)} с заходит на «${next.title}» и сдвигает всё, что после.`
        : `«${line.label}» на ${extra.toFixed(1)} с длиннее главы «${home.title}».`,
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

function targetStarts(chapters: PictureSpan[], lines: NarrationPiece[]): number[] {
  if (lines.length === chapters.length) {
    return chapters.map((chapter) => chapter.startSec);
  }
  const filmEnd = chapters[chapters.length - 1].endSec;
  const insidePicture = (anchor: number) => anchor >= chapters[0].startSec - 0.2 && anchor < filmEnd + 0.2;
  const anchors = lines.map((line) => line.anchorSec);
  const anchorsUseful = anchors.every((anchor) => typeof anchor === 'number' && Number.isFinite(anchor) && insidePicture(anchor))
    && anchors.some((anchor, index) => Math.abs((anchor as number) - lines[index].startSec) > EPS);
  if (anchorsUseful) {
    return anchors as number[];
  }
  const groups: number[][] = chapters.map(() => []);
  lines.forEach((line, index) => {
    const end = line.startSec + Math.max(0.05, line.durationSec);
    let best = 0;
    let bestOverlap = -1;
    chapters.forEach((chapter, chapterIndex) => {
      const overlap = Math.min(end, chapter.endSec) - Math.max(line.startSec, chapter.startSec);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = chapterIndex;
      }
    });
    groups[best].push(index);
  });
  const targets = new Array<number>(lines.length).fill(0);
  groups.forEach((indexes, chapterIndex) => {
    let cursor = chapters[chapterIndex].startSec;
    indexes.forEach((index) => {
      targets[index] = cursor;
      cursor += Math.max(0.05, lines[index].durationSec);
    });
  });
  return targets;
}
