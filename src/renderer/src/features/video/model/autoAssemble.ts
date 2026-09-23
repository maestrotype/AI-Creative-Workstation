import {
  newId,
  type BinItem,
  type TimelineClip,
  type TrackLayout,
} from './directorTimeline';
import type { FilmShot, ShotPurpose } from '../../projects/model/project';

export const PURPOSE_ORDER: readonly ShotPurpose[] = [
  'HOOK',
  'PRODUCT_HERO',
  'DETAIL',
  'ANGLE',
  'FEATURE',
  'LIFESTYLE',
  'TRANSITION',
  'CTA',
];

export type AssemblyStyle = 'premium_ecommerce';

/** Honest Wan lengths at 24 fps (4n+1). Do not fake duration. */
export const SHOT_DURATION_PROFILES = [
  { sec: 1.7, frames: 41 },
  { sec: 3.4, frames: 81 },
  { sec: 5.0, frames: 121 },
] as const;

export interface AssembleFootage {
  path: string;
  durationSec: number;
  label: string;
  kind: 'video' | 'image';
  /** Set by a still-vs-frame check. Product films ignore anything that is not `same`. */
  productMatch?: 'same' | 'other' | 'unknown';
}

export interface AssembleInput {
  shots: FilmShot[];
  targetSec: number;
  style?: AssemblyStyle;
  productStillPath?: string | null;
  projectId?: string | null;
  footage?: AssembleFootage[];
}

export interface AssemblePlacement {
  shotId: string;
  startSec: number;
  durationSec: number;
  sourceInSec: number;
  sourceDurationSec: number;
  purpose: ShotPurpose;
  path: string;
  label: string;
}

export interface AssemblePlan {
  style: AssemblyStyle;
  targetSec: number;
  actualSec: number;
  rationale: string;
  skipped: Array<{ shotId: string; reason: string }>;
  placements: AssemblePlacement[];
  trackLayout: TrackLayout;
  needMoreMaterial: boolean;
  needMoreSec: number;
}

const MIN_CLIP = 0.5;
const CTA_RESERVE = 1.5;

export function inferShotPurpose(prompt: string, index = 0, _total = 1): ShotPurpose {
  const text = (prompt || '').toLowerCase();
  if (/hook|cold open|first look/.test(text)) return 'HOOK';
  if (/close-?up|detail|texture|material|fabric|knit|sole/.test(text)) return 'DETAIL';
  if (/orbit|side profile|side angle|three-quarter|angle/.test(text)) return 'ANGLE';
  if (/lifestyle|worn|street|on foot/.test(text)) return 'LIFESTYLE';
  if (/\bcta\b|wide premium|pull the camera back|pull back|end card/.test(text)) return 'CTA';
  if (/feature|logo|stripe/.test(text)) return 'FEATURE';
  if (/hero|push-in|push in|push toward/.test(text)) return 'PRODUCT_HERO';
  const fallback: ShotPurpose[] = ['HOOK', 'PRODUCT_HERO', 'DETAIL', 'CTA'];
  return fallback[Math.min(index, fallback.length - 1)] ?? 'PRODUCT_HERO';
}

export function shotIsUsable(shot: FilmShot): { ok: boolean; reason?: string } {
  if (shot.validationStatus === 'failed') return { ok: false, reason: 'failed_validation' };
  if (!shot.artifactPath) return { ok: false, reason: 'missing_artifact' };
  if (shot.duration < MIN_CLIP) return { ok: false, reason: 'too_short' };
  const meta = shot.generationMetadata || {};
  if (meta.low_motion === true) return { ok: false, reason: 'low_motion' };
  if (shot.validationStatus === 'warning' && shot.productIdentityWarning) {
    return { ok: false, reason: 'identity_warning' };
  }
  return { ok: true };
}

function purposeRank(purpose: ShotPurpose): number {
  const i = PURPOSE_ORDER.indexOf(purpose);
  return i < 0 ? 50 : i;
}

function pickUnique(shots: FilmShot[]): FilmShot[] {
  const seen = new Set<ShotPurpose>();
  const out: FilmShot[] = [];
  const sorted = [...shots].sort((a, b) => purposeRank(a.shotPurpose) - purposeRank(b.shotPurpose));
  for (const shot of sorted) {
    if (seen.has(shot.shotPurpose)) continue;
    seen.add(shot.shotPurpose);
    out.push(shot);
  }
  return out;
}

function pushPlacement(
  placements: AssemblePlacement[],
  skipped: AssemblePlan['skipped'],
  cursor: number,
  remaining: number,
  item: {
    shotId: string;
    duration: number;
    purpose: ShotPurpose;
    path: string;
    label: string;
  },
): number {
  if (remaining < MIN_CLIP) {
    skipped.push({ shotId: item.shotId, reason: 'no_budget' });
    return cursor;
  }
  const duration = roundTenths(Math.min(item.duration, remaining));
  if (duration < MIN_CLIP) {
    skipped.push({ shotId: item.shotId, reason: 'too_short' });
    return cursor;
  }
  placements.push({
    shotId: item.shotId,
    startSec: cursor,
    durationSec: duration,
    sourceInSec: 0,
    sourceDurationSec: item.duration,
    purpose: item.purpose,
    path: item.path,
    label: item.label,
  });
  return roundTenths(cursor + duration);
}

export function assembleShots(input: AssembleInput): AssemblePlan {
  const style: AssemblyStyle = input.style ?? 'premium_ecommerce';
  const target = Math.max(2, Number(input.targetSec) || 10);
  const skipped: AssemblePlan['skipped'] = [];
  const product = input.productStillPath || null;
  const usable: FilmShot[] = [];
  for (const shot of input.shots) {
    const check = shotIsUsable(shot);
    if (!check.ok) {
      skipped.push({ shotId: shot.id, reason: check.reason || 'skipped' });
      continue;
    }
    if (input.projectId && shot.projectId && shot.projectId !== input.projectId) {
      skipped.push({ shotId: shot.id, reason: 'other_film' });
      continue;
    }
    // A product film only uses shots generated from its still. Unscoped rows
    // (no source) are how another asset slips into the cut.
    if (product) {
      if (!shot.sourceAsset || !sameProductAsset(shot.sourceAsset, product)) {
        skipped.push({ shotId: shot.id, reason: shot.sourceAsset ? 'other_product' : 'unscoped' });
        continue;
      }
    }
    usable.push(shot);
  }
  const unique = pickUnique(usable);
  const cta = unique.find((s) => s.shotPurpose === 'CTA');
  const body = unique.filter((s) => s.shotPurpose !== 'CTA');
  const shotPaths = new Set(usable.map((s) => s.artifactPath));
  const uploads = (input.footage || []).filter((row) => {
    if (row.kind !== 'video' || row.durationSec < MIN_CLIP || shotPaths.has(row.path)) return false;
    if (product && row.productMatch !== 'same') {
      skipped.push({ shotId: `upload:${row.path}`, reason: 'unrelated_footage' });
      return false;
    }
    if (row.productMatch === 'other') {
      skipped.push({ shotId: `upload:${row.path}`, reason: 'unrelated_footage' });
      return false;
    }
    return true;
  });

  const placements: AssemblePlacement[] = [];
  let cursor = 0;
  const reserve = cta ? Math.min(CTA_RESERVE, cta.duration, Math.max(0, target * 0.2)) : 0;

  if (uploads[0]) {
    const hookCap = Math.max(2, target * 0.35);
    cursor = pushPlacement(placements, skipped, cursor, Math.max(MIN_CLIP, target - reserve - cursor), {
      shotId: `upload:${uploads[0].path}`,
      duration: Math.min(uploads[0].durationSec, hookCap),
      purpose: 'HOOK',
      path: uploads[0].path,
      label: uploads[0].label || 'Footage',
    });
  }

  for (const shot of body) {
    cursor = pushPlacement(placements, skipped, cursor, Math.max(0, target - reserve - cursor), {
      shotId: shot.id,
      duration: shot.duration,
      purpose: shot.shotPurpose,
      path: shot.artifactPath,
      label: shotLabel(shot),
    });
  }

  for (const extra of uploads.slice(1)) {
    cursor = pushPlacement(placements, skipped, cursor, Math.max(0, target - reserve - cursor), {
      shotId: `upload:${extra.path}`,
      duration: extra.durationSec,
      purpose: 'LIFESTYLE',
      path: extra.path,
      label: extra.label || 'Footage',
    });
  }

  if (cta) {
    cursor = pushPlacement(placements, skipped, cursor, Math.max(MIN_CLIP, target - cursor), {
      shotId: cta.id,
      duration: cta.duration,
      purpose: 'CTA',
      path: cta.artifactPath,
      label: shotLabel(cta),
    });
  }

  const actual = roundTenths(cursor);
  const needMoreSec = roundTenths(Math.max(0, target - actual));
  const rationale = placements.map((p) => purposeWord(p.purpose)).join(' → ') || 'No usable shots';
  return {
    style,
    targetSec: target,
    actualSec: actual,
    rationale,
    skipped,
    placements,
    trackLayout: { videos: 2, audios: 2, titles: 1 },
    needMoreMaterial: needMoreSec > 0.8,
    needMoreSec,
  };
}

export function planToTimeline(plan: AssemblePlan): { bins: BinItem[]; clips: TimelineClip[] } {
  const bins: BinItem[] = [];
  const clips: TimelineClip[] = [];
  const byPath = new Map<string, BinItem>();
  for (const place of plan.placements) {
    let bin = byPath.get(place.path);
    if (!bin) {
      const isImage = /\.(png|jpe?g|webp|gif|bmp)$/i.test(place.path);
      const sourceDur = Math.max(place.sourceDurationSec || place.durationSec, 0.4);
      const linkedShot = place.shotId !== 'still' && !place.shotId.startsWith('upload:');
      bin = {
        id: newId('bin'),
        kind: isImage ? 'image' : 'video',
        path: place.path,
        name: place.label,
        durationSec: sourceDur,
        inSec: 0,
        outSec: sourceDur,
        durationKnown: true,
        shotId: linkedShot ? place.shotId : undefined,
      };
      byPath.set(place.path, bin);
      bins.push(bin);
    }
    bin.durationSec = Math.max(bin.durationSec, place.sourceInSec + place.durationSec);
    bin.outSec = Math.max(bin.outSec, bin.durationSec);
    clips.push({
      id: newId('clip'),
      binId: bin.id,
      track: 'v1',
      startSec: place.startSec,
      durationSec: place.durationSec,
      sourceInSec: place.sourceInSec,
      label: place.label,
      autoLength: false,
    });
  }
  return { bins, clips };
}

function roundTenths(n: number): number {
  return Math.round(n * 10) / 10;
}

export function sameProductAsset(sourceAsset: string, productStillPath: string): boolean {
  const norm = (p: string) => p.replace(/^file:\/\//, '').replace(/\\/g, '/').toLowerCase();
  const a = norm(sourceAsset);
  const b = norm(productStillPath);
  return Boolean(a) && a === b;
}

function shotLabel(shot: FilmShot): string {
  return purposeWord(shot.shotPurpose);
}

export function purposeWord(purpose: ShotPurpose): string {
  switch (purpose) {
    case 'HOOK': return 'Hook';
    case 'PRODUCT_HERO': return 'Hero';
    case 'DETAIL': return 'Detail';
    case 'FEATURE': return 'Feature';
    case 'ANGLE': return 'Angle';
    case 'LIFESTYLE': return 'Lifestyle';
    case 'TRANSITION': return 'Transition';
    case 'CTA': return 'CTA';
    default: return 'Shot';
  }
}

export function promptForPurpose(purpose: ShotPurpose, brief = ''): string {
  const context = brief.trim();
  const prefix = context ? `Ecommerce product film. Brief: ${context} ` : '';
  const lock = 'This is the exact product shown in the reference image. Preserve its shape, colors, materials, proportions and visible details. Do not add another product or replace it.';
  switch (purpose) {
    case 'HOOK':
      return `${prefix}Opening look at the exact product shown in the reference image. Slow cinematic push-in. ${lock}`;
    case 'DETAIL':
      return `${prefix}Close-up ecommerce shot of the exact same product from the reference image. Reveal material and construction with a slow cinematic push-in. ${lock}`;
    case 'ANGLE':
      return `${prefix}Show the exact same product from the reference image with a subtle cinematic orbit. ${lock}`;
    case 'FEATURE':
      return `${prefix}Feature detail of the exact product shown in the reference image. Slow cinematic push-in on a visible construction detail. ${lock}`;
    case 'LIFESTYLE':
      return `${prefix}The exact product from the reference image stays the visual focus. Slow cinematic push-in. ${lock}`;
    case 'CTA':
      return `${prefix}Clean premium presentation of the exact product shown in the reference image. Slight slow push-in, product centered. ${lock}`;
    case 'TRANSITION':
      return `${prefix}Short connecting push-in on the exact product shown in the reference image. ${lock}`;
    case 'PRODUCT_HERO':
    default:
      return `${prefix}Premium ecommerce hero shot of the exact product shown in the reference image. Slow cinematic push-in. ${lock}`;
  }
}

/** Keep the product lock even when the user adds a short insert line. */
export function promptForShot(purpose: ShotPurpose, brief = '', userText = ''): string {
  const base = promptForPurpose(purpose, brief);
  const extra = userText.trim();
  if (!extra || extra === base) return base;
  if (/exact product/i.test(extra) && /preserve its shape/i.test(extra)) return extra;
  return `${base}\n${extra}`;
}

export function productShotPresets(brief = ''): Array<{ purpose: ShotPurpose; prompt: string }> {
  const purposes: ShotPurpose[] = ['PRODUCT_HERO', 'DETAIL', 'ANGLE', 'FEATURE'];
  return purposes.map((purpose) => ({ purpose, prompt: promptForPurpose(purpose, brief) }));
}

export const PRODUCT_SHOT_PRESETS = productShotPresets();
