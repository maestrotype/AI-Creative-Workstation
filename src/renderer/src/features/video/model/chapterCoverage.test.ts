import { describe, expect, it } from 'vitest';

import { beatBounds, countWords, planChapterCoverage, wordsForSeconds } from './chapterCoverage';
import type { ChapterWindow } from './chapterNarration';

function chapter(title: string, start: number, end: number, draft: string): ChapterWindow {
  return { title, startSec: start, endSec: end, intent: '', draft, said: '', mediaKind: 'video' };
}

describe('chapter coverage', () => {
  it('gives a short card one beat and a long chapter enough words to fill it', () => {
    const cart = 'Дальше обычный магазинный путь: корзина, контакты, доставка, выбор оплаты. Stripe и LiqPay подключаются ключами.';
    const plan = planChapterCoverage([
      chapter('Что это за продукт', 0, 12, 'Это готовый интернет-магазин на Angular.'),
      chapter('Корзина и оплата', 79.27, 188.07, cart),
    ]);
    expect(plan[0].beats).toHaveLength(1);
    expect(plan[0].beats[0].startSec).toBe(0);
    expect(plan[0].beats[0].endSec).toBe(12);
    expect(plan[0].targetWords).toBeGreaterThan(countWords(plan[0].script) - 5);

    const long = plan[1];
    expect(long.beats.length).toBeGreaterThan(4);
    expect(long.beats[0].startSec).toBe(79.27);
    expect(long.beats[long.beats.length - 1].endSec).toBe(188.07);
    // Without picture notes, word budgets stay near the authored meaning — no tautology pad.
    expect(long.targetWords).toBeGreaterThan(long.authoredWords);
    expect(long.targetWords).toBeLessThan(wordsForSeconds(100));
    const covered = long.beats.reduce((sum, beat) => sum + (beat.endSec - beat.startSec), 0);
    expect(covered).toBeCloseTo(108.8, 0);
  });

  it('asks for a full word budget when the picture note gives something new to say', () => {
    const cart = 'Дальше корзина и оплата.';
    const plan = planChapterCoverage(
      [chapter('Корзина', 0, 30, cart)],
      [{ start: 0, end: 15, text: 'окно корзины с итогом' }, { start: 15, end: 30, text: 'выбор Stripe' }],
    );
    expect(plan[0].beats.every((beat) => beat.seen.trim())).toBe(true);
    expect(plan[0].targetWords).toBeGreaterThanOrEqual(wordsForSeconds(28));
  });

  it('follows picture cuts and keeps the ready sentence on each beat', () => {
    const bounds = beatBounds(0, 60, [15, 30, 45]);
    expect(bounds.map((span) => [span.startSec, span.endSec])).toEqual([
      [0, 15],
      [15, 30],
      [30, 45],
      [45, 60],
    ]);
    const plan = planChapterCoverage(
      [chapter('Каталог', 0, 60, 'Каталог обычный магазин. Карточка открывает модель. В корзину можно положить сразу.')],
      [{ start: 30, end: 45, text: 'карточка товара с ценой' }],
    );
    expect(plan[0].beats).toHaveLength(4);
    expect(plan[0].beats[2].seen).toContain('карточка');
    expect(plan[0].beats[0].brief).not.toBe(plan[0].beats[3].brief);
  });
});
