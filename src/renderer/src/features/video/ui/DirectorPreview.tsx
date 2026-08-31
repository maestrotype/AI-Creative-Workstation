import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { toAssetUrl } from '../model/directorMedia';
import {
  clipAtTime,
  mediaTimeForClip,
  type BinItem,
  type TimelineClip,
} from '../model/directorTimeline';
import styles from './VideoPage.module.css';

interface DirectorPreviewProps {
  playhead: number;
  playing: boolean;
  seekNonce: number;
  clips: TimelineClip[];
  bins: BinItem[];
  blobs: Record<string, string>;
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
  onDecodeFail,
}: DirectorPreviewProps): ReactNode {
  const { t } = useTranslation();
  const v1Ref = useRef<HTMLVideoElement>(null);
  const v2Ref = useRef<HTMLVideoElement>(null);
  const a1Ref = useRef<HTMLAudioElement>(null);
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;
  const [decodeError, setDecodeError] = useState<string | null>(null);

  const v1 = clipAtTime(clips, 'v1', playhead);
  const v2 = clipAtTime(clips, 'v2', playhead);
  const a1 = clipAtTime(clips, 'a1', playhead);
  const t1 = clipAtTime(clips, 't1', playhead);
  const v1Bin = binFor(v1, bins);
  const v2Bin = binFor(v2, bins);
  const a1Bin = binFor(a1, bins);
  const v1Url = playbackUrl(v1Bin, blobs);
  const v2Url = playbackUrl(v2Bin, blobs);
  const a1Url = playbackUrl(a1Bin, blobs);
  const v1Busy = Boolean(v1Bin?.proxying);
  const v1IsVideo = v1Bin?.kind === 'video' && Boolean(v1Url) && !v1Busy;
  const v1IsImage = v1Bin?.kind === 'image' && Boolean(v1Url);
  const v2IsVideo = v2Bin?.kind === 'video' && Boolean(playbackUrl(v2Bin, blobs)) && !v2Bin.proxying;
  const v2IsImage = v2Bin?.kind === 'image' && Boolean(v2Url);

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
      const t = mediaTimeForClip(clip, playheadRef.current);
      const same = el.src === url || el.currentSrc === url;
      if (!same) el.src = url;
      const apply = () => {
        if (Math.abs(el.currentTime - t) > 0.15) el.currentTime = t;
        if (shouldPlay) void el.play().catch(() => undefined);
        else el.pause();
      };
      if (el.readyState >= 1 && same) apply();
      else el.addEventListener('loadeddata', apply, { once: true });
    };

    attach(v1Ref.current, v1IsVideo ? v1Url : null, v1IsVideo ? v1 : null, playing, false);
    attach(v2Ref.current, v2IsVideo ? v2Url : null, v2IsVideo ? v2 : null, playing, true);
    attach(a1Ref.current, a1Url, a1, playing, false);
  }, [v1?.id, v2?.id, a1?.id, v1Url, v2Url, a1Url, v1IsVideo, v2IsVideo, playing, seekNonce, v1, v2, a1]);

  const empty = !v1 && !v2 && !t1 && !a1;
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
      <video
        ref={v2Ref}
        className={styles.stagePip}
        style={{ display: v2IsVideo ? 'block' : 'none' }}
        playsInline
        muted
        preload="auto"
      />
      {v2IsImage ? <img className={styles.stagePip} src={v2Url ?? ''} alt="" /> : null}
      {t1?.text ? <p className={styles.stageCaption}>{t1.text}</p> : null}
      <audio ref={a1Ref} preload="auto" />
      {empty ? (
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
