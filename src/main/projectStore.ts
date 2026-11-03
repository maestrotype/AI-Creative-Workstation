import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';

import { inferTemplateId } from '../shared/filmTemplate';
import {
  legacyBinsOf,
  mergeMediaFromBins,
  type EditorGenerationJob,
  type EditorMediaAsset,
} from '../shared/editorProject';

export type ProjectKind = 'video';
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
  replacesShotId?: string | null;
}

export interface FilmTimeline {
  bins: unknown[];
  clips: unknown[];
  trackLayout?: { videos: number; audios: number; titles: number };
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

export const PROJECT_SCHEMA_VERSION = 3;

export interface ProjectExportSettings {
  preset: 'draft' | 'youtube-1080p' | 'shorts-1080p';
  width: number;
  height: number;
  fps: number;
  audioPolicy: 'original' | 'duck' | 'replace';
  burnInHints: boolean;
  burnInCaptions: boolean;
}

export interface ProjectScene {
  id: string;
  title: string;
  prompt: string;
  recordSteps: string;
  effectPrompt: string;
  textOverlay: string;
  durationSec: number;
  stillPath: string | null;
  clipPath: string | null;
  motion: ShotMotion;
}

export interface ProjectDoc {
  schemaVersion: number;
  id: string;
  name: string;
  kind: ProjectKind;
  format: ProjectFormat;
  preset: FilmPreset;
  templateId: string | null;
  brief: string;
  scenes: ProjectScene[];
  shots: FilmShot[];
  /** Canonical project media. Legacy timeline bins migrate here on load. */
  media?: EditorMediaAsset[];
  /** Persistent AI operation records; execution queue wiring follows. */
  generationJobs?: EditorGenerationJob[];
  timeline: FilmTimeline | null;
  voiceover: Record<string, unknown> | null;
  callouts: unknown[];
  analysisRef: {
    sourcePath: string;
    cachePath?: string | null;
    fingerprint?: string | null;
    updatedAt: number;
  } | null;
  exportSettings: ProjectExportSettings;
  productStillPath: string | null;
  assembledPath: string | null;
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

function projectsRoot(): string {
  const dir = join(homedir(), 'Documents/Canvas/Projects');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function projectDir(id: string): string {
  return join(projectsRoot(), id);
}

function projectFile(id: string): string {
  return join(projectDir(id), 'project.json');
}

function normalizeMotion(value: unknown): ShotMotion {
  if (value === 'import' || value === 'i2v' || value === 'still_motion') return value;
  return 'still_motion';
}

function normalizePreset(value: unknown): FilmPreset {
  if (value === 'hero' || value === 'youtube' || value === 'shorts' || value === 'marketplace') return value;
  return 'youtube';
}

function defaultExportSettings(format: ProjectFormat, preset: FilmPreset): ProjectExportSettings {
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

function emptyProject(
  name: string,
  format: ProjectFormat = 'landscape',
  preset: FilmPreset = 'youtube',
  templateId: string | null = null,
): ProjectDoc {
  const now = Date.now();
  const nextFormat = format === 'shorts' || preset === 'shorts' ? 'shorts' : 'landscape';
  const nextPreset = nextFormat === 'shorts' ? 'shorts' : preset;
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: randomUUID(),
    name: name.trim() || 'Untitled',
    kind: 'video',
    format: nextFormat,
    preset: nextPreset,
    templateId,
    brief: '',
    scenes: [],
    shots: [],
    media: [],
    generationJobs: [],
    timeline: null,
    voiceover: null,
    callouts: [],
    analysisRef: null,
    exportSettings: defaultExportSettings(nextFormat, nextPreset),
    productStillPath: null,
    assembledPath: null,
    assembledFingerprint: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function emptyScene(title = ''): ProjectScene {
  return {
    id: randomUUID(),
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

function parseDoc(raw: string): ProjectDoc | null {
  try {
    const parsed = JSON.parse(raw) as ProjectDoc;
    if (!parsed?.id || !parsed.name) return null;
    const preset = normalizePreset(parsed.preset);
    const format = parsed.format === 'shorts' || preset === 'shorts' ? 'shorts' : 'landscape';
    const scenes = (Array.isArray(parsed.scenes) ? parsed.scenes : []).map((scene) => ({
      ...emptyScene(scene.title),
      ...scene,
          motion: normalizeMotion(scene.motion) || (scene.clipPath ? 'import' : scene.stillPath ? 'still_motion' : 'import'),
    }));
    const shots = Array.isArray(parsed.shots) ? parsed.shots.filter((row) => row && row.id && row.artifactPath) : [];
    const base = emptyProject(parsed.name, format, preset);
    const callouts = Array.isArray(parsed.callouts)
      ? parsed.callouts
      : Array.isArray(parsed.voiceover?.callouts)
        ? parsed.voiceover.callouts
        : [];
    const voiceover = parsed.voiceover && typeof parsed.voiceover === 'object'
      ? { ...parsed.voiceover, callouts }
      : null;
    const legacyBins = legacyBinsOf(parsed.timeline?.bins);
    const media = mergeMediaFromBins(
      Array.isArray(parsed.media) ? parsed.media : [],
      legacyBins,
      parsed.createdAt || Date.now(),
    );
    return {
      ...base,
      ...parsed,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: parsed.id,
      format,
      preset,
      templateId: inferTemplateId(parsed.preset, parsed.templateId),
      scenes,
      shots,
      media,
      generationJobs: Array.isArray(parsed.generationJobs) ? parsed.generationJobs : [],
      timeline: parsed.timeline && typeof parsed.timeline === 'object' ? parsed.timeline : null,
      voiceover,
      callouts,
      analysisRef: parsed.analysisRef && typeof parsed.analysisRef === 'object' ? parsed.analysisRef : null,
      exportSettings: {
        ...base.exportSettings,
        ...(parsed.exportSettings && typeof parsed.exportSettings === 'object' ? parsed.exportSettings : {}),
      },
      productStillPath: parsed.productStillPath || null,
      assembledFingerprint: parsed.assembledFingerprint || null,
    };
  } catch {
    return null;
  }
}

function coverOf(doc: ProjectDoc): string | null {
  if (doc.productStillPath && existsSync(doc.productStillPath)) return doc.productStillPath;
  for (const shot of doc.shots) {
    if (shot.artifactPath && existsSync(shot.artifactPath)) return shot.artifactPath;
  }
  for (const scene of doc.scenes) {
    if (scene.stillPath && existsSync(scene.stillPath)) return scene.stillPath;
    if (scene.clipPath && existsSync(scene.clipPath)) return scene.clipPath;
  }
  return doc.assembledPath && existsSync(doc.assembledPath) ? doc.assembledPath : null;
}

export function listProjects(): ProjectSummary[] {
  const root = projectsRoot();
  const out: ProjectSummary[] = [];
  for (const name of readdirSync(root)) {
    const file = projectFile(name);
    if (!existsSync(file)) continue;
    const doc = parseDoc(readFileSync(file, 'utf8'));
    if (!doc) continue;
    out.push({
      id: doc.id,
      name: doc.name,
      format: doc.format,
      sceneCount: doc.scenes.length,
      updatedAt: doc.updatedAt,
      coverPath: coverOf(doc),
      assembledPath: doc.assembledPath && existsSync(doc.assembledPath) ? doc.assembledPath : null,
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createProject(
  name: string,
  format: ProjectFormat = 'landscape',
  preset: FilmPreset = 'youtube',
  templateId: string | null = null,
): ProjectDoc {
  const doc = emptyProject(name, format, preset, templateId);
  mkdirSync(projectDir(doc.id), { recursive: true });
  writeFileSync(projectFile(doc.id), JSON.stringify(doc, null, 2));
  return doc;
}

export function loadProject(id: string): ProjectDoc | null {
  const file = projectFile(id);
  if (!existsSync(file)) return null;
  return parseDoc(readFileSync(file, 'utf8'));
}

export function saveProject(doc: ProjectDoc): ProjectDoc {
  const format = doc.format === 'shorts' ? 'shorts' : 'landscape';
  const preset = format === 'shorts' ? 'shorts' : normalizePreset(doc.preset);
  const next: ProjectDoc = {
    ...doc,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    format,
    preset,
    templateId: inferTemplateId(doc.preset, doc.templateId),
    callouts: Array.isArray(doc.callouts) ? doc.callouts : [],
    media: mergeMediaFromBins(
      doc.media,
      legacyBinsOf(doc.timeline?.bins),
      Date.now(),
    ),
    generationJobs: Array.isArray(doc.generationJobs) ? doc.generationJobs : [],
    exportSettings: {
      ...defaultExportSettings(format, preset),
      ...(doc.exportSettings || {}),
    },
    updatedAt: Date.now(),
  };
  mkdirSync(projectDir(next.id), { recursive: true });
  const file = projectFile(next.id);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(next, null, 2));
  renameSync(temp, file);
  return next;
}

export function importIntoProject(projectId: string, src: string): string {
  if (!existsSync(src)) throw new Error('File not found');
  mkdirSync(projectDir(projectId), { recursive: true });
  const ext = extname(src) || '.bin';
  const dest = join(projectDir(projectId), `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`);
  copyFileSync(src, dest);
  return dest;
}

export function importImageBytesIntoProject(projectId: string, data: Buffer, mime?: string): string {
  if (!data.byteLength) throw new Error('Empty image');
  mkdirSync(projectDir(projectId), { recursive: true });
  const raw = (mime || '').toLowerCase();
  let ext = '.png';
  if (raw.includes('jpeg') || raw.includes('jpg')) ext = '.jpg';
  else if (raw.includes('webp')) ext = '.webp';
  else if (raw.includes('png')) ext = '.png';
  const dest = join(projectDir(projectId), `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`);
  writeFileSync(dest, data);
  return dest;
}

export function deleteProject(id: string): boolean {
  const dir = projectDir(id);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
