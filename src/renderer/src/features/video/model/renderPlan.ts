import type { ProjectExportSettings, ProjectFormat } from '../../projects/model/project';
import type { Callout } from './callout';
import type { BinItem, OverlayPos, TimelineClip } from './directorTimeline';

export interface RenderPlan {
  clips: Array<{
    kind: string;
    track: string;
    path: string | null;
    text: string | null;
    start_sec: number;
    duration_sec: number;
    source_in_sec: number;
    muted?: boolean;
    volume?: number;
    effect?: string | null;
  }>;
  width: number;
  height: number;
  fps: number;
  audio_policy: 'original' | 'duck' | 'replace';
  overlay_positions: Record<string, OverlayPos>;
  callouts?: Array<{
    id: string;
    start_sec: number;
    duration_sec: number;
    target_x: number;
    target_y: number;
    box_x: number;
    box_y: number;
    box_w?: number;
    box_h?: number;
    text: string;
    title?: string;
    type: string;
    size: string;
    anchor: string;
    color?: string;
    theme: string;
    arrow_style: string;
    sticker_path?: string;
    sticker_scale?: number;
  }>;
}

function diskPathFromAssetUrl(value?: string): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith('asset://')) return value.startsWith('/') ? value : undefined;
  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return undefined;
  }
}

export function buildRenderPlan(args: {
  bins: BinItem[];
  clips: TimelineClip[];
  callouts: Callout[];
  overlayPos: Record<string, OverlayPos>;
  format: ProjectFormat;
  settings?: ProjectExportSettings | null;
  showHints?: boolean;
}): RenderPlan {
  const vertical = args.format === 'shorts';
  const settings = args.settings;
  const width = Math.max(2, settings?.width ?? (vertical ? 1080 : 1920));
  const height = Math.max(2, settings?.height ?? (vertical ? 1920 : 1080));
  const includeHints = (settings?.burnInHints ?? true) && args.showHints !== false;
  const byId = new Map(args.bins.map((bin) => [bin.id, bin]));

  return {
    width,
    height,
    fps: Math.max(10, Math.min(60, settings?.fps ?? 30)),
    audio_policy: settings?.audioPolicy ?? 'duck',
    overlay_positions: args.overlayPos,
    clips: args.clips.map((clip) => {
      const bin = clip.binId ? byId.get(clip.binId) : undefined;
      return {
        kind: clip.text ? 'text' : bin?.kind ?? 'video',
        track: clip.track,
        path: bin?.path ?? null,
        text: clip.text ?? null,
        start_sec: clip.startSec,
        duration_sec: clip.durationSec,
        source_in_sec: clip.sourceInSec,
        muted: Boolean(clip.muted),
        volume: Math.max(0, Math.min(2, clip.volume ?? 1)),
        effect: clip.effect ?? null,
      };
    }),
    callouts: includeHints && args.callouts.length
      ? args.callouts.map((hint) => ({
          id: hint.id,
          start_sec: hint.startSec,
          duration_sec: Math.max(0.4, hint.endSec - hint.startSec),
          target_x: hint.targetX,
          target_y: hint.targetY,
          box_x: hint.boxX,
          box_y: hint.boxY,
          box_w: hint.boxW,
          box_h: hint.boxH,
          text: hint.text,
          title: hint.title,
          type: hint.type,
          size: hint.size,
          anchor: hint.anchor,
          color: hint.color,
          theme: hint.theme,
          arrow_style: hint.arrowStyle,
          sticker_path: diskPathFromAssetUrl(hint.stickerUrl),
          sticker_scale: hint.stickerScale,
        }))
      : undefined,
  };
}
