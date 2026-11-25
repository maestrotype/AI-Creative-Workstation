import { describe, expect, it } from 'vitest';

import { isVoiceoverIntent } from './startVoiceover';

describe('isVoiceoverIntent', () => {
  it('recognises a request to replace speech on a finished video', () => {
    expect(isVoiceoverIntent(
      'Проанализируй видео, нужно переделать озвучку голосом из моих ресурсов которые сохранены',
    )).toBe(true);
    expect(isVoiceoverIntent('Replace the voiceover with my sample')).toBe(true);
  });

  it('leaves picture prompts on the create page', () => {
    expect(isVoiceoverIntent('Серая шёлковая сумка по этой кожаной')).toBe(false);
    expect(isVoiceoverIntent('Титр для админки 3D Store')).toBe(false);
  });
});
