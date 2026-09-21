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

/** Labels that look “named” but are not useful story roles. */
export function isWeakClipTitle(name: string): boolean {
  const n = (name || '').trim();
  if (!n) return true;
  if (isTechnicalMediaName(n)) return true;
  if (/^(uploaded(\s+video)?|product(\s+(image|still|film))?|preview|footage|clip|audio|still|image|video|music|narration)$/i.test(n)) {
    return true;
  }
  if (/^preview\b/i.test(n)) return true;
  if (/\b[a-f0-9]{6,}\b/i.test(n) && /preview|audio|video|job|clip/i.test(n)) return true;
  if (/оригинал|original(\s+(audio|sound|video|звук))?/i.test(n)) return true;
  if (/что\s*это|what\s*is\s*this/i.test(n)) return true;
  return false;
}

/** Roles for stills on V1 so the timeline reads as a product story. */
const STILL_SEQUENCE_ROLES = ['Hero', 'Detail', 'Angle', 'Feature', 'Lifestyle', 'CTA'] as const;
const STILL_SEQUENCE_SHORT = ['Hero', 'Det', 'Ang', 'Fea', 'Life', 'CTA'] as const;

export function sequenceRoleLabel(index: number, compact = false): string {
  const list = compact ? STILL_SEQUENCE_SHORT : STILL_SEQUENCE_ROLES;
  return list[Math.max(0, index) % list.length];
}

function purposeLabel(purpose: string, compact: boolean): string {
  const full = purposeWord(purpose as Parameters<typeof purposeWord>[0]);
  if (!compact) return full;
  switch (purpose) {
    case 'PRODUCT_HERO': return 'Hero';
    case 'DETAIL': return 'Det';
    case 'ANGLE': return 'Ang';
    case 'FEATURE': return 'Fea';
    case 'LIFESTYLE': return 'Life';
    case 'CTA': return 'CTA';
    case 'HOOK': return 'Hook';
    default: return full.length > 5 ? full.slice(0, 4) : full;
  }
}

/**
 * User-facing title for timeline / cards.
 * Prefer shot purpose / story roles over filenames and weak upload labels.
 */
export function clipDisplayName(
  clip: Pick<TimelineClip, 'label' | 'text' | 'track'>,
  bin: BinItem | null | undefined,
  shot: FilmShot | null | undefined,
  sequenceIndex?: number,
  opts?: { compact?: boolean },
): string {
  const compact = Boolean(opts?.compact);

  if (shot?.shotPurpose) return purposeLabel(shot.shotPurpose, compact);

  if (clip.track.startsWith('t') && clip.text?.trim()) {
    return clip.text.trim().slice(0, compact ? 12 : 40);
  }

  // Audio: lane role beats filename / hash labels.
  if (bin?.kind === 'audio' || clip.track.startsWith('a')) {
    if (clip.track === 'a2') return compact ? 'Music' : 'Music';
    if (clip.track === 'a1') return compact ? 'Nar' : 'Narration';
    return 'Audio';
  }

  // Product stills: Hero → Detail → Angle → … by order on the lane.
  if (bin?.kind === 'image') {
    if (typeof sequenceIndex === 'number') return sequenceRoleLabel(sequenceIndex, compact);
    return 'Still';
  }

  // Footage without an AI purpose.
  if (bin?.kind === 'video') return compact ? 'Up' : 'Uploaded';

  const fromLabel = humanizeFileStem(clip.label || '');
  if (fromLabel && !isWeakClipTitle(fromLabel)) {
    return compact && fromLabel.length > 6 ? fromLabel.slice(0, 5) : fromLabel;
  }

  const fromBin = humanizeFileStem(bin?.name || '');
  if (fromBin && !isWeakClipTitle(fromBin)) {
    return compact && fromBin.length > 6 ? fromBin.slice(0, 5) : fromBin;
  }

  if (typeof sequenceIndex === 'number' && clip.track.startsWith('v')) {
    return sequenceRoleLabel(sequenceIndex, compact);
  }
  return 'Clip';
}

export function mediaBinDisplayName(
  bin: Pick<BinItem, 'name' | 'kind' | 'shotId' | 'path'>,
  shot?: FilmShot | null,
  productStillPath?: string | null,
): string {
  if (shot?.shotPurpose) return purposeWord(shot.shotPurpose);
  if (bin.shotId) return 'AI Shot';
  if (bin.kind === 'image') {
    if (sameProductPath(bin.path, productStillPath)) return 'Product';
    return 'Still';
  }
  if (bin.kind === 'audio') return 'Audio';
  if (bin.kind === 'video') return 'Uploaded';
  const human = humanizeFileStem(bin.name);
  if (human && !isWeakClipTitle(human)) return human;
  return bin.kind === 'image' ? 'Still' : 'Media';
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
