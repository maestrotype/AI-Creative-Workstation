import { describe, expect, it } from 'vitest';

import { scriptFromTranscript } from './voiceoverScript';
import { isStockBrief } from './voiceoverSession';

describe('scriptFromTranscript', () => {
  it('keeps the words already spoken and does not invent a line', () => {
    const script = scriptFromTranscript({
      language: 'ru',
      full_text: 'Первая фраза. Вторая фраза.',
      segments: [
        { start: 0.2, end: 2.4, text: 'Первая фраза.' },
        { start: 2.6, end: 5.1, text: 'Вторая фраза.' },
      ],
    }, 6);
    expect(script?.meta.provider).toBe('transcript');
    expect(script?.segments).toHaveLength(1);
    expect(script?.segments[0].text).toBe('Первая фраза. Вторая фраза.');
    expect(script?.segments[0].start_sec).toBe(0.2);
  });

  it('returns nothing when the video has no speech', () => {
    expect(scriptFromTranscript({ language: 'ru', full_text: '  ', segments: [] }, 6)).toBeNull();
  });
});

describe('isStockBrief', () => {
  it('drops a pasted sample brief and keeps a line the user wrote', () => {
    expect(isStockBrief('Обзор Angular ecommerce-шаблона 3D Store: витрина')).toBe(true);
    expect(isStockBrief('')).toBe(true);
    expect(isStockBrief('Сказать тише и без приветствия')).toBe(false);
  });
});
