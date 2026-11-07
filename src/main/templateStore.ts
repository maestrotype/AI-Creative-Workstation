import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

import {
  ECOMMERCE_TEMPLATE_ID,
  sanitizeTemplateDraft,
  type FilmTemplate,
  type FilmTemplateDraft,
} from '../shared/filmTemplate';
import { canvasAccessMessage, isDeniedFsError, safeListDir, tryEnsureCanvasDir } from './canvasFs';

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function templatesRoot(): string {
  const dir = tryEnsureCanvasDir('Templates');
  if (!dir) {
    throw new Error(canvasAccessMessage({ code: 'EPERM' }));
  }
  return dir;
}

function templateFile(root: string, id: string): string {
  return join(root, `${id}.json`);
}

function readTemplate(file: string): FilmTemplate | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as FilmTemplate;
    const draft = sanitizeTemplateDraft(parsed);
    if (!draft || !ID_RE.test(parsed.id) || parsed.id === ECOMMERCE_TEMPLATE_ID) return null;
    return {
      ...draft,
      id: parsed.id,
      builtin: false,
      createdAt: Number(parsed.createdAt) || Date.now(),
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

/** Saved recipes only. Built-in «Демо магазина» does not live on disk. */
export function listFilmTemplates(root?: string): FilmTemplate[] {
  const dir = root ?? tryEnsureCanvasDir('Templates');
  if (!dir) return [];
  const out: FilmTemplate[] = [];
  for (const name of safeListDir(dir)) {
    if (!name.endsWith('.json')) continue;
    const template = readTemplate(join(dir, name));
    if (template) out.push(template);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveFilmTemplate(input: FilmTemplateDraft, root = templatesRoot()): FilmTemplate {
  const draft = sanitizeTemplateDraft(input);
  if (!draft) throw new Error('Укажите название и хотя бы одну главу');
  try {
    const now = Date.now();
    const template: FilmTemplate = {
      ...draft,
      id: randomUUID(),
      builtin: false,
      createdAt: now,
      updatedAt: now,
    };
    writeFileSync(templateFile(root, template.id), JSON.stringify(template, null, 2));
    return template;
  } catch (err) {
    if (isDeniedFsError(err)) throw new Error(canvasAccessMessage(err));
    throw err;
  }
}

export function deleteFilmTemplate(id: string, root?: string): boolean {
  if (!ID_RE.test(id) || id === ECOMMERCE_TEMPLATE_ID) return false;
  const dir = root ?? tryEnsureCanvasDir('Templates');
  if (!dir) return false;
  const file = templateFile(dir, id);
  if (!existsSync(file)) return false;
  try {
    rmSync(file);
    return true;
  } catch (err) {
    if (isDeniedFsError(err)) return false;
    throw err;
  }
}
