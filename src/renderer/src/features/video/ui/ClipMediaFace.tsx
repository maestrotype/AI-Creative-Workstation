import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { toAssetUrl } from '../model/directorMedia';
import type { BinItem, TimelineClip } from '../model/directorTimeline';
import type { FilmShot } from '../../projects/model/project';
import { clipDisplayName } from '../model/clipDisplayName';
import s from './ClipMediaFace.module.css';

const filmstripCache = new Map<string, string[]>();

function filmstripKey(path: string, sourceIn: number, durationSec: number, count: number): string {
  return `${path}|${sourceIn.toFixed(2)}|${durationSec.toFixed(2)}|${count}`;
}

async function captureFilmstrip(
  url: string,
  sourceIn: number,
  durationSec: number,
  count: number,
): Promise<string[]> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onErr);
      resolve();
    };
    const onErr = () => {
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onErr);
      reject(new Error('video load failed'));
    };
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('error', onErr);
  });

  const mediaDur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : durationSec;
  const span = Math.max(0.05, Math.min(durationSec, mediaDur - sourceIn));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  const frames: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = sourceIn + (count === 1 ? span * 0.5 : (span * i) / Math.max(1, count - 1));
    const seekTo = Math.min(Math.max(0, t), Math.max(0, mediaDur - 0.04));
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = seekTo;
    });
    const w = Math.max(48, Math.min(160, video.videoWidth || 160));
    const h = Math.max(28, Math.round(w * ((video.videoHeight || 90) / (video.videoWidth || 160))));
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    frames.push(canvas.toDataURL('image/jpeg', 0.62));
  }

  video.removeAttribute('src');
  video.load();
  return frames;
}

function useFilmstrip(
  url: string | null,
  path: string | null,
  sourceIn: number,
  durationSec: number,
  widthPx: number,
): string[] {
  const count = Math.max(1, Math.min(8, Math.floor(widthPx / 56)));
  const key = path ? filmstripKey(path, sourceIn, durationSec, count) : '';
  const [frames, setFrames] = useState<string[]>(() => (key ? filmstripCache.get(key) ?? [] : []));

  useEffect(() => {
    if (!url || !path || !key) {
      setFrames([]);
      return undefined;
    }
    const cached = filmstripCache.get(key);
    if (cached) {
      setFrames(cached);
      return undefined;
    }
    let cancelled = false;
    void captureFilmstrip(url, sourceIn, durationSec, count)
      .then((next) => {
        if (cancelled || next.length === 0) return;
        filmstripCache.set(key, next);
        setFrames(next);
      })
      .catch(() => {
        if (!cancelled) setFrames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [url, path, key, sourceIn, durationSec, count]);

  return frames;
}

export function ClipMediaFace({
  clip,
  bin,
  shot,
  mediaUrl,
  widthPx,
  tone,
  origin,
  sequenceIndex,
}: {
  clip: TimelineClip;
  bin: BinItem | null;
  shot?: FilmShot | null;
  mediaUrl: string | null;
  widthPx: number;
  tone: 'video' | 'still' | 'audio';
  origin: 'ai' | 'original' | null;
  sequenceIndex?: number;
}): ReactNode {
  const title = clipDisplayName(clip, bin, shot ?? null, sequenceIndex);
  const imageSrc = useMemo(() => {
    if (!bin || bin.kind !== 'image' || !bin.path) return null;
    return toAssetUrl(bin.path);
  }, [bin]);

  const videoUrl = bin?.kind === 'video' ? mediaUrl : null;
  const frames = useFilmstrip(
    videoUrl,
    bin?.kind === 'video' ? bin.path : null,
    clip.sourceInSec,
    clip.durationSec,
    widthPx,
  );

  if (tone === 'still') {
    return (
      <div className={s.face} data-tone="still">
        {imageSrc ? <img className={s.still} src={imageSrc} alt="" draggable={false} /> : <div className={s.stillFallback} />}
        <div className={s.scrim} />
        <div className={s.meta}>
          <span className={s.label}>{title}</span>
          {origin ? <span className={s.badge}>{origin === 'ai' ? 'AI' : 'Orig'}</span> : null}
        </div>
      </div>
    );
  }

  if (tone === 'audio') {
    return (
      <div className={s.face} data-tone="audio">
        <div className={s.audioBody} aria-hidden>
          <span className={s.audioStripe} />
          <span className={s.audioStripe} />
          <span className={s.audioStripe} />
        </div>
        <div className={s.meta}>
          <span className={s.label}>{title}</span>
          {origin ? <span className={s.badge}>{origin === 'ai' ? 'AI' : 'Orig'}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={s.face} data-tone="video">
      {frames.length > 0 ? (
        <div className={s.filmstrip}>
          {frames.map((src, i) => (
            <img key={`${i}-${src.slice(-12)}`} className={s.frame} src={src} alt="" draggable={false} />
          ))}
        </div>
      ) : (
        <div className={s.videoFallback} />
      )}
      <div className={s.scrim} />
      <div className={s.meta}>
        <span className={s.label}>{title}</span>
        {origin ? <span className={s.badge}>{origin === 'ai' ? 'AI' : 'Orig'}</span> : null}
      </div>
    </div>
  );
}
