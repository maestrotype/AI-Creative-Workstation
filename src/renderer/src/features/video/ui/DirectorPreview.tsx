import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { toAssetUrl } from '../model/directorMedia';
import {
  clipAtTime,
  DEFAULT_OVERLAY_POS,
  effectiveTrackLayout,
  mediaTimeForClip,
  type BinItem,
  type OverlayPos,
  type TimelineClip,
  type TrackLayout,
} from '../model/directorTimeline';
import styles from './VideoPage.module.css';

interface DirectorPreviewProps {
  playhead: number;
  playing: boolean;
  seekNonce: number;
  clips: TimelineClip[];
  bins: BinItem[];
  blobs: Record<string, string>;
  trackLayout: TrackLayout;
  overlayPos?: Record<string, OverlayPos>;
  onOverlayMove?: (track: string, pos: OverlayPos) => void;
  onDecodeFail: (binId: string) => void;
}

function binFor(clip: TimelineClip | null, bins: BinItem[]): BinItem | null {
  if (!clip?.binId) return null;
  return bins.find((b) => b.id === clip.binId) ?? null;
}

function playbackUrl(bin: BinItem | null, blobs: Record<string, string>): string | null {
  if (!bin) return null;
  if (bin.kind === 'image') return toAssetUrl(bin.path);
  return blobs[bin.path] ?? null;
}

export function DirectorPreview({
  playhead,
  playing,
  seekNonce,
  clips,
  bins,
  blobs,
  trackLayout,
  overlayPos = {},
  onOverlayMove,
  onDecodeFail,
}: DirectorPreviewProps): ReactNode {
  const { t } = useTranslation();
  const v1Ref = useRef<HTMLVideoElement>(null);
  const overlayRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;
  const [decodeError, setDecodeError] = useState<string | null>(null);

  const layout = useMemo(() => effectiveTrackLayout(clips, trackLayout), [clips, trackLayout]);

  const overlayTrackIds = useMemo(() => {
    const out: string[] = [];
    for (let i = 2; i <= layout.videos; i += 1) out.push(`v${i}`);
    return out;
  }, [layout.videos]);

  const audioTrackIds = useMemo(() => {
    const out: string[] = [];
    for (let i = 1; i <= layout.audios; i += 1) out.push(`a${i}`);
    return out;
  }, [layout.audios]);

  const v1 = clipAtTime(clips, 'v1', playhead);
  const overlayClips = overlayTrackIds.map((id) => ({ id, clip: clipAtTime(clips, id as `v${number}`, playhead) }));
  const liveOverlays = overlayClips.filter((o): o is { id: string; clip: TimelineClip } => Boolean(o.clip));
  const promoted = !v1 ? liveOverlays[0] ?? null : null;
  const mainClip = v1 ?? promoted?.clip ?? null;
  const v1Bin = binFor(mainClip, bins);
  const v1Url = playbackUrl(v1Bin, blobs);
  const v1Busy = Boolean(v1Bin?.proxying);
  const v1IsVideo = v1Bin?.kind === 'video' && Boolean(v1Url) && !v1Busy;
  const v1IsImage = v1Bin?.kind === 'image' && Boolean(v1Url);
  const pipOverlays = liveOverlays.filter((o) => o.id !== promoted?.id);
  const audioClips = audioTrackIds.map((id) => ({ id, clip: clipAtTime(clips, id as `a${number}`, playhead) }));
  const titleClips = clips
    .filter((c) => c.track.startsWith('t') && c.text && playhead >= c.startSec && playhead < c.startSec + c.durationSec);

  useEffect(() => {
    const attach = (
      el: HTMLMediaElement | null,
      url: string | null,
      clip: TimelineClip | null,
      shouldPlay: boolean,
      muted: boolean,
    ) => {
      if (!el) return;
      el.muted = muted;
      if (!url || !clip) {
        el.pause();
        return;
      }
      const mediaT = mediaTimeForClip(clip, playheadRef.current);
      const same = el.src === url || el.currentSrc === url;
      if (!same) el.src = url;
      const apply = () => {
        if (Math.abs(el.currentTime - mediaT) > 0.08) el.currentTime = mediaT;
        if (shouldPlay) void el.play().catch(() => undefined);
        else el.pause();
      };
      if (el.readyState >= 1 && same) apply();
      else el.addEventListener('loadeddata', apply, { once: true });
    };

    attach(v1Ref.current, v1IsVideo ? v1Url : null, v1IsVideo ? mainClip : null, playing, false);

    for (const { id, clip } of pipOverlays) {
      const bin = binFor(clip, bins);
      const url = playbackUrl(bin, blobs);
      const isVideo = bin?.kind === 'video' && Boolean(url) && !bin.proxying;
      attach(overlayRefs.current[id], isVideo ? url : null, isVideo ? clip : null, playing, true);
    }

    for (const { id, clip } of audioClips) {
      const bin = binFor(clip, bins);
      attach(audioRefs.current[id], playbackUrl(bin, blobs), clip, playing, false);
    }
  }, [
    mainClip?.id,
    v1Url,
    v1IsVideo,
    playing,
    seekNonce,
    bins,
    blobs,
    pipOverlays.map((o) => o.clip.id).join('|'),
    audioClips.map((a) => a.clip?.id).join('|'),
  ]);

  const hasAny = Boolean(v1 || overlayClips.some((o) => o.clip) || titleClips.length || audioClips.some((a) => a.clip));
  const waiting = Boolean(v1Bin?.proxying || (v1Bin?.kind === 'video' && !v1Url && !v1Bin.proxying));

  return (
    <div className={styles.stage}>
      <video
        ref={v1Ref}
        className={styles.stageMain}
        style={{ display: v1IsVideo ? 'block' : 'none' }}
        playsInline
        preload="auto"
        onError={() => {
          if (v1Bin && !v1Bin.proxying && !v1Bin.path.includes('preview-')) onDecodeFail(v1Bin.id);
          else setDecodeError(t('video.dir_decode_error'));
        }}
        onLoadedData={() => setDecodeError(null)}
      />
      {v1IsImage ? <img className={styles.stageMain} src={v1Url ?? ''} alt="" /> : null}

      {pipOverlays.map(({ id, clip }) => {
        const bin = binFor(clip, bins);
        const url = playbackUrl(bin, blobs);
        const isVideo = bin?.kind === 'video' && Boolean(url) && !bin?.proxying;
        const isImage = bin?.kind === 'image' && Boolean(url);
        if (!clip) return null;
        const custom = overlayPos[id];
        const pos = custom ?? DEFAULT_OVERLAY_POS[id] ?? DEFAULT_OVERLAY_POS.v2;
        return (
          <span
            key={id}
            className={`${styles.stagePip} ${custom ? '' : styles.stagePipBR}`}
            data-overlay-track={id}
            style={custom ? { left: `${pos.x}%`, top: `${pos.y}%` } : undefined}
            onPointerDown={(e) => {
              if (!onOverlayMove) return;
              e.preventDefault();
              e.stopPropagation();
              const host = e.currentTarget.parentElement;
              if (!host) return;
              const start = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
              const rect = host.getBoundingClientRect();
              const move = (ev: PointerEvent) => {
                const x = Math.min(86, Math.max(0, start.px + ((ev.clientX - start.x) / rect.width) * 100));
                const y = Math.min(78, Math.max(0, start.py + ((ev.clientY - start.y) / rect.height) * 100));
                onOverlayMove(id, { x, y });
              };
              const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }}
          >
            <i className={styles.pipBadge}>{id.toUpperCase()}</i>
            {isVideo ? (
              <video
                ref={(el) => { overlayRefs.current[id] = el; }}
                className={styles.stagePipMedia}
                playsInline
                muted
                preload="auto"
              />
            ) : null}
            {isImage ? <img className={styles.stagePipMedia} src={url ?? ''} alt="" /> : null}
          </span>
        );
      })}

      {titleClips.map((clip) => (
        <p key={clip.id} className={styles.stageCaption}>{clip.text}</p>
      ))}

      {audioTrackIds.map((id) => (
        <audio key={id} ref={(el) => { audioRefs.current[id] = el; }} preload="auto" />
      ))}

      {!hasAny ? (
        <div className={styles.stageEmpty}>
          <p>{t('video.dir_preview_empty')}</p>
        </div>
      ) : null}
      {waiting && !v1IsVideo && !v1IsImage ? (
        <div className={styles.stageEmpty}>
          <p>{t('video.dir_proxying')}</p>
        </div>
      ) : null}
      {decodeError && v1IsVideo ? (
        <div className={styles.stageEmpty}>
          <p>{decodeError}</p>
        </div>
      ) : null}
    </div>
  );
}
