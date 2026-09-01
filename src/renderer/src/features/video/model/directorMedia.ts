import { useEffect, useRef, useState } from 'react';

export function toAssetUrl(diskPath: string): string {
  const abs = diskPath.startsWith('/') ? diskPath : `/${diskPath}`;
  return `asset://${abs.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
}

export function mediaMime(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a') || lower.endsWith('.aac')) return 'audio/mp4';
  if (lower.endsWith('.flac')) return 'audio/flac';
  if (lower.endsWith('.ogg') || lower.endsWith('.oga')) return 'audio/ogg';
  if (lower.endsWith('.opus')) return 'audio/ogg';
  if (lower.endsWith('.aiff') || lower.endsWith('.aif')) return 'audio/aiff';
  if (lower.endsWith('.caf')) return 'audio/x-caf';
  return 'video/mp4';
}

export function probeMediaDuration(url: string, kind: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    el.preload = 'metadata';
    const finish = (sec: number) => {
      el.removeAttribute('src');
      el.load();
      resolve(sec);
    };
    el.onloadedmetadata = () => {
      const d = el.duration;
      finish(Number.isFinite(d) && d > 0 ? d : kind === 'audio' ? 8 : 12);
    };
    el.onerror = () => finish(kind === 'audio' ? 8 : 12);
    el.src = url;
  });
}

export function useFileBlobs(paths: string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const cache = useRef(new Map<string, string>());

  useEffect(() => {
    const needed = new Set(paths.filter(Boolean));
    let cancelled = false;

    for (const [path, url] of [...cache.current.entries()]) {
      if (!needed.has(path)) {
        URL.revokeObjectURL(url);
        cache.current.delete(path);
      }
    }

    const load = async () => {
      for (const path of needed) {
        if (cache.current.has(path) || !window.api?.readMediaFile) continue;
        try {
          const buf = await window.api.readMediaFile(path);
          if (cancelled) return;
          const url = URL.createObjectURL(new Blob([buf], { type: mediaMime(path) }));
          cache.current.set(path, url);
          setUrls(Object.fromEntries(cache.current));
        } catch {
          /* skip */
        }
      }
      if (!cancelled) setUrls(Object.fromEntries(cache.current));
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [paths.join('|')]);

  useEffect(() => () => {
    for (const url of cache.current.values()) URL.revokeObjectURL(url);
    cache.current.clear();
  }, []);

  return urls;
}
