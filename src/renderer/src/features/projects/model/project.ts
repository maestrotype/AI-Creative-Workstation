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
}

export interface ProjectScene {
  id: string;
  title: string;
  prompt: string;
  effectPrompt: string;
  textOverlay: string;
  durationSec: number;
  stillPath: string | null;
  clipPath: string | null;
  motion: ShotMotion;
}

/**
 * In this app a Film is a ProjectDoc. One identity: projectId.
 * Route `/projects/:projectId` is the Film workspace.
 * Route `/video?project=:projectId` is that same Film’s Director/narration.
 * Shots, timeline, narration-derived preview, and export live on project.json.
 * localStorage may cache director UI; it is not the source of truth.
 */
export interface ProjectDoc {
  id: string;
  name: string;
  kind: string;
  format: ProjectFormat;
  preset: FilmPreset;
  brief: string;
  scenes: ProjectScene[];
  shots: FilmShot[];
  timeline: FilmTimeline | null;
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

/** Chapters for a store-template demo. You record the UI; the app cuts, titles, and voices. */
export const TEMPLATE_CHAPTER_IDS = [
  'intro',
  'design',
  'catalog',
  'product',
  'checkout',
  'admin',
  'builder',
  'payments',
] as const;

export function templateChapters(label: (key: string) => string): ProjectScene[] {
  return TEMPLATE_CHAPTER_IDS.map((id) => ({
    ...newScene(label(`projects.chapter_${id}`)),
    prompt: label(`projects.chapter_${id}_do`),
    textOverlay: label(`projects.chapter_${id}`),
    effectPrompt: label('projects.effect_default'),
    durationSec: 12,
    motion: 'import' as const,
  }));
}

export function formatForPreset(preset: FilmPreset): ProjectFormat {
  return preset === 'shorts' ? 'shorts' : 'landscape';
}

export function normalizeShotMotion(value: unknown): ShotMotion {
  if (value === 'import' || value === 'i2v' || value === 'still_motion') return value;
  return 'still_motion';
}

export function normalizePreset(value: unknown): FilmPreset {
  if (value === 'hero' || value === 'youtube' || value === 'shorts' || value === 'marketplace') return value;
  return 'marketplace';
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
