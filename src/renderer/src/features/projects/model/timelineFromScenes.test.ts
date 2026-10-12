import { describe, expect, it } from 'vitest';

import {
  newScene,
  timelineFromScenes,
  timelinePictureMatchesScenePaths,
  type FilmTimeline,
  type ProjectScene,
} from './project';

function scene(title: string, path: string, durationSec: number): ProjectScene {
  return {
    ...newScene(title),
    clipPath: path,
    durationSec,
    motion: 'import',
  };
}

function leftoverCut(): FilmTimeline {
  return {
    bins: [{
      id: 'old-bin',
      kind: 'video',
      path: '/tmp/old-hero.mp4',
      name: 'Hero',
      durationSec: 12,
      inSec: 0,
      outSec: 12,
      durationKnown: true,
    }],
    clips: [{
      id: 'old-clip',
      binId: 'old-bin',
      track: 'v1',
      startSec: 0,
      durationSec: 12,
      sourceInSec: 0,
      label: 'Hero',
    }],
    trackLayout: { videos: 1, audios: 1, titles: 1 },
  };
}

describe('timeline from current chapters', () => {
  it('rebuilds a leftover 1:35-style cut into the current chapter files', () => {
    const scenes = [
      scene('Главная и Product Stage', '/tmp/stage.mp4', 42.8),
      scene('Темы и языки', '/tmp/themes.mp4', 26),
      scene('Что в архиве', '/tmp/zip.mp4', 16),
    ];
    const timeline = timelineFromScenes({ scenes }, leftoverCut());
    expect(timeline.clips.map((clip) => clip.durationSec)).toEqual([42.8, 26, 16]);
    expect(timeline.assembly?.targetSec).toBeCloseTo(84.8);
    expect(timelinePictureMatchesScenePaths({ scenes, timeline })).toBe(true);
    expect(timelinePictureMatchesScenePaths({ scenes, timeline: leftoverCut() })).toBe(false);
  });

  it('keeps a matching cut so director trims are not treated as stale', () => {
    const scenes = [scene('Главная', '/tmp/stage.mp4', 42.8)];
    const timeline = timelineFromScenes({ scenes });
    timeline.clips[0].durationSec = 18;
    expect(timelinePictureMatchesScenePaths({ scenes, timeline })).toBe(true);
  });
});
