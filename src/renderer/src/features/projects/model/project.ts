import type { Callout } from '../../video/model/callout';
import type { VoiceoverSession } from '../../video/model/voiceoverSession';
import { MARKETPLACE_BRIEF_RU, MARKETPLACE_V0_BLOCKS, marketplaceVoiceoverSession } from '../../video/model/marketplaceVoiceoverPack';
import { inferTemplateId } from '../../../../../shared/filmTemplate';
import type { EditorGenerationJob, EditorMediaAsset } from '../../../../../shared/editorProject';

export { inferTemplateId };

export type ProjectFormat = 'landscape' | 'shorts';
export type FilmPreset = 'marketplace' | 'hero' | 'youtube' | 'shorts';
export type ShotMotion = 'still_motion' | 'import' | 'i2v';
export type ShotPurpose =
  | 'HOOK'
  | 'PRODUCT_HERO'
  | 'DETAIL'
  | 'FEATURE'
  | 'ANGLE'
  | 'LIFESTYLE'
  | 'CTA'
  | 'TRANSITION';
export type ShotValidation = 'ok' | 'warning' | 'failed';

export interface FilmShot {
  id: string;
  /** Same as ProjectDoc.id. Film and Project are one record. */
  projectId?: string | null;
  sourceAsset: string | null;
  provider: string;
  modelId: string;
  generationPrompt: string;
  duration: number;
  fps: number;
  width: number;
  height: number;
  artifactPath: string;
  generationMetadata: Record<string, unknown>;
  validationStatus: ShotValidation;
  productIdentityWarning: boolean;
  shotPurpose: ShotPurpose;
  createdAt: number;
  /** Previous take kept in shots[] when this row replaced a timeline clip. */
  replacesShotId?: string | null;
}

export interface FilmTimelineClip {
  id: string;
  binId: string | null;
  track: string;
  startSec: number;
  durationSec: number;
  sourceInSec: number;
  label: string;
  text?: string;
  autoLength?: boolean;
  previousBinId?: string;
  previousDurationSec?: number;
  /** Passed to ffmpeg for still zoom / grade. Empty = match the desk preview. */
  effect?: string;
}

export interface FilmTimelineBin {
  id: string;
  kind: 'video' | 'image' | 'audio';
  path: string;
  name: string;
  durationSec: number;
  inSec: number;
  outSec: number;
  durationKnown?: boolean;
  shotId?: string;
}

export interface FilmTimeline {
  bins: FilmTimelineBin[];
  clips: FilmTimelineClip[];
  trackLayout: { videos: number; audios: number; titles: number };
  overlayPos?: Record<string, { x: number; y: number }>;
  playhead?: number;
  pxPerSec?: number;
  stillCompose?: string;
  assembly?: {
    targetSec: number;
    style: string;
    rationale: string;
    createdAt: number;
  };
  /** User trim, split, or delete. Do not rebuild this cut from chapter files. */
  edited?: boolean;
}

export const PROJECT_SCHEMA_VERSION = 3;

export type ProjectAudioPolicy = 'original' | 'duck' | 'replace';
export type ProjectExportPreset = 'draft' | 'youtube-1080p' | 'shorts-1080p';

export interface ProjectExportSettings {
  preset: ProjectExportPreset;
  width: number;
  height: number;
  fps: number;
  audioPolicy: ProjectAudioPolicy;
  burnInHints: boolean;
  burnInCaptions: boolean;
}

export interface ProjectAnalysisRef {
  sourcePath: string;
  cachePath?: string | null;
  fingerprint?: string | null;
  updatedAt: number;
}

export interface ProjectScene {
  id: string;
  title: string;
  /** Spoken line. This is what the app voices for the chapter. */
  prompt: string;
  /** What to do on screen while recording. Not spoken. */
  recordSteps: string;
  effectPrompt: string;
  textOverlay: string;
  durationSec: number;
  stillPath: string | null;
  clipPath: string | null;
  motion: ShotMotion;
}

/**
 * In this app a Film is a ProjectDoc. One identity: projectId.
 * Route `/video?project=:projectId` is the editor (timeline, preview, AI).
 * Route `/projects/:projectId` is optional script/storyboard planning.
 * Shots, timeline, narration-derived preview, and export live on project.json.
 * localStorage may cache director UI; it is not the source of truth.
 */
export interface ProjectDoc {
  schemaVersion: number;
  id: string;
  name: string;
  kind: string;
  format: ProjectFormat;
  preset: FilmPreset;
  /** Built-in ecommerce id, a saved template id, or null for a custom film. */
  templateId: string | null;
  brief: string;
  scenes: ProjectScene[];
  shots: FilmShot[];
  /** Canonical media and its non-destructive versions. */
  media?: EditorMediaAsset[];
  /** Persistent AI operations associated with this project. */
  generationJobs?: EditorGenerationJob[];
  timeline: FilmTimeline | null;
  /** Durable editor data. localStorage is only a disposable UI cache. */
  voiceover: VoiceoverSession | null;
  callouts: Callout[];
  analysisRef: ProjectAnalysisRef | null;
  exportSettings: ProjectExportSettings;
  productStillPath: string | null;
  /** Last rendered V1 preview used for narration/analysis. */
  assembledPath: string | null;
  /** Fingerprint of V1 clips that assembledPath was rendered from. */
  assembledFingerprint?: string | null;
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
    recordSteps: '',
    effectPrompt: '',
    textOverlay: '',
    durationSec: 12,
    stillPath: null,
    clipPath: null,
    motion: 'import',
  };
}

export function newShotId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `shot-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function shotFromGeneration(args: {
  path: string;
  prompt: string;
  purpose?: ShotPurpose;
  provider?: string;
  modelId?: string;
  sourceAsset?: string | null;
  projectId?: string | null;
  quality?: {
    duration_sec?: number;
    fps?: number;
    frame_count?: number;
    width?: number;
    height?: number;
    low_motion?: boolean;
    identity_warning?: boolean;
    motion_mae?: number;
    identity_mae?: number | null;
    motion_score?: number | null;
  } | null;
  status?: string;
}): FilmShot {
  const quality = args.quality ?? {};
  const failed = args.status === 'failed' || quality.low_motion === true;
  const warning = Boolean(quality.identity_warning);
  return {
    id: newShotId(),
    sourceAsset: args.sourceAsset ?? null,
    projectId: args.projectId ?? null,
    provider: args.provider || args.modelId || 'unknown',
    modelId: args.modelId || args.provider || '',
    generationPrompt: args.prompt,
    duration: Number(quality.duration_sec) || 0,
    fps: Number(quality.fps) || 24,
    width: Number(quality.width) || 0,
    height: Number(quality.height) || 0,
    artifactPath: args.path,
    generationMetadata: { ...quality },
    validationStatus: failed ? 'failed' : warning ? 'warning' : 'ok',
    productIdentityWarning: warning,
    shotPurpose: args.purpose ?? 'PRODUCT_HERO',
    createdAt: Date.now(),
  };
}

/** Chapters for the built-in ecommerce demo. Blank films stay empty. */
export function templateChapters(): ProjectScene[] {
  return MARKETPLACE_V0_BLOCKS.map((block) => ({
    ...newScene(block.titleRu),
    prompt: block.voiceoverRu,
    recordSteps: block.shootRu,
    textOverlay: block.title,
    effectPrompt: block.viewRu,
    durationSec: Math.max(8, block.endSec - block.startSec),
    motion: 'import' as const,
  }));
}

export function marketplaceFilmSeed(): {
  name: string;
  brief: string;
  preset: FilmPreset;
  scenes: ProjectScene[];
  voiceover: VoiceoverSession;
} {
  return {
    name: 'Angular 3D Ecommerce',
    brief: MARKETPLACE_BRIEF_RU,
    preset: 'marketplace',
    scenes: templateChapters(),
    voiceover: marketplaceVoiceoverSession(),
  };
}

export function defaultExportSettings(
  format: ProjectFormat,
  preset?: FilmPreset,
): ProjectExportSettings {
  const vertical = format === 'shorts' || preset === 'shorts';
  return {
    preset: vertical ? 'shorts-1080p' : 'youtube-1080p',
    width: vertical ? 1080 : 1920,
    height: vertical ? 1920 : 1080,
    fps: 30,
    audioPolicy: 'duck',
    burnInHints: true,
    burnInCaptions: true,
  };
}

export function normalizeShotMotion(value: unknown): ShotMotion {
  if (value === 'import' || value === 'i2v' || value === 'still_motion') return value;
  return 'still_motion';
}

export function normalizePreset(value: unknown): FilmPreset {
  if (value === 'hero' || value === 'youtube' || value === 'shorts' || value === 'marketplace') return value;
  return 'youtube';
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
    const useStill = scene.motion === 'still_motion' && still;
    const path = useStill ? still : video || still;
    if (path) {
      clips.push({
        kind: useStill || (!video && still) ? 'image' : 'video',
        track: 'v1',
        path,
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

export function sceneWantsSlowZoom(effectPrompt: string | null | undefined): boolean {
  return /приближ|наезд|zoom|зум|ken\s*burns|slow\s*push|лёгк\w*\s*зум|легк\w*\s*зум/i.test(
    effectPrompt || '',
  );
}

export function sceneMediaRows(doc: Pick<ProjectDoc, 'scenes'>): Array<{
  sceneId: string;
  path: string;
  kind: 'video' | 'image';
  name: string;
  durationSec: number;
  effect: string;
}> {
  const rows: Array<{
    sceneId: string;
    path: string;
    kind: 'video' | 'image';
    name: string;
    durationSec: number;
    effect: string;
  }> = [];
  for (const scene of doc.scenes) {
    const useStill = scene.motion === 'still_motion' && scene.stillPath;
    const path = useStill ? scene.stillPath : scene.clipPath || scene.stillPath;
    if (!path) continue;
    rows.push({
      sceneId: scene.id,
      path,
      kind: useStill || (!scene.clipPath && scene.stillPath) ? 'image' : 'video',
      name: scene.title.trim() || 'Глава',
      durationSec: Math.max(0.5, Number(scene.durationSec) || 5),
      effect: (scene.effectPrompt || '').trim(),
    });
  }
  return rows;
}

export function timelinePicturePaths(timeline: FilmTimeline | null | undefined): string[] {
  if (!timeline?.clips?.length) return [];
  return timeline.clips
    .filter((clip) => clip.track === 'v1')
    .sort((a, b) => a.startSec - b.startSec)
    .map((clip) => timeline.bins.find((bin) => bin.id === clip.binId)?.path || '')
    .filter(Boolean);
}

/** True when the saved cut already uses the current chapter files, in order. */
export function timelinePictureMatchesScenePaths(doc: Pick<ProjectDoc, 'scenes' | 'timeline'>): boolean {
  const scenePaths = sceneMediaRows(doc).map((row) => row.path);
  const picturePaths = timelinePicturePaths(doc.timeline);
  return scenePaths.length > 0
    && scenePaths.length === picturePaths.length
    && scenePaths.every((path, index) => path === picturePaths[index]);
}

function timelineSharesSceneMedia(doc: Pick<ProjectDoc, 'scenes' | 'timeline'>): boolean {
  const scenePaths = new Set(sceneMediaRows(doc).map((row) => row.path));
  return (doc.timeline?.bins ?? []).some((bin) => scenePaths.has(bin.path));
}

/** True when the saved picture is a user cut of the current chapters, not a straight layout. */
export function timelineCutIsEdited(doc: Pick<ProjectDoc, 'scenes' | 'timeline'>): boolean {
  if (doc.timeline?.edited) return true;
  if (!timelineSharesSceneMedia(doc)) return false;
  if (!timelinePictureMatchesScenePaths(doc)) return true;
  const rows = sceneMediaRows(doc);
  const clips = (doc.timeline?.clips ?? [])
    .filter((clip) => clip.track === 'v1')
    .sort((a, b) => a.startSec - b.startSec);
  return clips.some((clip, index) => {
    const row = rows[index];
    if (!row) return true;
    return Math.abs(clip.durationSec - row.durationSec) > 0.15
      || Math.abs(clip.sourceInSec) > 0.05;
  });
}

/**
 * Replace the timeline with chapter files only when there is no cut yet,
 * or the cut belongs to an older set of files. A trim, split, or deleted
 * piece stays, even if the clip count no longer matches the chapters.
 */
export function timelineNeedsSceneRebuild(doc: Pick<ProjectDoc, 'scenes' | 'timeline'>): boolean {
  if (!doc.scenes.some(sceneHasMedia)) return false;
  const clips = doc.timeline?.clips ?? [];
  if (!clips.some((clip) => clip.track === 'v1')) return true;
  if (timelineCutIsEdited(doc)) return false;
  return !timelinePictureMatchesScenePaths(doc);
}

/** Picture track from the current chapters. Replaces a leftover cut from an earlier visit. */
export function timelineFromScenes(
  doc: Pick<ProjectDoc, 'scenes'>,
  previous?: FilmTimeline | null,
): FilmTimeline {
  const rows = sceneMediaRows(doc);
  const bins: FilmTimelineBin[] = [];
  const clips: FilmTimelineClip[] = [];
  let cursor = 0;
  for (const row of rows) {
    const binId = `scene-bin-${row.sceneId}`;
    bins.push({
      id: binId,
      kind: row.kind,
      path: row.path,
      name: row.name,
      durationSec: row.durationSec,
      inSec: 0,
      outSec: row.durationSec,
      durationKnown: true,
    });
    clips.push({
      id: `scene-clip-${row.sceneId}`,
      binId,
      track: 'v1',
      startSec: cursor,
      durationSec: row.durationSec,
      sourceInSec: 0,
      label: row.name,
      autoLength: true,
      effect: row.effect || undefined,
    });
    cursor += row.durationSec;
  }
  return {
    bins,
    clips,
    trackLayout: previous?.trackLayout ?? { videos: 1, audios: 1, titles: 1 },
    overlayPos: previous?.overlayPos,
    playhead: 0,
    pxPerSec: previous?.pxPerSec ?? 16,
    stillCompose: previous?.stillCompose,
    assembly: {
      targetSec: cursor,
      style: 'chapters',
      rationale: `${rows.length} глав · ${cursor.toFixed(1)}s`,
      createdAt: Date.now(),
    },
  };
}
