export type ProjectFormat = 'landscape' | 'shorts';

export interface ProjectScene {
  id: string;
  title: string;
  prompt: string;
  effectPrompt: string;
  textOverlay: string;
  durationSec: number;
  stillPath: string | null;
  clipPath: string | null;
}

export interface ProjectDoc {
  id: string;
  name: string;
  kind: string;
  format: ProjectFormat;
  brief: string;
  scenes: ProjectScene[];
  assembledPath: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  format: ProjectFormat;
  sceneCount: number;
  updatedAt: number;
  coverPath: string | null;
  assembledPath: string | null;
}

export function newScene(title = ''): ProjectScene {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `scene-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id,
    title,
    prompt: '',
    effectPrompt: '',
    textOverlay: '',
    durationSec: 5,
    stillPath: null,
    clipPath: null,
  };
}

export function sceneHasMedia(scene: ProjectScene): boolean {
  return Boolean(scene.clipPath || scene.stillPath);
}

export function projectDuration(doc: ProjectDoc): number {
  return doc.scenes.reduce((sum, scene) => sum + Math.max(0.5, scene.durationSec || 0), 0);
}

export function composeClips(doc: ProjectDoc): Array<{
  kind: string;
  track: string;
  path: string | null;
  text: string | null;
  start_sec: number;
  duration_sec: number;
  source_in_sec: number;
  effect?: string | null;
}> {
  const clips: ReturnType<typeof composeClips> = [];
  let t = 0;
  for (const scene of doc.scenes) {
    const dur = Math.max(0.5, Number(scene.durationSec) || 5);
    const video = scene.clipPath;
    const still = scene.stillPath;
    if (video || still) {
      clips.push({
        kind: video ? 'video' : 'image',
        track: 'v1',
        path: video || still,
        text: null,
        start_sec: t,
        duration_sec: dur,
        source_in_sec: 0,
        effect: scene.effectPrompt.trim() || null,
      });
    }
    if (scene.textOverlay.trim()) {
      clips.push({
        kind: 'text',
        track: 't1',
        path: null,
        text: scene.textOverlay.trim(),
        start_sec: t,
        duration_sec: dur,
        source_in_sec: 0,
      });
    }
    t += dur;
  }
  return clips;
}
