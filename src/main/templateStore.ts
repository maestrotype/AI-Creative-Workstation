import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

import {
  ECOMMERCE_TEMPLATE_ID,
  sanitizeTemplateDraft,
  type FilmTemplate,
  type FilmTemplateDraft,
} from '../shared/filmTemplate';

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function templatesRoot(): string {
  const dir = join(homedir(), 'Documents/Canvas/Templates');
  mkdirSync(dir, { recursive: true });
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

export function listFilmTemplates(root = templatesRoot()): FilmTemplate[] {
  if (!existsSync(root)) return [];
  const out: FilmTemplate[] = [];
  for (const name of readdirSync(root)) {
    if (!name.endsWith('.json')) continue;
    const template = readTemplate(join(root, name));
    if (template) out.push(template);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveFilmTemplate(input: FilmTemplateDraft, root = templatesRoot()): FilmTemplate {
  const draft = sanitizeTemplateDraft(input);
  if (!draft) throw new Error('Укажите название и хотя бы одну главу');
  mkdirSync(root, { recursive: true });
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
}

export function deleteFilmTemplate(id: string, root = templatesRoot()): boolean {
  if (!ID_RE.test(id) || id === ECOMMERCE_TEMPLATE_ID) return false;
  const file = templateFile(root, id);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}
