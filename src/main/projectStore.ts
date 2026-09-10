import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';

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

export interface ProjectDoc {
  id: string;
  name: string;
  kind: ProjectKind;
  format: ProjectFormat;
  preset: FilmPreset;
  brief: string;
  scenes: ProjectScene[];
  shots: FilmShot[];
  timeline: FilmTimeline | null;
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

function formatForPreset(preset: FilmPreset): ProjectFormat {
  return preset === 'shorts' ? 'shorts' : 'landscape';
}

function normalizeMotion(value: unknown): ShotMotion {
  if (value === 'import' || value === 'i2v' || value === 'still_motion') return value;
  return 'still_motion';
}

function normalizePreset(value: unknown): FilmPreset {
  if (value === 'hero' || value === 'youtube' || value === 'shorts' || value === 'marketplace') return value;
  return 'marketplace';
}

function emptyProject(name: string, format: ProjectFormat = 'landscape', preset: FilmPreset = 'marketplace'): ProjectDoc {
  const now = Date.now();
  const nextPreset = preset;
  const nextFormat = preset === 'shorts' ? 'shorts' : format;
  return {
    id: randomUUID(),
    name: name.trim() || 'Untitled',
    kind: 'video',
    format: nextPreset === 'shorts' ? 'shorts' : nextFormat,
    preset: nextPreset,
    brief: '',
    scenes: [],
    shots: [],
    timeline: null,
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
    return {
      ...emptyProject(parsed.name, format, preset),
      ...parsed,
      id: parsed.id,
      format,
      preset,
      scenes,
      shots,
      timeline: parsed.timeline && typeof parsed.timeline === 'object' ? parsed.timeline : null,
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
  preset: FilmPreset = 'marketplace',
): ProjectDoc {
  const doc = emptyProject(name, formatForPreset(preset) === 'shorts' ? 'shorts' : format, preset);
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
  const next = { ...doc, updatedAt: Date.now() };
  mkdirSync(projectDir(next.id), { recursive: true });
  writeFileSync(projectFile(next.id), JSON.stringify(next, null, 2));
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

export function deleteProject(id: string): boolean {
  const dir = projectDir(id);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
