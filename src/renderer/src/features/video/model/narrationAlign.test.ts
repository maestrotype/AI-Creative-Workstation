import { describe, expect, it } from 'vitest';

import { alignedNarrationStarts, planNarrationAlign } from './narrationAlign';

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

  it('explains a line that is longer than its chapter and does not stack voices', () => {
    const plan = planNarrationAlign(threeChapters, [
      { id: 'a', label: 'Hook', startSec: 0, durationSec: 16.8 },
      { id: 'b', label: 'Body', startSec: 16.8, durationSec: 21.9 },
      { id: 'c', label: 'Body 2', startSec: 38.7, durationSec: 16.6 },
      { id: 'd', label: 'Body 3', startSec: 55.3, durationSec: 15.2 },
      { id: 'e', label: 'Body 4', startSec: 70.5, durationSec: 15.8 },
    ]);
    expect(plan.moves).toEqual([]);
    expect(plan.summary).toContain('Hook');
    expect(plan.summary).toContain('Hero');
    expect(plan.summary).toContain('Главная и Product Stage');
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

  it('keeps a later line from starting under the previous sentence', () => {
    const aligned = alignedNarrationStarts([16.8, 20], [0, 12], threeChapters.slice(0, 2));
    expect(aligned.starts).toEqual([0, 16.8]);
    expect(aligned.summary).toContain('заходит');
  });
});
