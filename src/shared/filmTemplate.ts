export const ECOMMERCE_TEMPLATE_ID = 'builtin:ecommerce';

export type FilmTemplateFormat = 'landscape' | 'shorts';
export type FilmTemplateMotion = 'still_motion' | 'import' | 'i2v';

export interface FilmTemplateChapter {
  title: string;
  prompt: string;
  recordSteps: string;
  effectPrompt: string;
  textOverlay: string;
  durationSec: number;
  motion: FilmTemplateMotion;
}

/** Saved recipe. Media paths stay on the film, not in the template. */
export interface FilmTemplate {
  id: string;
  name: string;
  brief: string;
  format: FilmTemplateFormat;
  chapters: FilmTemplateChapter[];
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FilmTemplateDraft {
  name: string;
  brief: string;
  format: FilmTemplateFormat;
  chapters: FilmTemplateChapter[];
}

/**
 * Old films stored a single preset. `marketplace` meant the ecommerce pack.
 * An explicit null means the film is custom and must stay unlinked.
 */
export function inferTemplateId(preset: unknown, templateId: unknown): string | null {
  if (templateId === null) return null;
  if (typeof templateId === 'string' && templateId.trim()) return templateId.trim();
  if (preset === 'marketplace') return ECOMMERCE_TEMPLATE_ID;
  return null;
}

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function motionOf(value: unknown): FilmTemplateMotion {
  if (value === 'still_motion' || value === 'import' || value === 'i2v') return value;
  return 'import';
}

export function sanitizeChapters(value: unknown): FilmTemplateChapter[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 80) return null;
  return value.map((row) => {
    const chapter = row && typeof row === 'object' ? row as Record<string, unknown> : {};
    const duration = Number(chapter.durationSec);
    return {
      title: clip(chapter.title, 200),
      prompt: clip(chapter.prompt, 8000),
      recordSteps: clip(chapter.recordSteps, 8000),
      effectPrompt: clip(chapter.effectPrompt, 2000),
      textOverlay: clip(chapter.textOverlay, 400),
      durationSec: Number.isFinite(duration) ? Math.min(600, Math.max(0.5, duration)) : 12,
      motion: motionOf(chapter.motion),
    };
  });
}

export function sanitizeTemplateDraft(value: unknown): FilmTemplateDraft | null {
  if (!value || typeof value !== 'object') return null;
  const draft = value as Record<string, unknown>;
  const name = clip(draft.name, 80).trim();
  if (!name) return null;
  const chapters = sanitizeChapters(draft.chapters);
  if (!chapters) return null;
  return {
    name,
    brief: clip(draft.brief, 8000),
    format: draft.format === 'shorts' ? 'shorts' : 'landscape',
    chapters,
  };
}
