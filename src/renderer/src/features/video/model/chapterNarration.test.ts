import { describe, expect, it } from 'vitest';

import { buildChapterPlan, v1ChapterSpans } from './chapterNarration';
import { MARKETPLACE_V0_BLOCKS } from './marketplaceVoiceoverPack';
import type { BinItem, TimelineClip } from './directorTimeline';
import type { VoiceoverScript } from './voiceoverScript';

function video(id: string, start: number, dur: number, label = 'Uploaded'): { bin: BinItem; clip: TimelineClip } {
  return {
    bin: {
      id: `bin-${id}`,
      kind: 'video',
      path: `/tmp/${id}.mp4`,
      name: label,
      durationSec: dur,
      inSec: 0,
      outSec: dur,
      durationKnown: true,
    },
    clip: {
      id,
      binId: `bin-${id}`,
      track: 'v1',
      startSec: start,
      durationSec: dur,
      sourceInSec: 0,
      label,
    },
  };
}

describe('chapter narration plan', () => {
  it('uses the real clip windows, not the 35-second template', () => {
    const rows = [video('a', 0, 63.7), video('b', 63.7, 69.2)];
    const spans = v1ChapterSpans(rows.map((row) => row.clip), rows.map((row) => row.bin));
    expect(spans.map((span) => [span.startSec, span.endSec])).toEqual([
      [0, 63.7],
      [63.7, 132.9],
    ]);
  });

  it('pairs a marketplace script onto the uploaded chapters in order', () => {
    let cursor = 0;
    const rows = MARKETPLACE_V0_BLOCKS.map((_, index) => {
      const dur = 40 + index;
      const row = video(`c${index}`, cursor, dur);
      cursor += dur;
      return row;
    });
    const script: VoiceoverScript = {
      segments: MARKETPLACE_V0_BLOCKS.map((block) => ({
        start_sec: block.startSec,
        end_sec: block.endSec,
        text: block.voiceoverRu,
        role: 'body',
        purpose: block.titleRu,
        visual_summary: block.shootRu,
      })),
      meta: {
        tone: 'commercial',
        language: 'ru',
        words_per_min: 130,
        provider: 'preset',
        model: 'preset:marketplace_v0',
      },
    };
    const plan = buildChapterPlan(
      rows.map((row) => row.clip),
      rows.map((row) => row.bin),
      { script, brief: 'Angular 3D Ecommerce' },
    );
    expect(plan).toHaveLength(8);
    expect(plan[0].title).toBe('Что это');
    expect(plan[0].draft).toContain('Angular 3D Ecommerce');
    expect(plan[0].startSec).toBe(0);
    expect(plan[0].endSec).toBe(40);
    expect(plan[2].startSec).not.toBe(MARKETPLACE_V0_BLOCKS[2].startSec);
  });

  it('does not invent marketplace copy for an unrelated film', () => {
    const rows = [video('a', 0, 20, 'Interview'), video('b', 20, 30, 'B-roll')];
    const plan = buildChapterPlan(
      rows.map((row) => row.clip),
      rows.map((row) => row.bin),
      { brief: 'Travel vlog', prompt: 'спокойный рассказ' },
    );
    expect(plan[0].title).toBe('Interview');
    expect(plan[0].draft).toBe('');
  });
});
