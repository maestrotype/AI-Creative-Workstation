/** Film hint (C1). Kept as `Callout` for session compatibility. */

export type HintType = 'minimal' | 'accent' | 'card' | 'sticker' | 'pointer';
export type HintSize = 's' | 'm' | 'l' | 'auto';
export type HintAnimIn = 'none' | 'fade' | 'slide-up' | 'pop' | 'typewriter';
export type HintAnimOut = 'none' | 'fade';
export type HintAnchor = 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** @deprecated Prefer HintType — kept for older sessions */
export type CalloutTheme = 'accent' | 'dark' | 'success' | 'warning' | 'info';

export interface Callout {
  id: string;
  startSec: number;
  endSec: number;
  /** Point of interest on frame (0–100%). */
  targetX: number;
  targetY: number;
  /** Text block top-left (0–100%). */
  boxX: number;
  boxY: number;
  boxW?: number;
  boxH?: number;
  text: string;
  title?: string;
  /** Visual preset */
  type: HintType;
  size: HintSize;
  animationIn: HintAnimIn;
  animationOut: HintAnimOut;
  anchor: HintAnchor;
  stickerUrl?: string;
  stickerScale?: number;
  color?: string;
  /** Legacy fields — still read for migration / pointer line */
  theme: CalloutTheme;
  shape?: 'rounded' | 'square' | 'pill' | 'circle';
  fontStyle?: 'system' | 'sans' | 'mono' | 'serif';
  arrowStyle: 'curved' | 'straight' | 'none';
  pulse: boolean;
}

export type Hint = Callout;

let nextCalloutId = 1;

const DEFAULT_TEXT = 'Нажмите сюда';

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export function hintDuration(h: Pick<Callout, 'startSec' | 'endSec'>): number {
  return Math.max(0.4, h.endSec - h.startSec);
}

export function themeToType(theme: CalloutTheme, arrowStyle?: string): HintType {
  if (arrowStyle && arrowStyle !== 'none') return 'pointer';
  if (theme === 'dark') return 'minimal';
  if (theme === 'info') return 'card';
  return 'accent';
}

export function normalizeCallout(raw: Partial<Callout> & { id?: string }): Callout {
  const startSec = Math.max(0, raw.startSec ?? 0);
  const endSec = Math.max(startSec + 0.4, raw.endSec ?? startSec + 3);
  const targetX = clampPct(raw.targetX ?? 50);
  const targetY = clampPct(raw.targetY ?? 50);
  const theme = raw.theme ?? 'accent';
  const incomingArrow = raw.arrowStyle ?? 'none';
  const type = raw.type ?? themeToType(theme, incomingArrow);

  const isRight = targetX > 58;
  const isBottom = targetY > 68;
  const defaultBoxX = isRight ? Math.max(4, targetX - 26) : Math.min(74, targetX + 18);
  const defaultBoxY = isBottom ? Math.max(6, targetY - 18) : Math.min(80, targetY + 12);
  let boxX = clampPct(raw.boxX ?? defaultBoxX);
  let boxY = clampPct(raw.boxY ?? defaultBoxY);
  if (Math.hypot(boxX - targetX, boxY - targetY) < 8) {
    boxX = clampPct(defaultBoxX);
    boxY = clampPct(defaultBoxY);
  }
  const wantsArrow = type !== 'sticker' && type !== 'minimal';
  const arrowStyle = raw.arrowStyle === 'curved' || raw.arrowStyle === 'straight'
    ? raw.arrowStyle
    : wantsArrow ? 'straight' : 'none';

  return {
    id: raw.id ?? `hint-${Date.now()}-${nextCalloutId++}`,
    startSec,
    endSec,
    targetX,
    targetY,
    boxX,
    boxY,
    boxW: raw.boxW,
    boxH: raw.boxH,
    text: (raw.text || DEFAULT_TEXT).trim() || DEFAULT_TEXT,
    title: raw.title,
    type,
    size: raw.size ?? 'm',
    animationIn: raw.animationIn ?? 'fade',
    animationOut: raw.animationOut ?? 'fade',
    anchor: raw.anchor ?? 'center',
    stickerUrl: raw.stickerUrl,
    stickerScale: raw.stickerScale ?? 1,
    color: raw.color,
    theme,
    shape: raw.shape ?? 'rounded',
    fontStyle: raw.fontStyle ?? 'sans',
    arrowStyle,
    pulse: raw.pulse ?? type === 'pointer',
  };
}

export function newCallout(
  params: Partial<Callout> & { startSec: number; targetX: number; targetY: number },
): Callout {
  const duration = 3;
  const startSec = Math.max(0, params.startSec);
  return normalizeCallout({
    ...params,
    startSec,
    endSec: params.endSec ?? startSec + duration,
  });
}

export function calloutActiveAt(callout: Callout, sec: number): boolean {
  return sec >= callout.startSec - 0.05 && sec <= callout.endSec + 0.05;
}

export function calloutsActiveAt(callouts: Callout[], sec: number): Callout[] {
  return callouts.filter((c) => calloutActiveAt(c, sec));
}

export function normalizeCalloutList(list: unknown): Callout[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) => normalizeCallout((item || {}) as Partial<Callout>));
}

export function hintTypeLabel(type: HintType): string {
  switch (type) {
    case 'minimal': return 'Minimal';
    case 'accent': return 'Accent';
    case 'card': return 'Card';
    case 'sticker': return 'Sticker';
    case 'pointer': return 'Pointer';
    default: return 'Hint';
  }
}

export function hintLaneTone(type: HintType): 'text' | 'card' | 'sticker' | 'pointer' {
  if (type === 'sticker') return 'sticker';
  if (type === 'pointer') return 'pointer';
  if (type === 'card') return 'card';
  return 'text';
}

/** Playback phase for CSS enter/exit animations. */
export function hintAnimPhase(
  hint: Callout,
  playhead: number,
): 'idle' | 'in' | 'hold' | 'out' {
  if (!calloutActiveAt(hint, playhead)) return 'idle';
  const dur = hintDuration(hint);
  const t = playhead - hint.startSec;
  const inWin = Math.min(0.35, dur * 0.2);
  const outWin = Math.min(0.35, dur * 0.2);
  if (t <= inWin) return 'in';
  if (t >= dur - outWin) return 'out';
  return 'hold';
}
