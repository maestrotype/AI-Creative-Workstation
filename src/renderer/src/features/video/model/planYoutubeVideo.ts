export type YoutubeFormat = 'landscape' | 'shorts';

export interface YoutubeScene {
  readonly id: string;
  readonly title: string;
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

const HOOKS = [
  'Cold open: the most surprising visual from the topic, cinematic lighting, no text overlay',
  'Hook: a viewer-stopping close-up tied to the topic, dramatic contrast',
];

const BODY = [
  'Explain the core idea with a clear cinematic establishing shot',
  'Show the problem or tension as a grounded, photoreal scene',
  'Reveal the key insight as a striking visual metaphor',
  'Demonstrate the idea in action with rich environmental detail',
  'Contrast before vs after with split-composition storytelling',
  'Zoom out to the bigger picture, epic scale, film still',
];

const CTA = 'End card mood: hopeful, memorable, YouTube outro energy, no readable text';

export function planYoutubeVideo(topic: string, format: YoutubeFormat, durationSec: number): YoutubePlan {
  const trimmed = topic.trim();
  const shorts = format === 'shorts';
  const width = shorts ? 1080 : 1920;
  const height = shorts ? 1920 : 1080;
  const imageFormat = shorts ? 'portrait' : 'wide';
  const sceneCount = shorts
    ? Math.min(8, Math.max(4, Math.round(durationSec / 6)))
    : Math.min(12, Math.max(6, Math.round(durationSec / 40)));
  const each = Math.max(2, Math.round((durationSec / sceneCount) * 10) / 10);

  const beats = [HOOKS[0], ...BODY.slice(0, Math.max(1, sceneCount - 2)), CTA];
  while (beats.length < sceneCount) {
    beats.splice(beats.length - 1, 0, BODY[beats.length % BODY.length]);
  }

  const scenes: YoutubeScene[] = beats.slice(0, sceneCount).map((beat, index) => ({
    id: `scene-${index + 1}`,
    title: index === 0 ? 'Hook' : index === sceneCount - 1 ? 'Outro' : `Beat ${index}`,
    prompt: `${beat}. Subject: ${trimmed}. Cinematic, high production value, YouTube thumbnail-grade still.`,
    durationSec: each,
    imagePath: null,
  }));

  return {
    topic: trimmed,
    format,
    durationSec,
    width,
    height,
    imageFormat,
    scenes,
  };
}
