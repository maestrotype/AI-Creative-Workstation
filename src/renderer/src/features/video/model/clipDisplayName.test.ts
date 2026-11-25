import { describe, expect, it } from 'vitest';

import { narrationClipTitle, spokenStutters, withoutSpokenStutter } from './clipDisplayName';

describe('spoken lines', () => {
  it('drops a clause that was copied to fill the beat', () => {
    const line = 'новые товары. новые товары. новые товары. На странице магазина представлены новые модели кроссовок.';
    expect(spokenStutters(line)).toBe(true);
    expect(withoutSpokenStutter(line)).toBe(
      'новые товары. На странице магазина представлены новые модели кроссовок.',
    );
    expect(narrationClipTitle(line)).toBe('На странице магазина представлены новые');
  });

  it('keeps a line that says each thing once', () => {
    const line = 'На странице три категории: обувь, одежда и сумки.';
    expect(spokenStutters(line)).toBe(false);
    expect(narrationClipTitle(line)).toBe('На странице три категории обувь');
  });

  it('names a clip by a later sentence when its opening matches the neighbour', () => {
    const line = 'Главная страница 3D-каталог обуви. Здесь собраны новинки сезона и скидки.';
    expect(narrationClipTitle(line, 'Главная страница 3D-каталог обуви')).toBe('Здесь собраны новинки сезона скидки');
  });
});
