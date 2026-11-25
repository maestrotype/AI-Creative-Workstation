import { fileName } from '../../video/model/directorTimeline';
import { editorHref, writeLastProjectId } from './handoff';
import { newScene, timelineFromScenes, type ProjectDoc, type ProjectExportSettings } from './project';

const VOICEOVER_INTENT = /озвуч|переозвуч|voice-?over|\bdub\b|своим голос|мой голос|голос из|замен\p{L}{0,8} голос/iu;

/** True when the sentence is about replacing speech on a finished video, not drawing a picture. */
export function isVoiceoverIntent(text: string): boolean {
  return VOICEOVER_INTENT.test(text.trim());
}

function cleanIpc(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  return new Error(raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').trim());
}

/**
 * Copy a finished video into a new project and open the editor.
 * `voice` opens the replace-voice panel and mutes the file's own speech on export.
 */
export async function startProjectFromVideo(
  filePath: string,
  options: { untitled: string; chapterTitle: string; voice: boolean; brief?: string },
): Promise<string> {
  if (!window.api?.createProject || !window.api.importIntoProject || !window.api.saveProject) {
    throw new Error('Import is unavailable');
  }
  const sourceName = fileName(filePath);
  const name = sourceName.replace(/\.[^.]+$/, '') || options.untitled;
  const doc = await window.api.createProject({
    name,
    format: 'landscape',
    preset: 'youtube',
    templateId: null,
  });
  try {
    const copied = await window.api.importIntoProject({ projectId: doc.id, path: filePath });
    const duration = await window.api.probeMediaDuration(copied.file_path).catch(() => 12);
    const scene = {
      ...newScene(options.chapterTitle),
      clipPath: copied.file_path,
      stillPath: copied.poster_path ?? null,
      durationSec: Math.max(0.5, Math.round(duration * 10) / 10),
      motion: 'import' as const,
    };
    const fallbackExport: ProjectExportSettings = {
      preset: 'youtube-1080p',
      width: 1920,
      height: 1080,
      fps: 30,
      audioPolicy: 'duck',
      burnInHints: true,
      burnInCaptions: true,
    };
    const previousExport = doc.exportSettings && typeof doc.exportSettings === 'object'
      ? doc.exportSettings as ProjectExportSettings
      : fallbackExport;
    const next = {
      ...doc,
      templateId: null,
      brief: options.brief?.trim() || '',
      scenes: [scene],
      exportSettings: {
        ...previousExport,
        audioPolicy: options.voice ? 'replace' as const : previousExport.audioPolicy,
      },
    } as ProjectDoc;
    await window.api.saveProject({
      ...next,
      timeline: timelineFromScenes(next),
    });
    writeLastProjectId(doc.id);
    return editorHref(doc.id, options.voice);
  } catch (err) {
    await window.api.deleteProject?.(doc.id).catch(() => undefined);
    throw cleanIpc(err);
  }
}

export async function pickAndStartVoiceover(
  options: { untitled: string; chapterTitle: string; brief?: string },
): Promise<string | null> {
  const picked = await window.api?.pickVideo?.();
  if (!picked) return null;
  return startProjectFromVideo(picked, { ...options, voice: true });
}
