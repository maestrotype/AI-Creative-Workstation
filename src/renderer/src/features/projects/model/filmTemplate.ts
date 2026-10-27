import { newScene, type ProjectDoc, type ProjectScene } from './project';
import {
  ECOMMERCE_TEMPLATE_ID,
  type FilmTemplateChapter,
} from '../../../../../shared/filmTemplate';

export { ECOMMERCE_TEMPLATE_ID };

export function chaptersFromScenes(scenes: ProjectScene[]): FilmTemplateChapter[] {
  return scenes.map((scene) => ({
    title: scene.title,
    prompt: scene.prompt,
    recordSteps: scene.recordSteps,
    effectPrompt: scene.effectPrompt,
    textOverlay: scene.textOverlay,
    durationSec: scene.durationSec,
    motion: scene.motion === 'still_motion' || scene.motion === 'i2v' ? scene.motion : 'import',
  }));
}

export function chaptersFromProject(
  doc: Pick<ProjectDoc, 'scenes' | 'timeline' | 'voiceover'>,
): FilmTemplateChapter[] {
  const picture = doc.timeline?.edited
    ? doc.timeline.clips
      .filter((clip) => clip.track === 'v1' && clip.binId)
      .sort((a, b) => a.startSec - b.startSec)
    : [];
  if (!picture.length) return chaptersFromScenes(doc.scenes);

  const analysis = doc.voiceover?.analysis?.scene_analysis ?? [];
  return picture.map((clip, index) => ({
    title: clip.label.trim() || `Глава ${index + 1}`,
    prompt: '',
    recordSteps: analysis[index]?.visual_summary || '',
    effectPrompt: clip.effect || '',
    textOverlay: '',
    durationSec: Math.max(0.5, clip.durationSec),
    motion: 'import',
  }));
}

/** Fresh chapter ids and no recordings. Each film shoots its own footage. */
export function scenesFromTemplate(chapters: FilmTemplateChapter[]): ProjectScene[] {
  return chapters.map((chapter) => ({
    ...newScene(chapter.title),
    prompt: chapter.prompt,
    recordSteps: chapter.recordSteps,
    effectPrompt: chapter.effectPrompt,
    textOverlay: chapter.textOverlay,
    durationSec: chapter.durationSec,
    motion: chapter.motion,
    stillPath: null,
    clipPath: null,
  }));
}
