import { describe, expect, it } from 'vitest';

import { abutSlots, alignedNarrationStarts, coverPictureGaps, narrationBeats, pictureSlots, planNarrationAlign, speechLockPlan, textForBeat, tileScriptToPicture } from './narrationAlign';

const threeChapters = [
  { title: 'Hero', startSec: 0, endSec: 12 },
  { title: 'Главная и Product Stage', startSec: 12, endSec: 54.8 },
  { title: 'Темы и языки', startSec: 54.8, endSec: 97.6 },
];

describe('planNarrationAlign', () => {
  it('moves one line onto the start of each chapter when the speech fits', () => {
    const plan = planNarrationAlign(threeChapters, [
      { id: 'a', label: 'Hook', startSec: 0, durationSec: 8 },
      { id: 'b', label: 'Body', startSec: 8, durationSec: 10 },
      { id: 'c', label: 'Body 2', startSec: 18, durationSec: 12 },
    ]);
    expect(plan.moves.map((move) => move.startSec)).toEqual([12, 54.8]);
    expect(plan.summary).toContain('Сдвинул');
    expect(plan.summary).not.toContain('заходит');
  });

  it('keeps a long line inside its picture and does not push the next line', () => {
    const plan = planNarrationAlign(threeChapters, [
      { id: 'a', label: 'Hook', startSec: 0, durationSec: 16.8 },
      { id: 'b', label: 'Body', startSec: 16.8, durationSec: 21.9 },
      { id: 'c', label: 'Body 2', startSec: 38.7, durationSec: 16.6 },
      { id: 'd', label: 'Body 3', startSec: 55.3, durationSec: 15.2 },
      { id: 'e', label: 'Body 4', startSec: 70.5, durationSec: 15.8 },
    ]);
    const starts = new Map(plan.placements.map((row) => [row.id, row.startSec]));
    expect(starts.get('a')).toBe(0);
    expect(starts.get('b')).toBe(12);
    expect(plan.summary).toContain('Hook');
    expect(plan.summary).toContain('Hero');
    expect(plan.summary).toContain('не сдвигает');
  });

  it('follows picture anchors when there are more lines than chapters', () => {
    const plan = planNarrationAlign(
      [
        { title: 'A', startSec: 0, endSec: 30 },
        { title: 'B', startSec: 30, endSec: 60 },
      ],
      [
        { id: 'a', label: '1', startSec: 0, durationSec: 6, anchorSec: 0 },
        { id: 'b', label: '2', startSec: 6, durationSec: 6, anchorSec: 30 },
      ],
    );
    expect(plan.moves).toEqual([{ id: 'b', startSec: 30 }]);
  });
});

describe('alignedNarrationStarts', () => {
  it('starts each new voiceover on its chapter instead of packing from zero', () => {
    const aligned = alignedNarrationStarts(
      [8, 10, 12],
      [0, 12, 54.8],
      threeChapters,
    );
    expect(aligned.starts).toEqual([0, 12, 54.8]);
  });

  it('does not move the last lines in front of line 2', () => {
    const durations = [6.8, 4.9, 6.4, 5.9, 6.2, 7.9, 8.5, 6.4, 6.9, 6.2, 6.2, 10.4];
    const aligned = alignedNarrationStarts(
      durations,
      durations.map((_, index) => (index === 0 ? 1.95 : 20 + index * 15)),
      [
        { title: 'Open', startSec: 12, endSec: 40 },
        { title: 'Rest', startSec: 40, endSec: 400 },
      ],
    );
    expect(aligned.starts[11]).toBeGreaterThan(aligned.starts[2]);
    expect(aligned.starts[10]).toBeGreaterThan(aligned.starts[1]);
  });

  it('keeps the next line on its picture when the previous sentence is longer', () => {
    const aligned = alignedNarrationStarts([16.8, 20], [0, 12], threeChapters.slice(0, 2));
    expect(aligned.starts).toEqual([0, 12]);
    expect(aligned.summary).toContain('не сдвигает');
  });

  it('tiles a long chapter with equal slots that end on the picture edge', () => {
    const slots = pictureSlots(
      [{ title: 'Корзина', startSec: 200, endSec: 300.5 }],
      4,
    );
    expect(slots[0].startSec).toBe(200);
    expect(slots[3].endSec).toBe(300.5);
    expect(slots[1].startSec).toBeCloseTo(225.13, 1);
    const covered = slots.reduce((sum, slot) => sum + (slot.endSec - slot.startSec), 0);
    expect(covered).toBeCloseTo(100.5, 1);
  });

  it('closes only a tiny join, not a real hole that needs its own line', () => {
    const tiny = abutSlots([
      { startSec: 0, endSec: 12 },
      { startSec: 12.8, endSec: 24 },
    ]);
    expect(tiny[0].endSec).toBe(12.8);
    const hole = abutSlots([
      { startSec: 0, endSec: 12 },
      { startSec: 18, endSec: 30 },
    ]);
    expect(hole[0].endSec).toBe(12);
  });
});

describe('narrationBeats', () => {
  it('tiles a long chapter so the next line starts where the previous one ends', () => {
    const beats = narrationBeats([{ title: 'Catalog', startSec: 0, endSec: 41.2 }]);
    expect(beats.length).toBe(3);
    expect(beats[0].startSec).toBe(0);
    expect(beats[2].endSec).toBe(41.2);
    for (let index = 1; index < beats.length; index += 1) {
      expect(beats[index].startSec).toBe(beats[index - 1].endSec);
    }
    expect(textForBeat(['one', 'two', 'three'], 1, 3)).toBe('two');
  });
});

describe('tileScriptToPicture', () => {
  it('keeps one line per window and splits a long window into empty lines to be written', () => {
    const lines: Array<{ start_sec: number; end_sec: number; text: string; brief?: string }> = [
      { start_sec: 0, end_sec: 5, text: 'Первая.' },
      { start_sec: 6, end_sec: 10, text: 'Вторая.' },
    ];
    const tiled = tileScriptToPicture(lines, 40, { split: true });
    expect(tiled.map((row) => [row.start_sec, row.end_sec])).toEqual([[0, 6], [6, 23], [23, 40]]);
    expect(tiled.map((row) => row.text)).toEqual(['Первая.', 'Вторая.', '']);
    expect(tiled[2].brief).toBe('Вторая.');
  });
});

describe('coverPictureGaps', () => {
  it('inserts an empty window for a hole so the writer can fill it', () => {
    const covered = coverPictureGaps(
      [
        { start_sec: 0, end_sec: 9, text: 'Первая.' },
        { start_sec: 20, end_sec: 30, text: 'Третья.' },
      ],
      40,
    );
    expect(covered.map((row) => [row.start_sec, row.end_sec, row.text])).toEqual([
      [0, 9, 'Первая.'],
      [9, 20, ''],
      [20, 30, 'Третья.'],
      [30, 40, ''],
    ]);
  });

  it('covers a leading hole so A1 does not idle while the picture already runs', () => {
    const covered = coverPictureGaps(
      [
        { start_sec: 8.2, end_sec: 18, text: 'Каталог открыт.' },
        { start_sec: 18, end_sec: 30, text: 'Карточка товара.' },
      ],
      41,
      0,
    );
    expect(covered.map((row) => [row.start_sec, row.end_sec, row.text])).toEqual([
      [0, 8.2, ''],
      [8.2, 18, 'Каталог открыт.'],
      [18, 30, 'Карточка товара.'],
      [30, 41, ''],
    ]);
  });
});

describe('speechLockPlan', () => {
  it('shortens speech that runs past the picture and pads speech that ends early', () => {
    expect(speechLockPlan(16.9, 12)).toBe('shorten');
    expect(speechLockPlan(13.2, 12)).toBe('tempo');
    expect(speechLockPlan(8.5, 14)).toBe('expand');
    expect(speechLockPlan(10.5, 12)).toBe('pad');
    expect(speechLockPlan(12, 12)).toBe('keep');
  });
});
