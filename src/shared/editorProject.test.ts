import { describe, expect, it } from 'vitest';

import {
  appendMediaVersion,
  frameToSeconds,
  mediaLibraryFromLegacyBins,
  secondsToFrame,
} from './editorProject';

describe('editor project foundation', () => {
  it('migrates timeline bins without duplicating one source file', () => {
    const media = mediaLibraryFromLegacyBins([
      { id: 'a', kind: 'video', path: '/film/source.mp4', name: 'Source', durationSec: 10 },
      { id: 'b', kind: 'video', path: '/film/source.mp4', name: 'Duplicate', durationSec: 10 },
      { id: 'c', kind: 'audio', path: '/film/voice.wav', name: 'Voice', durationSec: 8 },
    ], 100);

    expect(media).toHaveLength(2);
    expect(media[0].versions[0].path).toBe('/film/source.mp4');
    expect(media[1].kind).toBe('audio');
  });

  it('keeps the original version when adding an AI alternative', () => {
    const asset = mediaLibraryFromLegacyBins([
      { id: 'shot', kind: 'video', path: '/film/original.mp4', name: 'Shot', durationSec: 4 },
    ], 100)[0];
    const next = appendMediaVersion(asset, {
      id: 'version-ai-1',
      path: '/film/alternative.mp4',
      durationSec: 4,
      createdAt: 200,
      derivedFromVersionId: asset.currentVersionId,
      generationJobId: 'job-1',
    }, true);

    expect(next.versions.map((item) => item.path)).toEqual([
      '/film/original.mp4',
      '/film/alternative.mp4',
    ]);
    expect(next.currentVersionId).toBe('version-ai-1');
  });

  it('converts timeline positions through integer frames', () => {
    const frame = secondsToFrame(1.001, 30);
    expect(frame).toBe(30);
    expect(frameToSeconds(frame, 30)).toBe(1);
  });
});
