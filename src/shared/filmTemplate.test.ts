import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { deleteFilmTemplate, listFilmTemplates, saveFilmTemplate } from '../main/templateStore';
import { ECOMMERCE_TEMPLATE_ID, inferTemplateId, sanitizeTemplateDraft } from './filmTemplate';

describe('inferTemplateId', () => {
  it('keeps an explicit link and treats a cleared link as custom', () => {
    expect(inferTemplateId('youtube', 'user-template')).toBe('user-template');
    expect(inferTemplateId('marketplace', null)).toBeNull();
  });

  it('maps the old marketplace preset onto the built-in store demo', () => {
    expect(inferTemplateId('marketplace', undefined)).toBe(ECOMMERCE_TEMPLATE_ID);
    expect(inferTemplateId('shorts', undefined)).toBeNull();
    expect(inferTemplateId('youtube', undefined)).toBeNull();
    expect(inferTemplateId('hero', undefined)).toBeNull();
  });
});

describe('film template files', () => {
  it('saves a recipe without media and leaves the built-in demo in place', () => {
    const root = mkdtempSync(join(tmpdir(), 'film-templates-'));
    try {
      const saved = saveFilmTemplate({
        name: '  Обзор приложения  ',
        brief: 'Короткий обзор',
        format: 'shorts',
        chapters: [{
          title: 'Крючок',
          prompt: 'Первая фраза',
          recordSteps: 'Откройте главный экран',
          effectPrompt: '',
          textOverlay: 'Старт',
          durationSec: 8,
          motion: 'import',
        }],
      }, root);
      expect(saved.id).not.toBe(ECOMMERCE_TEMPLATE_ID);
      expect(saved.name).toBe('Обзор приложения');
      expect(saved.builtin).toBe(false);
      expect(listFilmTemplates(root).map((row) => row.id)).toEqual([saved.id]);
      expect(deleteFilmTemplate(ECOMMERCE_TEMPLATE_ID, root)).toBe(false);
      expect(deleteFilmTemplate(saved.id, root)).toBe(true);
      expect(listFilmTemplates(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects an empty recipe and ignores a broken file', () => {
    expect(sanitizeTemplateDraft({ name: '  ', brief: '', format: 'landscape', chapters: [] })).toBeNull();
    const root = mkdtempSync(join(tmpdir(), 'film-templates-'));
    try {
      writeFileSync(join(root, 'notes.json'), '{');
      expect(listFilmTemplates(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
