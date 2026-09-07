import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';

export type ProjectKind = 'video';
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
  kind: ProjectKind;
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

function emptyProject(name: string, format: ProjectFormat = 'landscape'): ProjectDoc {
  const now = Date.now();
  return {
    id: randomUUID(),
    name: name.trim() || 'Untitled',
    kind: 'video',
    format,
    brief: '',
    scenes: [],
    assembledPath: null,
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
    durationSec: 5,
    stillPath: null,
    clipPath: null,
  };
}

function parseDoc(raw: string): ProjectDoc | null {
  try {
    const parsed = JSON.parse(raw) as ProjectDoc;
    if (!parsed?.id || !parsed.name) return null;
    return {
      ...emptyProject(parsed.name, parsed.format === 'shorts' ? 'shorts' : 'landscape'),
      ...parsed,
      id: parsed.id,
      format: parsed.format === 'shorts' ? 'shorts' : 'landscape',
      scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
    };
  } catch {
    return null;
  }
}

function coverOf(doc: ProjectDoc): string | null {
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

export function createProject(name: string, format: ProjectFormat = 'landscape'): ProjectDoc {
  const doc = emptyProject(name, format);
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
