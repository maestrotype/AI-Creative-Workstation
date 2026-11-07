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
    if (clip.track === 'a1') {
      const label = (clip.label || '').trim();
      // Bare numbers / durations are not story names (e.g. "11" from an old index).
      if (
        label
        && !isRoleNarrationLabel(label)
        && !/^(ai\s+)?narration$/i.test(label)
        && !/^\d+(\.\d+)?s?$/i.test(label)
      ) {
        return compact && label.length > 14 ? `${label.slice(0, 12)}…` : label;
      }
      return 'Реплика';
    }
    return 'Audio';
  }

  // Product stills: Hero → Detail → Angle → … by order on the lane.
  if (bin?.kind === 'image') {
    if (typeof sequenceIndex === 'number') return sequenceRoleLabel(sequenceIndex, compact);
    return 'Still';
  }

  // Footage: the recording name, not a generic "Uploaded".
  if (bin?.kind === 'video') {
    const human = humanizeFileStem(clip.label || bin.name || '');
    if (human && !isWeakClipTitle(human)) {
      return compact ? human.slice(0, 8) : (human.length > 24 ? `${human.slice(0, 22)}…` : human);
    }
    return compact ? 'Up' : 'Uploaded';
  }

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

/** The same clause twice. "новые товары. новые товары." is a generation glitch. */
export function spokenStutters(text: string): boolean {
  const clauses = text
    .toLowerCase()
    .split(/[.!?…,;]+/)
    .map((part) => part.replace(/[^\p{L}\p{N}\s]+/gu, '').replace(/\s+/g, ' ').trim())
    .filter((part) => part.split(/\s+/).filter(Boolean).length >= 2);
  return new Set(clauses).size !== clauses.length;
}

/** Keep the first time a clause is said. */
export function withoutSpokenStutter(text: string): string {
  const pieces = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const piece of pieces) {
    const key = piece.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, '').replace(/\s+/g, ' ').trim();
    if (key.split(/\s+/).filter(Boolean).length >= 2) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    if (piece.trim()) kept.push(piece.trim());
  }
  return kept.join(' ');
}

export function isRoleNarrationLabel(label: string): boolean {
  return /^(hook|body|cta|outro|narration)$/i.test(label.trim());
}

/** Keep a longer clean line. A repeated clause never replaces the text. */
export function preferSpokenLine(current: string, next: string | undefined): string {
  const base = spokenStutters(current) ? withoutSpokenStutter(current) : current.trim();
  const candidate = (next || '').trim();
  if (!candidate || spokenStutters(candidate)) return base;
  const longer = candidate.split(/\s+/).filter(Boolean).length > base.split(/\s+/).filter(Boolean).length;
  if (spokenStutters(current) || longer) return candidate;
  return base;
}

/** The spoken line that belongs to this A1 clip. */
export function narrationLineAt(
  segments: Array<{ start_sec: number; anchor_sec?: number; text?: string; text_en?: string }> | undefined,
  startSec: number,
  lang: 'ru' | 'en' = 'ru',
): string {
  if (!segments?.length) return '';
  let best = segments[0];
  let bestDist = Infinity;
  for (const segment of segments) {
    const at = segment.anchor_sec ?? segment.start_sec;
    const dist = Math.abs(at - startSec);
    if (dist < bestDist) {
      best = segment;
      bestDist = dist;
    }
  }
  if (bestDist > 1.25) return '';
  const text = lang === 'en' ? (best.text_en || best.text || '') : (best.text || '');
  return text.trim();
}

function sentenceTitle(sentence: string): string {
  const clause = (sentence.split(/[.!?…]/)[0] || sentence).replace(/[«»"“”]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = clause
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((word) => word.length > 1)
    .slice(0, 5);
  const title = words.join(' ');
  return title.length > 42 ? `${title.slice(0, 40)}…` : title;
}

/**
 * Opening of the spoken line, so the timeline reads as the story.
 * `avoid` is the neighbour's title: a later sentence is used when the opening matches it.
 */
export function narrationClipTitle(text: string, avoid = ''): string {
  const pieces = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/);
  const counts = new Map<string, number>();
  const keys = pieces.map((piece) => {
    const key = piece.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, '').replace(/\s+/g, ' ').trim();
    if (key.split(/\s+/).filter(Boolean).length >= 2) counts.set(key, (counts.get(key) || 0) + 1);
    return key;
  });
  const candidates = pieces
    .filter((_piece, index) => {
      const words = keys[index].split(/\s+/).filter(Boolean);
      return words.length >= 3 && (counts.get(keys[index]) || 0) < 2;
    })
    .map(sentenceTitle)
    .filter(Boolean);
  if (!candidates.length) {
    const title = sentenceTitle(withoutSpokenStutter(text));
    candidates.push(title || 'Реплика');
  }
  const same = (title: string) => Boolean(avoid) && title.toLowerCase() === avoid.toLowerCase();
  return candidates.find((title) => !same(title)) || candidates[0];
}

/** Generated narration wavs. They already live on A1 and should not fill the media list. */
export function isNarrationRender(bin: { kind: string; name: string; path: string }): boolean {
  if (bin.kind !== 'audio') return false;
  if (/^(hook|body|cta|outro|narration)$/i.test(bin.name.trim())) return true;
  const file = (bin.path.split(/[/\\]/).pop() || bin.name).trim();
  return /^(?:vo|fit|lock|tts|voiceover)[-_]/i.test(file);
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
  if (bin.kind === 'video') {
    const human = humanizeFileStem(bin.name);
    if (human && !isWeakClipTitle(human)) {
      return human.length > 32 ? `${human.slice(0, 30)}…` : human;
    }
    return 'Uploaded';
  }
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

/** Short label for a narrow media card. Full id stays on the tooltip. */
export function shotModelLabel(shot: FilmShot): string {
  const raw = shotProviderShort(shot);
  if (/wan\s*2\.2|wan2\.2/i.test(raw)) return 'Wan 2.2';
  if (/^wan/i.test(raw)) return 'Wan';
  if (/flux/i.test(raw)) return 'FLUX';
  if (/minimax|\bh3\b/i.test(raw)) return 'MiniMax';
  if (raw.length > 16) return `${raw.slice(0, 14)}…`;
  return raw;
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
