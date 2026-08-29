export type YoutubeFormat = 'landscape' | 'shorts';
export type SceneRole = 'hook' | 'beat' | 'outro';

export interface YoutubeScene {
  readonly id: string;
  readonly role: SceneRole;
  readonly beatIndex: number;
  readonly hintKey: string;
  readonly prompt: string;
  readonly durationSec: number;
  imagePath?: string | null;
}

export interface YoutubePlan {
  readonly topic: string;
  readonly format: YoutubeFormat;
  readonly durationSec: number;
  readonly width: number;
  readonly height: number;
  readonly imageFormat: 'wide' | 'portrait';
  readonly scenes: YoutubeScene[];
}

const BODY_HINTS = [
  'establish',
  'problem',
  'insight',
  'action',
  'contrast',
  'scale',
] as const;

const BODY_PROMPTS: Record<(typeof BODY_HINTS)[number], string> = {
  establish: 'Explain the core idea with a clear cinematic establishing shot',
  problem: 'Show the problem or tension as a grounded, photoreal scene',
  insight: 'Reveal the key insight as a striking visual metaphor',
  action: 'Demonstrate the idea in action with rich environmental detail',
  contrast: 'Contrast before vs after with split-composition storytelling',
  scale: 'Zoom out to the bigger picture, epic scale, film still',
};

const HOOK_PROMPT = 'Cold open: the most surprising visual from the topic, cinematic lighting, no text overlay';
const OUTRO_PROMPT = 'End card mood: hopeful, memorable, YouTube outro energy, no readable text';

export function estimateStoryboard(format: YoutubeFormat, durationSec: number): { count: number; eachSec: number } {
  const shorts = format === 'shorts';
  const count = shorts
    ? Math.min(8, Math.max(4, Math.round(durationSec / 6)))
    : Math.min(12, Math.max(6, Math.round(durationSec / 40)));
  const eachSec = Math.max(2, Math.round((durationSec / count) * 10) / 10);
  return { count, eachSec };
}

export function planYoutubeVideo(topic: string, format: YoutubeFormat, durationSec: number): YoutubePlan {
  const trimmed = topic.trim();
  const shorts = format === 'shorts';
  const width = shorts ? 1080 : 1920;
  const height = shorts ? 1920 : 1080;
  const imageFormat = shorts ? 'portrait' : 'wide';
  const { count: sceneCount, eachSec } = estimateStoryboard(format, durationSec);

  const bodyKeys: Array<(typeof BODY_HINTS)[number]> = [];
  const bodyNeeded = Math.max(1, sceneCount - 2);
  while (bodyKeys.length < bodyNeeded) {
    bodyKeys.push(BODY_HINTS[bodyKeys.length % BODY_HINTS.length]);
  }

  const scenes: YoutubeScene[] = [];
  scenes.push({
    id: 'scene-1',
    role: 'hook',
    beatIndex: 0,
    hintKey: 'hook',
    prompt: `${HOOK_PROMPT}. Subject: ${trimmed}. Cinematic, high production value, YouTube thumbnail-grade still.`,
    durationSec: eachSec,
    imagePath: null,
  });
  bodyKeys.forEach((hintKey, i) => {
    scenes.push({
      id: `scene-${i + 2}`,
      role: 'beat',
      beatIndex: i + 1,
      hintKey,
      prompt: `${BODY_PROMPTS[hintKey]}. Subject: ${trimmed}. Cinematic, high production value, YouTube thumbnail-grade still.`,
      durationSec: eachSec,
      imagePath: null,
    });
  });
  scenes.push({
    id: `scene-${sceneCount}`,
    role: 'outro',
    beatIndex: sceneCount - 1,
    hintKey: 'outro',
    prompt: `${OUTRO_PROMPT}. Subject: ${trimmed}. Cinematic, high production value, YouTube thumbnail-grade still.`,
    durationSec: eachSec,
    imagePath: null,
  });

  return {
    topic: trimmed,
    format,
    durationSec,
    width,
    height,
    imageFormat,
    scenes: scenes.slice(0, sceneCount),
  };
}

function padTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Draft timeline prompt: one XTTS line per scene at scene start. */
export function voiceoverPromptFromPlan(plan: YoutubePlan): string {
  let t = 0;
  const lines: string[] = [];
  for (const scene of plan.scenes) {
    const spoken = scene.role === 'beat' ? `${plan.topic}` : plan.topic;
    lines.push(`at ${padTime(t)} voiceover: ${spoken}`);
    t += scene.durationSec;
  }
  return lines.join('\n');
}
