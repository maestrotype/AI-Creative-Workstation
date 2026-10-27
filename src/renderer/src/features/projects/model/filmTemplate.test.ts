import { describe, expect, it } from 'vitest';

import { chaptersFromProject, chaptersFromScenes, scenesFromTemplate } from './filmTemplate';
import { newScene } from './project';

describe('film template chapters', () => {
  it('stores the words of a chapter and drops recordings', () => {
    const scene = {
      ...newScene('Каталог'),
      prompt: 'Покажите сетку',
      recordSteps: 'Откройте Shop',
      textOverlay: 'Каталог',
      effectPrompt: 'живая запись',
      durationSec: 20,
      motion: 'import' as const,
      stillPath: '/tmp/still.png',
      clipPath: '/tmp/clip.mp4',
    };
    const [chapter] = chaptersFromScenes([scene]);
    expect(chapter).toEqual({
      title: 'Каталог',
      prompt: 'Покажите сетку',
      recordSteps: 'Откройте Shop',
      effectPrompt: 'живая запись',
      textOverlay: 'Каталог',
      durationSec: 20,
      motion: 'import',
    });
    const [copy] = scenesFromTemplate([chapter]);
    expect(copy.id).not.toBe(scene.id);
    expect(copy.clipPath).toBeNull();
    expect(copy.stillPath).toBeNull();
    expect(copy.prompt).toBe('Покажите сетку');
  });

  it('saves edited timeline sections instead of stale project scenes', () => {
    const stale = newScene('Исходное видео');
    const chapters = chaptersFromProject({
      scenes: [stale],
      voiceover: null,
      timeline: {
        bins: [{
          id: 'source',
          kind: 'video',
          path: '/tmp/source.mp4',
          name: 'source.mp4',
          durationSec: 20,
          inSec: 0,
          outSec: 20,
        }],
        clips: [
          {
            id: 'intro',
            binId: 'source',
            track: 'v1',
            startSec: 0,
            durationSec: 8,
            sourceInSec: 0,
            label: 'Вступление',
          },
          {
            id: 'demo',
            binId: 'source',
            track: 'v1',
            startSec: 8,
            durationSec: 12,
            sourceInSec: 8,
            label: 'Демонстрация',
          },
        ],
        trackLayout: { videos: 1, audios: 1, titles: 1 },
        edited: true,
      },
    });
    expect(chapters.map((chapter) => [chapter.title, chapter.durationSec])).toEqual([
      ['Вступление', 8],
      ['Демонстрация', 12],
    ]);
  });
});
