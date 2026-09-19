export interface Callout {
  id: string;
  startSec: number;
  endSec: number;
  targetX: number; // 0..100 (percentage of video width)
  targetY: number; // 0..100 (percentage of video height)
  boxX: number;    // 0..100 (percentage of video width for the text card)
  boxY: number;    // 0..100 (percentage of video height for the text card)
  boxW?: number;   // custom card width in px
  boxH?: number;   // custom card height in px
  text: string;
  title?: string;
  theme: 'accent' | 'dark' | 'success' | 'warning' | 'info';
  shape?: 'rounded' | 'square' | 'pill' | 'circle';
  fontStyle?: 'system' | 'sans' | 'mono' | 'serif';
  arrowStyle: 'curved' | 'straight' | 'none';
  pulse: boolean;
}

let nextCalloutId = 1;

export function newCallout(params: Partial<Callout> & { startSec: number; targetX: number; targetY: number }): Callout {
  const duration = 4.0;
  const startSec = Math.max(0, params.startSec);
  const endSec = params.endSec ?? (startSec + duration);

  // By default, place the card offset to top-left or top-right of target
  const isRight = params.targetX > 50;
  const isBottom = params.targetY > 50;

  const defaultBoxX = isRight
    ? Math.max(5, params.targetX - 35)
    : Math.min(65, params.targetX + 8);
  const defaultBoxY = isBottom
    ? Math.max(5, params.targetY - 20)
    : Math.min(75, params.targetY + 5);

  return {
    id: params.id ?? `callout-${Date.now()}-${nextCalloutId++}`,
    startSec,
    endSec: Math.max(startSec + 0.5, endSec),
    targetX: Math.max(0, Math.min(100, params.targetX)),
    targetY: Math.max(0, Math.min(100, params.targetY)),
    boxX: params.boxX ?? defaultBoxX,
    boxY: params.boxY ?? defaultBoxY,
    boxW: params.boxW ?? 240,
    boxH: params.boxH,
    text: params.text || 'Кликните здесь для перехода',
    title: params.title,
    theme: params.theme ?? 'accent',
    shape: params.shape ?? 'rounded',
    fontStyle: params.fontStyle ?? 'sans',
    arrowStyle: params.arrowStyle ?? 'curved',
    pulse: params.pulse ?? true,
  };
}

export function calloutActiveAt(callout: Callout, sec: number): boolean {
  return sec >= callout.startSec - 0.05 && sec <= callout.endSec + 0.05;
}

export function calloutsActiveAt(callouts: Callout[], sec: number): Callout[] {
  return callouts.filter((c) => calloutActiveAt(c, sec));
}
