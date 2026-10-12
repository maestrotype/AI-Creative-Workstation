import { describe, expect, it } from 'vitest';

import { lineNeedsFit, planSpeechBeats, wordsForSeconds } from './chapterSpeech';

const hero = 'Это готовый интернет-магазин: витрина на Angular 17, API на NestJS, база PostgreSQL, 3D на Three.js. В архиве исходники, Docker Compose и документация.';

describe('planSpeechBeats', () => {
  it('keeps a 12 second card as one line and budgets about 26 words', () => {
    const beats = planSpeechBeats([{
      title: 'Что это за продукт',
      startSec: 0,
      endSec: 12,
      script: hero,
    }]);
    expect(beats).toHaveLength(1);
    expect(beats[0].targetWords).toBe(wordsForSeconds(12));
    expect(beats[0].targetWords).toBeGreaterThan(20);
    expect(beats[0].brief).toContain('Angular 17');
    expect(lineNeedsFit(hero, beats[0].targetWords)).toBe('keep');
  });

  it('splits a long chapter so the ready script is not one short line on a long recording', () => {
    const beats = planSpeechBeats([{
      title: 'Корзина и оплата',
      startSec: 200,
      endSec: 300.5,
      script: 'Дальше корзина и оформление. Stripe и LiqPay в тестовом режиме.',
    }]);
    expect(beats.length).toBeGreaterThan(4);
    expect(beats[0].startSec).toBe(200);
    expect(beats[beats.length - 1].endSec).toBe(300.5);
    expect(beats[0].script).toContain('Stripe');
    expect(lineNeedsFit(beats[0].brief, beats[0].targetWords)).toBe('expand');
    const covered = beats.reduce((sum, beat) => sum + (beat.endSec - beat.startSec), 0);
    expect(covered).toBeCloseTo(100.5, 1);
  });
});
