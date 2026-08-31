import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { probeMediaDuration, useFileBlobs } from '../model/directorMedia';
import {
  allowedTracksForClip,
  clipAtTime,
  clipSpan,
  endOfTrack,
  fileName,
  newId,
  timelineLength,
  type BinItem,
  type DirectorSeed,
  type TimelineClip,
  type TrackId,
} from '../model/directorTimeline';

const LABEL_W = 96;

interface DragState {
  id: string;
  mode: 'move' | 'in' | 'out';
  startX: number;
  origStart: number;
  origDur: number;
  origSourceIn: number;
  moved: boolean;
}

interface DirectorProviderProps {
  seed: DirectorSeed | null;
  children: ReactNode;
}

const DirectorContext = createContext<DirectorSnap | null>(null);

export function useDirector(): DirectorSnap {
  const value = useContext(DirectorContext);
  if (!value) throw new Error('DirectorProvider required');
  return value;
}

type DirectorSnap = {
  t: (key: string, opts?: Record<string, string | number>) => string;
  seed: DirectorSeed | null;
  bins: BinItem[];
  clips: TimelineClip[];
  selectedBin: string | null;
  selectedClip: string | null;
  playhead: number;
  playing: boolean;
  seekNonce: number;
  pxPerSec: number;
  setPxPerSec: (n: number) => void;
  captionDraft: string;
  setCaptionDraft: (v: string) => void;
  proxyError: string | null;
  blobs: Record<string, string>;
  activeBin: BinItem | null;
  activeClip: TimelineClip | null;
  total: number;
  lanesPx: number;
  ticks: number[];
  boardScrollRef: React.RefObject<HTMLDivElement | null>;
  live: { v1?: string; v2?: string; a1?: string; t1?: string };
  seekTo: (sec: number) => void;
  togglePlay: () => void;
  seekFromEvent: (e: MouseEvent<HTMLElement>) => void;
  pickVideo: () => void;
  pickImage: () => void;
  pickAudio: () => void;
  removeBin: (id: string) => void;
  setSelectedBin: (id: string | null) => void;
  setSelectedClip: (id: string | null) => void;
  patchBin: (id: string, patch: Partial<BinItem>) => void;
  placeOnTrack: (track: TrackId) => void;
  addCaption: () => void;
  removeClip: (id: string) => void;
  clearTrack: (track: TrackId) => void;
  onClipPointerDown: (e: PointerEvent<HTMLElement>, clip: TimelineClip, mode: DragState['mode']) => void;
  onClipPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onClipPointerUp: (e: PointerEvent<HTMLElement>, clip: TimelineClip) => void;
  applyProxy: (binId: string, force: boolean) => void;
};

export function DirectorProvider({ seed, children }: DirectorProviderProps): ReactNode {
  const { t } = useTranslation();
  const [bins, setBins] = useState<BinItem[]>(() => binsFromSeed(seed));
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [selectedBin, setSelectedBin] = useState<string | null>(null);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [seekNonce, setSeekNonce] = useState(0);
  const [pxPerSec, setPxPerSec] = useState(16);
  const [captionDraft, setCaptionDraft] = useState('');
  const originRef = useRef({ wall: 0, head: 0 });
  const playheadRef = useRef(0);
  const totalRef = useRef(8);
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const binsRef = useRef(bins);
  binsRef.current = bins;
  const pxRef = useRef(pxPerSec);
  pxRef.current = pxPerSec;
  const proxyBusy = useRef(new Set<string>());
  const proxyChecked = useRef(new Set<string>());
  const [proxyError, setProxyError] = useState<string | null>(null);
  const blobs = useFileBlobs(bins.filter((b) => b.kind !== 'image' && !b.proxying).map((b) => b.path));

  useEffect(() => {
    setBins(binsFromSeed(seed));
    setClips([]);
    setSelectedBin(null);
    setSelectedClip(null);
    setPlayhead(0);
    setPlaying(false);
  }, [seed]);

  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);

  const activeBin = bins.find((b) => b.id === selectedBin) ?? null;
  const activeClip = clips.find((c) => c.id === selectedClip) ?? null;
  const total = timelineLength(clips, 8);
  totalRef.current = total;
  const lanesPx = Math.max(480, total * pxPerSec);
  const ticks = useMemo(() => {
    const step = total > 90 ? 10 : 5;
    const out: number[] = [];
    for (let s = 0; s <= total + 0.01; s += step) out.push(s);
    return out;
  }, [total]);

  useEffect(() => {
    for (const bin of bins) {
      if (bin.kind === 'image' || bin.durationKnown || bin.proxying) continue;
      const url = blobs[bin.path];
      if (!url) continue;
      const kind = bin.kind === 'audio' ? 'audio' : 'video';
      void probeMediaDuration(url, kind).then((durationSec) => {
        setBins((prev) => prev.map((item) => {
          if (item.id !== bin.id || item.durationKnown) return item;
          const keepOut = item.outSec !== item.durationSec;
          return {
            ...item,
            durationSec,
            outSec: keepOut ? Math.min(item.outSec, durationSec) : durationSec,
            durationKnown: true,
          };
        }));
      });
    }
  }, [bins, blobs]);

  useEffect(() => {
    if (!playing) return undefined;
    originRef.current = { wall: performance.now(), head: playheadRef.current };
    let raf = 0;
    const tick = (now: number) => {
      const next = originRef.current.head + (now - originRef.current.wall) / 1000;
      if (next >= totalRef.current) {
        playheadRef.current = totalRef.current;
        setPlayhead(totalRef.current);
        setPlaying(false);
        return;
      }
      playheadRef.current = next;
      setPlayhead(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    const scroller = boardScrollRef.current;
    if (!scroller || !playing) return;
    const x = LABEL_W + playhead * pxPerSec;
    const viewLeft = scroller.scrollLeft + LABEL_W;
    const viewRight = scroller.scrollLeft + scroller.clientWidth - 24;
    if (x > viewRight) scroller.scrollLeft = x - scroller.clientWidth + 48;
    else if (x < viewLeft) scroller.scrollLeft = Math.max(0, x - LABEL_W - 16);
  }, [playhead, playing, pxPerSec]);

  const seekTo = (sec: number) => {
    const next = Math.max(0, Math.min(totalRef.current, sec));
    playheadRef.current = next;
    originRef.current = { wall: performance.now(), head: next };
    setPlayhead(next);
    setSeekNonce((n) => n + 1);
  };

  const togglePlay = () => {
    if (clipsRef.current.length === 0) return;
    if (playheadRef.current >= totalRef.current - 0.05) {
      playheadRef.current = 0;
      setPlayhead(0);
      setSeekNonce((n) => n + 1);
    }
    setPlaying((on) => !on);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
        return;
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedClip) {
        e.preventDefault();
        removeClip(selectedClip);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const applyProxy = async (binId: string, force: boolean) => {
    const bin = binsRef.current.find((item) => item.id === binId);
    if (!bin || bin.kind !== 'video' || !window.api?.ensureVideoPreview) return;
    if (!force && proxyChecked.current.has(bin.path)) return;
    if (proxyBusy.current.has(binId)) return;
    proxyBusy.current.add(binId);
    setBins((prev) => prev.map((item) => (item.id === binId ? { ...item, proxying: true } : item)));
    try {
      const res = await window.api.ensureVideoPreview(bin.path, force);
      proxyChecked.current.add(bin.path);
      proxyChecked.current.add(res.path);
      setProxyError(null);
      setBins((prev) => prev.map((item) => (
        item.id === binId
          ? { ...item, path: res.path, proxying: false, durationKnown: res.transcoded ? false : item.durationKnown }
          : item
      )));
      if (res.transcoded) setSeekNonce((n) => n + 1);
    } catch (err: unknown) {
      setBins((prev) => prev.map((item) => (item.id === binId ? { ...item, proxying: false } : item)));
      setProxyError(err instanceof Error ? err.message : t('video.dir_proxy_fail'));
    } finally {
      proxyBusy.current.delete(binId);
    }
  };

  useEffect(() => {
    for (const bin of bins) {
      if (bin.kind === 'video') void applyProxy(bin.id, false);
    }
  }, [bins.map((b) => `${b.id}:${b.path}`).join('|')]);

  const addBin = (kind: BinItem['kind'], path: string, durationSec: number) => {
    const item: BinItem = {
      id: newId('bin'),
      kind,
      path,
      name: fileName(path),
      durationSec,
      inSec: 0,
      outSec: durationSec,
    };
    setBins((prev) => [...prev, item]);
    setSelectedBin(item.id);
  };

  const pickVideo = async () => {
    const path = await window.api?.pickVideo?.();
    if (path) addBin('video', path, 12);
  };

  const pickImage = async () => {
    const path = await window.api?.pickImage?.();
    if (path) addBin('image', path, 4);
  };

  const pickAudio = async () => {
    const path = await window.api?.pickAudio?.();
    if (path) addBin('audio', path, 8);
  };

  const patchBin = (id: string, patch: Partial<BinItem>) => {
    setBins((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const removeBin = (id: string) => {
    setBins((prev) => prev.filter((b) => b.id !== id));
    setClips((prev) => prev.filter((c) => c.binId !== id));
    if (selectedBin === id) setSelectedBin(null);
  };

  const placeOnTrack = (track: TrackId) => {
    if (!activeBin) return;
    if (track === 'a1' && activeBin.kind !== 'audio') return;
    if (track !== 'a1' && activeBin.kind === 'audio') return;
    const duration = clipSpan(activeBin);
    const start = playhead > 0.05 ? playhead : endOfTrack(clips, track);
    const clip: TimelineClip = {
      id: newId('clip'),
      binId: activeBin.id,
      track,
      startSec: start,
      durationSec: duration,
      sourceInSec: activeBin.inSec,
      label: activeBin.name,
    };
    setClips((prev) => [...prev, clip]);
    setSelectedClip(clip.id);
    if (playhead <= 0.05) seekTo(start);
  };

  const addCaption = () => {
    const text = captionDraft.trim();
    if (!text) return;
    const clip: TimelineClip = {
      id: newId('cap'),
      binId: null,
      track: 't1',
      startSec: playhead,
      durationSec: 3,
      sourceInSec: 0,
      label: text.slice(0, 28),
      text,
    };
    setClips((prev) => [...prev, clip]);
    setCaptionDraft('');
    setSelectedClip(clip.id);
  };

  const removeClip = (id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id));
    if (selectedClip === id) setSelectedClip(null);
  };

  const clearTrack = (track: TrackId) => {
    setClips((prev) => prev.filter((c) => c.track !== track));
    if (activeClip?.track === track) setSelectedClip(null);
  };

  const patchClip = (id: string, patch: Partial<TimelineClip>) => {
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const seekFromEvent = (e: MouseEvent<HTMLElement>) => {
    if (dragRef.current?.moved) return;
    const rect = e.currentTarget.getBoundingClientRect();
    seekTo((e.clientX - rect.left) / pxPerSec);
  };

  const onClipPointerDown = (e: PointerEvent<HTMLElement>, clip: TimelineClip, mode: DragState['mode']) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedClip(clip.id);
    dragRef.current = {
      id: clip.id,
      mode,
      startX: e.clientX,
      origStart: clip.startSec,
      origDur: clip.durationSec,
      origSourceIn: clip.sourceInSec,
      moved: false,
    };
    const host = (e.currentTarget as HTMLElement).closest('[data-clip]') as HTMLElement | null;
    (host ?? e.currentTarget).setPointerCapture(e.pointerId);
  };

  const onClipPointerMove = (e: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dt = (e.clientX - drag.startX) / pxRef.current;
    if (Math.abs(e.clientX - drag.startX) > 4) drag.moved = true;
    const clip = clipsRef.current.find((c) => c.id === drag.id);
    if (!clip) return;

    if (drag.mode === 'move') {
      const startSec = Math.max(0, drag.origStart + dt);
      let track = clip.track;
      const lane = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-track-lane]') as HTMLElement | null;
      const nextTrack = lane?.dataset.trackLane as TrackId | undefined;
      if (nextTrack && allowedTracksForClip(clip, binsRef.current).includes(nextTrack)) {
        track = nextTrack;
      }
      patchClip(drag.id, { startSec, track });
      return;
    }

    if (drag.mode === 'out') {
      patchClip(drag.id, { durationSec: Math.max(0.4, drag.origDur + dt) });
      return;
    }

    const shift = Math.min(drag.origDur - 0.4, Math.max(-drag.origSourceIn, dt));
    patchClip(drag.id, {
      startSec: Math.max(0, drag.origStart + shift),
      durationSec: drag.origDur - shift,
      sourceInSec: drag.origSourceIn + shift,
    });
  };

  const onClipPointerUp = (e: PointerEvent<HTMLElement>, clip: TimelineClip) => {
    const drag = dragRef.current;
    if (drag && !drag.moved) seekTo(clip.startSec);
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  const live = {
    v1: clipAtTime(clips, 'v1', playhead)?.id,
    v2: clipAtTime(clips, 'v2', playhead)?.id,
    a1: clipAtTime(clips, 'a1', playhead)?.id,
    t1: clipAtTime(clips, 't1', playhead)?.id,
  };

  const snap: DirectorSnap = {
    t: t as DirectorSnap['t'],
    seed,
    bins,
    clips,
    selectedBin,
    selectedClip,
    playhead,
    playing,
    seekNonce,
    pxPerSec,
    setPxPerSec,
    captionDraft,
    setCaptionDraft,
    proxyError,
    blobs,
    activeBin,
    activeClip,
    total,
    lanesPx,
    ticks,
    boardScrollRef,
    live,
    seekTo,
    togglePlay,
    seekFromEvent,
    pickVideo: () => { void pickVideo(); },
    pickImage: () => { void pickImage(); },
    pickAudio: () => { void pickAudio(); },
    removeBin,
    setSelectedBin,
    setSelectedClip,
    patchBin,
    placeOnTrack,
    addCaption,
    removeClip,
    clearTrack,
    onClipPointerDown,
    onClipPointerMove,
    onClipPointerUp,
    applyProxy: (binId, force) => { void applyProxy(binId, force); },
  };

  return <DirectorContext.Provider value={snap}>{children}</DirectorContext.Provider>;
}
function binsFromSeed(seed: DirectorSeed | null): BinItem[] {
  if (!seed) return [];
  return seed.bins.map((b) => ({
    id: newId('bin'),
    kind: b.kind,
    path: b.path,
    name: b.name,
    durationSec: b.durationSec,
    inSec: 0,
    outSec: b.durationSec,
    durationKnown: b.kind === 'image',
  }));
}
