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
  'FEATURE',
  'ANGLE',
  'LIFESTYLE',
  'TRANSITION',
  'CTA',
];

export type AssemblyStyle = 'premium_ecommerce';

export interface AssembleInput {
  shots: FilmShot[];
  targetSec: number;
  style?: AssemblyStyle;
  productStillPath?: string | null;
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

export function assembleShots(input: AssembleInput): AssemblePlan {
  const style: AssemblyStyle = input.style ?? 'premium_ecommerce';
  const target = Math.max(2, Number(input.targetSec) || 10);
  const skipped: AssemblePlan['skipped'] = [];
  const usable: FilmShot[] = [];
  for (const shot of input.shots) {
    const check = shotIsUsable(shot);
    if (!check.ok) {
      skipped.push({ shotId: shot.id, reason: check.reason || 'skipped' });
      continue;
    }
    usable.push(shot);
  }
  const unique = pickUnique(usable);
  const cta = unique.find((s) => s.shotPurpose === 'CTA');
  const body = unique.filter((s) => s.shotPurpose !== 'CTA');
  const placements: AssemblePlacement[] = [];
  let cursor = 0;
  const reserve = cta ? Math.min(CTA_RESERVE, cta.duration, Math.max(0, target * 0.2)) : 0;
  const bodyBudget = Math.max(MIN_CLIP, target - reserve);

  for (const shot of body) {
    const remaining = bodyBudget - cursor;
    if (remaining < MIN_CLIP) break;
    const duration = Math.min(shot.duration, remaining);
    if (duration < MIN_CLIP) break;
    placements.push({
      shotId: shot.id,
      startSec: cursor,
      durationSec: roundTenths(duration),
      sourceInSec: 0,
      sourceDurationSec: shot.duration,
      purpose: shot.shotPurpose,
      path: shot.artifactPath,
      label: shotLabel(shot),
    });
    cursor += roundTenths(duration);
  }

  if (cta) {
    const remaining = target - cursor;
    const duration = Math.min(cta.duration, Math.max(MIN_CLIP, remaining));
    if (duration >= MIN_CLIP) {
      placements.push({
        shotId: cta.id,
        startSec: cursor,
        durationSec: roundTenths(duration),
        sourceInSec: 0,
        sourceDurationSec: cta.duration,
        purpose: 'CTA',
        path: cta.artifactPath,
        label: shotLabel(cta),
      });
      cursor += roundTenths(duration);
    }
  }

  if (placements.length === 0 && input.productStillPath) {
    placements.push({
      shotId: 'still',
      startSec: 0,
      durationSec: Math.min(4, target),
      sourceInSec: 0,
      sourceDurationSec: Math.min(4, target),
      purpose: 'PRODUCT_HERO',
      path: input.productStillPath,
      label: 'Product still',
    });
    cursor = placements[0].durationSec;
  } else if (cursor < target - 0.8 && input.productStillPath) {
    const hold = roundTenths(Math.min(4, target - cursor));
    if (hold >= MIN_CLIP) {
      placements.push({
        shotId: 'still',
        startSec: cursor,
        durationSec: hold,
        sourceInSec: 0,
        sourceDurationSec: hold,
        purpose: 'CTA',
        path: input.productStillPath,
        label: 'Product still',
      });
      cursor += hold;
    }
  }

  const rationale = placements.map((p) => purposeWord(p.purpose)).join(' → ') || 'No usable shots';
  return {
    style,
    targetSec: target,
    actualSec: roundTenths(cursor),
    rationale,
    skipped,
    placements,
    trackLayout: { videos: 2, audios: 2, titles: 1 },
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
      bin = {
        id: newId('bin'),
        kind: isImage ? 'image' : 'video',
        path: place.path,
        name: place.label,
        durationSec: sourceDur,
        inSec: 0,
        outSec: sourceDur,
        durationKnown: true,
        shotId: place.shotId === 'still' ? undefined : place.shotId,
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

function shotLabel(shot: FilmShot): string {
  return purposeWord(shot.shotPurpose);
}

function purposeWord(purpose: ShotPurpose): string {
  switch (purpose) {
    case 'HOOK': return 'Hook';
    case 'PRODUCT_HERO': return 'Hero';
    case 'DETAIL': return 'Detail';
    case 'FEATURE': return 'Feature';
    case 'ANGLE': return 'Side';
    case 'LIFESTYLE': return 'Lifestyle';
    case 'TRANSITION': return 'Transition';
    case 'CTA': return 'CTA';
    default: return 'Shot';
  }
}

export function productShotPresets(brief = ''): Array<{ purpose: ShotPurpose; prompt: string }> {
  const context = brief.trim();
  const prefix = context
    ? `Ecommerce product film. Brief: ${context}\n`
    : 'Ecommerce product film.\n';
  return [
    {
      purpose: 'PRODUCT_HERO',
      prompt:
        `${prefix}Hero product presentation. Slow cinematic push-in toward the product. Preserve the exact product shape, colors, materials and proportions. Keep the product as the visual focus. No additional products or unrelated objects.`,
    },
    {
      purpose: 'ANGLE',
      prompt:
        `${prefix}Subtle cinematic orbit showing the side profile of the product. Preserve the exact product shape, colors, materials and proportions. Keep the product as the visual focus.`,
    },
    {
      purpose: 'DETAIL',
      prompt:
        `${prefix}Close-up emphasizing material texture and construction of the product. Slow, stable camera. Preserve the exact product shape, colors, materials and proportions.`,
    },
    {
      purpose: 'CTA',
      prompt:
        `${prefix}Clean wide premium ecommerce presentation. Slight slow push-in, product centered, generous negative space. Do not pull the camera back. Preserve the exact product shape, colors, materials and proportions.`,
    },
  ];
}

export const PRODUCT_SHOT_PRESETS = productShotPresets();
