import { purposeWord } from './autoAssemble';
import type { BinItem, TimelineClip } from './directorTimeline';
import type { FilmShot } from '../../projects/model/project';

/** Filenames / job ids that must never be the primary timeline title. */
export function isTechnicalMediaName(name: string): boolean {
  const base = (name || '').trim();
  if (!base) return true;
  const stem = base.replace(/\.[^.]+$/, '');
  if (/^(job|vid|clip|bin|img|image|shot|gen|tmp|foo)[_-]/i.test(stem)) return true;
  if (/^[a-f0-9]{8,}([_-][a-f0-9]+)*$/i.test(stem)) return true;
  if (/[_-][a-f0-9]{6,}/i.test(stem) && /\.(mp4|mov|webm|mkv|png|jpe?g|webp|gif)$/i.test(base)) return true;
  if (/^[a-z0-9]{10,}\.[a-z0-9]+$/i.test(base)) return true;
  return false;
}

export function humanizeFileStem(name: string): string {
  const stem = (name || '').replace(/\.[^.]+$/, '').trim();
  if (!stem || isTechnicalMediaName(name)) return '';
  return stem
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Roles for stills / untitled clips on V1 so the timeline reads as a story. */
const STILL_SEQUENCE_ROLES = ['Hero', 'Detail', 'Angle', 'Feature', 'Lifestyle', 'CTA'] as const;

export function sequenceRoleLabel(index: number): string {
  return STILL_SEQUENCE_ROLES[Math.max(0, index) % STILL_SEQUENCE_ROLES.length];
}

/** User-facing title for timeline / cards. Technical paths stay in Inspector. */
export function clipDisplayName(
  clip: Pick<TimelineClip, 'label' | 'text' | 'track'>,
  bin: BinItem | null | undefined,
  shot: FilmShot | null | undefined,
  sequenceIndex?: number,
): string {
  if (shot?.shotPurpose) return purposeWord(shot.shotPurpose);
  if (clip.text?.trim()) return clip.text.trim().slice(0, 40);

  const fromLabel = humanizeFileStem(clip.label || '');
  if (fromLabel && !/^product image$/i.test(fromLabel)) return fromLabel;

  const fromBin = humanizeFileStem(bin?.name || '');
  if (fromBin && !/^product image$/i.test(fromBin)) return fromBin;

  if (bin?.kind === 'image' || (clip.track.startsWith('v') && bin?.kind !== 'video' && bin?.kind !== 'audio')) {
    if (typeof sequenceIndex === 'number') return sequenceRoleLabel(sequenceIndex);
    return 'Still';
  }
  if (bin?.kind === 'audio' || clip.track.startsWith('a')) {
    if (/оригинал|original/i.test(clip.label || '')) return 'Original Audio';
    return 'Narration';
  }
  if (bin?.kind === 'video') return 'Uploaded Video';
  if (typeof sequenceIndex === 'number' && clip.track.startsWith('v')) {
    return sequenceRoleLabel(sequenceIndex);
  }
  return 'Clip';
}

export function shotCardTitle(shot: FilmShot): string {
  return purposeWord(shot.shotPurpose);
}

export function shotProviderShort(shot: FilmShot): string {
  if (!shot.provider || shot.provider === 'unknown') return 'AI';
  const model = (shot.modelId || '').split('/').pop() || '';
  const provider = shot.provider.split('/').pop() || shot.provider;
  if (model && model !== provider) return model;
  return provider;
}

export function sameProductPath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (p: string) => p.replace(/^file:\/\//, '').replace(/\\/g, '/').toLowerCase();
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  const ta = na.split('/').pop() || na;
  const tb = nb.split('/').pop() || nb;
  return Boolean(ta && tb && ta === tb);
}
