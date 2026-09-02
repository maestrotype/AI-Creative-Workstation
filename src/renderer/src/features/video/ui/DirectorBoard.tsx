import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { probeMediaDuration, useFileBlobs } from '../model/directorMedia';
import {
  allowedTracksForClip,
  buildTrackList,
  canRemoveEmptyTrack,
  clipAtTime,
  clipSpan,
  defaultTrackForKind,
  effectiveTrackLayout,
  ensureTrackVisible,
  isAudioTrack,
  isVideoTrack,
  endOfTrack,
  fileName,
  formatClock,
  kindFromFileName,
  newId,
  placementStart,
  avoidOverlap,
  packAllGaps,
  snapStart,
  trackHasGap,
  maxDurationBeforeNext,
  syncClipDuration,
  timelineLength,
  trackIndex,
  unstackAllTracks,
  type BinItem,
  type BinKind,
  type OverlayPos,
  type TimelineClip,
  type TrackDef,
  type TrackId,
  type TrackLayout,
} from '../model/directorTimeline';
import { DEFAULT_TRACK_LAYOUT } from '../model/directorTimeline';
import { loadDirectorSession, saveDirectorSession } from '../model/directorSessionStore';
import {
  emptyVoiceoverSession,
  resolveVoiceoverSource,
  type VoiceoverSession,
  type VoiceoverSource,
} from '../model/voiceoverSession';
import type { VideoAnalysisContext } from '../model/videoAnalysis';

const LABEL_W = 118;

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
  bins: BinItem[];
  clips: TimelineClip[];
  selectedBin: string | null;
  selectedClip: string | null;
  playhead: number;
  playing: boolean;
  seekNonce: number;
  pxPerSec: number;
  minPxPerSec: number;
  maxPxPerSec: number;
  fitTimeline: () => void;
  setViewW: (n: number) => void;
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
  tracks: TrackDef[];
  trackLayout: TrackLayout;
  visibleLayout: TrackLayout;
  addVideoOverlayTrack: () => void;
  removeEmptyTrack: (track: TrackId) => void;
  boardScrollRef: React.RefObject<HTMLDivElement | null>;
  playheadElRef: React.RefObject<HTMLDivElement | null>;
  clockElRef: React.RefObject<HTMLSpanElement | null>;
  live: Record<string, string | undefined>;
  seekTo: (sec: number) => void;
  togglePlay: () => void;
  seekFromEvent: (e: MouseEvent<HTMLElement>) => void;
  onRulerPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onRulerPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onRulerPointerUp: (e: PointerEvent<HTMLElement>) => void;
  pickVideo: () => void;
  pickImage: () => void;
  pickAudio: () => void;
  removeBin: (id: string) => void;
  setSelectedBin: (id: string | null) => void;
  setSelectedClip: (id: string | null) => void;
  patchBin: (id: string, patch: Partial<BinItem>) => void;
  placeOnTrack: (track: TrackId, binId?: string | null, startSec?: number) => void;
  ingestDropped: (files: FileList | File[], opts?: { track?: TrackId; startSec?: number; binOnly?: boolean }) => void;
  dropActive: boolean;
  setDropActive: (on: boolean) => void;
  addCaption: () => void;
  removeClip: (id: string) => void;
  clearTrack: (track: TrackId) => void;
  onClipPointerDown: (e: PointerEvent<HTMLElement>, clip: TimelineClip, mode: DragState['mode']) => void;
  onClipPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onClipPointerUp: (e: PointerEvent<HTMLElement>, clip: TimelineClip) => void;
  applyProxy: (binId: string, force: boolean) => void;
  addSources: (items: SourceInput[], autoPlace?: boolean) => void;
  hasTimelineGaps: boolean;
  packGaps: () => void;
  voiceRecording: boolean;
  voiceBusy: boolean;
  voiceError: string | null;
  voiceLine: string;
  setVoiceLine: (v: string) => void;
  voiceFixPrompt: string;
  setVoiceFixPrompt: (v: string) => void;
  applyVoiceFix: () => void;
  ttsReady: boolean;
  libraryAudio: Array<{ path: string; name: string }>;
  toggleVoiceRecord: () => void;
  generateVoiceover: () => void;
  placeLibraryAudio: (path: string) => void;
  overlayPos: Record<string, OverlayPos>;
  setOverlayPos: (track: string, pos: OverlayPos) => void;
  exportBusy: boolean;
  exportPath: string | null;
  exportError: string | null;
  exportSavedTo: string | null;
  exportVideo: () => void;
  saveExportAs: () => void;
  discardExport: () => void;
  voiceover: VoiceoverSession;
  voiceoverSource: VoiceoverSource | null;
  voiceoverBusy: boolean;
  voiceoverError: string | null;
  voiceoverProgress: { stage: string; percent: number; detail: string };
  setVoiceoverExpanded: (expanded: boolean) => void;
  openVoiceover: () => void;
  analyzeVoiceover: () => void;
};

export interface SourceInput {
  kind: BinKind;
  path: string;
  name?: string;
  durationSec?: number;
}

const SESSION_BOOT = loadDirectorSession();

function ipcMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const cleaned = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').trim();
  return cleaned || fallback;
}

export function DirectorProvider({ children }: DirectorProviderProps): ReactNode {
  const { t } = useTranslation();
  const [bins, setBins] = useState<BinItem[]>(() => SESSION_BOOT?.bins ?? []);
  const [clips, setClips] = useState<TimelineClip[]>(() => unstackAllTracks(SESSION_BOOT?.clips ?? []));
  const [selectedBin, setSelectedBin] = useState<string | null>(() => SESSION_BOOT?.selectedBin ?? null);
  const [selectedClip, setSelectedClip] = useState<string | null>(() => SESSION_BOOT?.selectedClip ?? null);
  const [playhead, setPlayhead] = useState(() => SESSION_BOOT?.playhead ?? 0);
  const [playing, setPlaying] = useState(false);
  const [seekNonce, setSeekNonce] = useState(0);
  const [pxPerSec, setPxPerSec] = useState(() => SESSION_BOOT?.pxPerSec ?? 16);
  const [trackLayout, setTrackLayout] = useState<TrackLayout>(
    () => SESSION_BOOT?.trackLayout ?? DEFAULT_TRACK_LAYOUT,
  );
  const [captionDraft, setCaptionDraft] = useState(() => SESSION_BOOT?.captionDraft ?? '');
  const [overlayPos, setOverlayPosState] = useState<Record<string, OverlayPos>>(
    () => SESSION_BOOT?.overlayPos ?? {},
  );
  const [viewW, setViewW] = useState(640);
  const fittedOnce = useRef(false);
  const lastFitRef = useRef(16);
  const originRef = useRef({ wall: 0, head: 0 });
  const playheadRef = useRef(0);
  const totalRef = useRef(8);
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const playheadElRef = useRef<HTMLDivElement>(null);
  const clockElRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const scrubbingRef = useRef(false);
  const liveKeyRef = useRef('');
  const lastReactRef = useRef(0);
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const binsRef = useRef(bins);
  binsRef.current = bins;
  const pxRef = useRef(pxPerSec);
  pxRef.current = pxPerSec;
  const trackLayoutRef = useRef(trackLayout);
  trackLayoutRef.current = trackLayout;
  const proxyBusy = useRef(new Set<string>());
  const proxyChecked = useRef(new Set<string>());
  const [proxyError, setProxyError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSavedTo, setExportSavedTo] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceLine, setVoiceLine] = useState('');
  const [voiceFixPrompt, setVoiceFixPrompt] = useState('');
  const [voiceover, setVoiceover] = useState<VoiceoverSession>(
    () => ({
      ...emptyVoiceoverSession(),
      ...(SESSION_BOOT?.voiceover ?? {}),
      analysis: null,
    }),
  );
  const [voiceoverBusy, setVoiceoverBusy] = useState(false);
  const [voiceoverError, setVoiceoverError] = useState<string | null>(null);
  const [voiceoverProgress, setVoiceoverProgress] = useState({ stage: 'idle', percent: 0, detail: '' });
  const voiceoverPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [ttsReady, setTtsReady] = useState(false);
  const [libraryAudio, setLibraryAudio] = useState<Array<{ path: string; name: string }>>([]);
  const blobs = useFileBlobs(bins.filter((b) => b.kind !== 'image' && !b.proxying).map((b) => b.path));

  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);

  useEffect(() => {
    paintPlayhead(playheadRef.current);
  }, []);

  const paintPlayhead = (sec: number) => {
    const next = Math.max(0, Math.min(totalRef.current, sec));
    playheadRef.current = next;
    const el = playheadElRef.current;
    if (el) el.style.transform = `translate3d(${LABEL_W + next * pxRef.current}px,0,0)`;
    if (clockElRef.current) {
      clockElRef.current.textContent = `${formatClock(next)} / ${formatClock(totalRef.current)}`;
    }
    return next;
  };

  const pushPlayheadReact = (sec: number, force: boolean) => {
    const list = clipsRef.current;
    const layout = effectiveTrackLayout(list, trackLayoutRef.current);
    const key = buildTrackList(layout).map(({ id }) => clipAtTime(list, id, sec)?.id).join('|');
    const now = performance.now();
    if (!force && key === liveKeyRef.current) return;
    liveKeyRef.current = key;
    lastReactRef.current = now;
    setPlayhead(sec);
  };

  const activeBin = bins.find((b) => b.id === selectedBin) ?? null;
  const activeClip = clips.find((c) => c.id === selectedClip) ?? null;

  const voiceoverSource = useMemo(
    () => resolveVoiceoverSource(bins, clips, selectedBin, selectedClip),
    [bins, clips, selectedBin, selectedClip],
  );

  useEffect(() => {
    const path = voiceover.sourcePath;
    if (!path || voiceover.analysis || !window.api?.getVideoAnalyzeCache) return;
    void window.api.getVideoAnalyzeCache(path).then((cached) => {
      if (cached.status === 'hit' && cached.context) {
        setVoiceover((prev) => ({
          ...prev,
          analysis: cached.context as unknown as VideoAnalysisContext,
          status: 'analyzed',
        }));
      }
    }).catch(() => {
      /* ignore */
    });
  }, [voiceover.sourcePath, voiceover.analysis]);

  useEffect(() => () => {
    if (voiceoverPollRef.current) clearInterval(voiceoverPollRef.current);
  }, []);

  const effectiveLayout = useMemo(
    () => effectiveTrackLayout(clips, trackLayout),
    [clips, trackLayout],
  );
  const tracks = useMemo(() => buildTrackList(effectiveLayout), [effectiveLayout]);
  const total = timelineLength(clips, 8);
  totalRef.current = total;
  const fitPxPerSec = Math.max(1.2, (Math.max(viewW, 240) - LABEL_W - 20) / Math.max(total, 1));
  const minPxPerSec = fitPxPerSec;
  const maxPxPerSec = Math.max(48, fitPxPerSec * 12);
  const lanesPx = Math.max(viewW - LABEL_W, total * pxPerSec);
  const ticks = useMemo(() => {
    const step = total > 180 ? 30 : total > 90 ? 10 : 5;
    const out: number[] = [];
    for (let s = 0; s <= total + 0.01; s += step) out.push(s);
    return out;
  }, [total]);

  const fitTimeline = () => {
    const next = Math.min(maxPxPerSec, Math.max(minPxPerSec, fitPxPerSec));
    lastFitRef.current = next;
    setPxPerSec(next);
  };

  useEffect(() => {
    if (viewW < 200) return;
    const fit = Math.max(1.2, (viewW - LABEL_W - 20) / Math.max(total, 1));
    const wasFit = !fittedOnce.current || Math.abs(pxRef.current - lastFitRef.current) < 0.6;
    lastFitRef.current = fit;
    const cap = Math.max(48, fit * 12);
    if (wasFit) {
      fittedOnce.current = true;
      setPxPerSec(fit);
      return;
    }
    setPxPerSec((prev) => Math.min(Math.max(prev, fit), cap));
  }, [viewW, total]);

  useEffect(() => {
    paintPlayhead(playheadRef.current);
  }, [pxPerSec, total]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveDirectorSession({
        savedAt: Date.now(),
        bins,
        clips,
        playhead,
        selectedBin,
        selectedClip,
        captionDraft,
        pxPerSec,
        trackLayout,
        overlayPos,
        voiceover: { ...voiceover, analysis: null },
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [bins, clips, playhead, selectedBin, selectedClip, captionDraft, pxPerSec, trackLayout, overlayPos, voiceover]);

  useEffect(() => {
    setClips((prev) => {
      let changed = false;
      const next = prev.map((clip) => {
        const bin = bins.find((b) => b.id === clip.binId);
        if (!bin) return clip;
        const synced = syncClipDuration(clip, bin);
        if (synced.durationSec !== clip.durationSec || synced.sourceInSec !== clip.sourceInSec) changed = true;
        return synced;
      });
      return changed ? next : prev;
    });
  }, [bins]);

  useEffect(() => {
    for (const bin of bins) {
      if (bin.kind === 'image' || bin.durationKnown || bin.proxying) continue;
      const url = blobs[bin.path];
      if (!url) continue;
      const kind = bin.kind === 'audio' ? 'audio' : 'video';
      void probeMediaDuration(url, kind).then((durationSec) => {
        setBins((prev) => {
          const nextBins = prev.map((item) => {
            if (item.id !== bin.id || item.durationKnown) return item;
            const keepOut = item.outSec !== item.durationSec;
            return {
              ...item,
              durationSec,
              outSec: keepOut ? Math.min(item.outSec, durationSec) : durationSec,
              durationKnown: true,
            };
          });
          const updated = nextBins.find((item) => item.id === bin.id);
          if (updated) {
            setClips((clipList) => clipList.map((clip) => (
              clip.binId === bin.id ? syncClipDuration(clip, updated) : clip
            )));
          }
          return nextBins;
        });
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
        paintPlayhead(totalRef.current);
        pushPlayheadReact(totalRef.current, true);
        setPlaying(false);
        return;
      }
      paintPlayhead(next);
      pushPlayheadReact(next, false);
      const scroller = boardScrollRef.current;
      if (scroller) {
        const x = LABEL_W + next * pxRef.current;
        const viewRight = scroller.scrollLeft + scroller.clientWidth - 24;
        if (x > viewRight) scroller.scrollLeft = x - scroller.clientWidth + 48;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seekTo = (sec: number) => {
    const next = paintPlayhead(sec);
    originRef.current = { wall: performance.now(), head: next };
    pushPlayheadReact(next, true);
    setSeekNonce((n) => n + 1);
  };

  const togglePlay = () => {
    if (clipsRef.current.length === 0) return;
    if (playheadRef.current >= totalRef.current - 0.05) {
      paintPlayhead(0);
      pushPlayheadReact(0, true);
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
      await window.api.rememberDroppedMedia?.(bin.path);
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
      proxyChecked.current.add(bin.path);
      setBins((prev) => prev.map((item) => (item.id === binId ? { ...item, proxying: false } : item)));
      const raw = err instanceof Error ? err.message : t('video.dir_proxy_fail');
      setProxyError(raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, ''));
    } finally {
      proxyBusy.current.delete(binId);
    }
  };

  useEffect(() => {
    for (const bin of bins) {
      if (bin.path) void window.api?.rememberDroppedMedia?.(bin.path);
    }
    for (const bin of bins) {
      if (bin.kind === 'video') void applyProxy(bin.id, false);
    }
  }, [bins.map((b) => `${b.id}:${b.path}`).join('|')]);

  const addBin = (
    kind: BinItem['kind'],
    path: string,
    durationSec: number,
    place?: TrackId | null,
    durationKnown = false,
  ) => {
    const item: BinItem = {
      id: newId('bin'),
      kind,
      path,
      name: fileName(path),
      durationSec,
      inSec: 0,
      outSec: durationSec,
      durationKnown: durationKnown || kind === 'image',
    };
    setBins((prev) => [...prev, item]);
    setSelectedBin(item.id);
    const target = place === undefined ? defaultTrackForKind(kind) : place;
    if (!target) return;
    setTrackLayout((layout) => ensureTrackVisible(layout, target));
    setClips((prev) => {
      const start = placementStart(prev, target, playheadRef.current, clipSpan(item));
      const clip: TimelineClip = {
        id: newId('clip'),
        binId: item.id,
        track: target,
        startSec: start,
        durationSec: clipSpan(item),
        sourceInSec: item.inSec,
        label: item.name,
        autoLength: true,
      };
      return [...prev, clip];
    });
    setSelectedClip(null);
  };

  const addSources = (items: SourceInput[], autoPlace = true) => {
    const newBins: BinItem[] = items.map((it) => {
      const dur = it.durationSec ?? (it.kind === 'image' ? 4 : 12);
      return {
        id: newId('bin'),
        kind: it.kind,
        path: it.path,
        name: it.name ?? fileName(it.path),
        durationSec: dur,
        inSec: 0,
        outSec: dur,
        durationKnown: it.kind === 'image' || it.durationSec != null,
      };
    });
    if (newBins.length === 0) return;
    setBins((prev) => [...prev, ...newBins]);
    setSelectedBin(newBins[0].id);
    if (autoPlace) {
      setClips((prev) => {
        let vCursor = endOfTrack(prev, 'v1');
        let aCursor = endOfTrack(prev, 'a1');
        const added: TimelineClip[] = [];
        for (const bin of newBins) {
          if (bin.kind === 'audio') {
            added.push({
              id: newId('clip'),
              binId: bin.id,
              track: 'a1',
              startSec: aCursor,
              durationSec: clipSpan(bin),
              sourceInSec: 0,
              label: bin.name,
              autoLength: true,
            });
            aCursor += clipSpan(bin);
            continue;
          }
          added.push({
            id: newId('clip'),
            binId: bin.id,
            track: 'v1',
            startSec: vCursor,
            durationSec: clipSpan(bin),
            sourceInSec: 0,
            label: bin.name,
            autoLength: true,
          });
          vCursor += clipSpan(bin);
        }
        return [...prev, ...added];
      });
    }
  };

  const exportVideo = async () => {
    if (clipsRef.current.length === 0 || !window.api?.renderTimeline) return;
    setExportBusy(true);
    setExportError(null);
    try {
      const result = await window.api.renderTimeline({
        width: 1920,
        height: 1080,
        fps: 30,
        clips: clipsRef.current.map((clip) => {
          const bin = binsRef.current.find((b) => b.id === clip.binId);
          return {
            kind: clip.text ? 'text' : bin?.kind ?? 'video',
            track: clip.track,
            path: bin?.path ?? null,
            text: clip.text ?? null,
            start_sec: clip.startSec,
            duration_sec: clip.durationSec,
            source_in_sec: clip.sourceInSec,
          };
        }),
      });
      setExportPath(result.file_path);
      setExportSavedTo(null);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setExportError(raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, ''));
    } finally {
      setExportBusy(false);
    }
  };

  const saveExportAs = async () => {
    if (!exportPath || !window.api?.saveVideoAs) return;
    try {
      const dest = await window.api.saveVideoAs(exportPath);
      if (dest) setExportSavedTo(dest);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    }
  };

  const discardExport = async () => {
    if (exportPath) await window.api?.discardVideoDraft?.(exportPath);
    setExportPath(null);
    setExportSavedTo(null);
  };

  const probeDuration = async (path: string, kind: BinKind): Promise<{ dur: number; known: boolean }> => {
    if (kind === 'image') return { dur: 4, known: true };
    try {
      const probed = await window.api?.probeMediaDuration?.(path);
      if (probed && probed > 0) return { dur: probed, known: true };
    } catch {
      /* fallback */
    }
    return { dur: kind === 'audio' ? 8 : 12, known: false };
  };

  const resolveDroppedPaths = async (files: FileList | File[]): Promise<Array<{ path: string; kind: BinKind }>> => {
    const list = Array.from(files);
    const out: Array<{ path: string; kind: BinKind }> = [];
    for (const file of list) {
      const kind = kindFromFileName(file.name);
      if (!kind) continue;
      let diskPath = '';
      try {
        diskPath = window.api?.getPathForFile?.(file) ?? '';
      } catch {
        diskPath = '';
      }
      if (!diskPath) {
        const legacy = (file as File & { path?: string }).path;
        if (legacy) diskPath = legacy;
      }
      if (!diskPath) continue;
      const remembered = await window.api?.rememberDroppedMedia?.(diskPath);
      if (remembered) out.push({ path: remembered, kind });
    }
    return out;
  };

  const ingestDropped = async (
    files: FileList | File[],
    opts?: { track?: TrackId; startSec?: number; binOnly?: boolean },
  ) => {
    const items = await resolveDroppedPaths(files);
    if (items.length === 0) return;
    for (const item of items) {
      const { dur, known } = await probeDuration(item.path, item.kind);
      let place: TrackId | undefined;
      if (opts?.track) {
        if (isAudioTrack(opts.track) && item.kind !== 'audio') place = defaultTrackForKind(item.kind);
        else if (isVideoTrack(opts.track) && item.kind === 'audio') place = 'a1';
        else if (opts.track.startsWith('t')) place = defaultTrackForKind(item.kind);
        else place = opts.track;
      } else {
        place = defaultTrackForKind(item.kind);
      }
      const binItem: BinItem = {
        id: newId('bin'),
        kind: item.kind,
        path: item.path,
        name: fileName(item.path),
        durationSec: dur,
        inSec: 0,
        outSec: dur,
        durationKnown: known || item.kind === 'image',
      };
      const span = Math.max(0.4, dur);
      setBins((prev) => [...prev, binItem]);
      setSelectedBin(binItem.id);
      if (!place) continue;
      setTrackLayout((layout) => ensureTrackVisible(layout, place));
      setClips((prev) => {
        const start = placementStart(prev, place, playheadRef.current, span, opts?.startSec);
        return [...prev, {
          id: newId('clip'),
          binId: binItem.id,
          track: place,
          startSec: start,
          durationSec: span,
          sourceInSec: 0,
          label: binItem.name,
          autoLength: true,
        }];
      });
    }
  };

  const pickVideo = async () => {
    const path = await window.api?.pickVideo?.();
    if (!path) return;
    const { dur, known } = await probeDuration(path, 'video');
    addBin('video', path, dur, undefined, known);
  };

  const pickImage = async () => {
    const path = await window.api?.pickImage?.();
    if (path) addBin('image', path, 4);
  };

  const pickAudio = async () => {
    const path = await window.api?.pickAudio?.();
    if (!path) return;
    const { dur, known } = await probeDuration(path, 'audio');
    addBin('audio', path, dur, undefined, known);
  };

  const patchBin = (id: string, patch: Partial<BinItem>) => {
    setBins((prev) => {
      const next = prev.map((b) => (b.id === id ? { ...b, ...patch } : b));
      const updated = next.find((b) => b.id === id);
      if (updated) {
        setClips((clipList) => clipList.map((clip) => (
          clip.binId === id ? syncClipDuration(clip, updated) : clip
        )));
      }
      return next;
    });
  };

  const removeBin = (id: string) => {
    setBins((prev) => prev.filter((b) => b.id !== id));
    setClips((prev) => prev.filter((c) => c.binId !== id));
    if (selectedBin === id) setSelectedBin(null);
  };

  const placeOnTrack = (track: TrackId, binId?: string | null, startSec?: number) => {
    const bin = (binId ? binsRef.current.find((b) => b.id === binId) : null) ?? activeBin;
    if (!bin) return;
    if (isAudioTrack(track) && bin.kind !== 'audio') return;
    if (isVideoTrack(track) && bin.kind === 'audio') return;
    if (track.startsWith('t')) return;
    setTrackLayout((layout) => ensureTrackVisible(layout, track));
    const duration = clipSpan(bin);
    let queuedStart: number | null = null;
    let queuedId: string | null = null;
    setClips((prev) => {
      const start = placementStart(prev, track, playheadRef.current, duration, startSec);
      const clip: TimelineClip = {
        id: newId('clip'),
        binId: bin.id,
        track,
        startSec: start,
        durationSec: duration,
        sourceInSec: bin.inSec,
        label: bin.name,
        autoLength: true,
      };
      queuedStart = start;
      queuedId = clip.id;
      return [...prev, clip];
    });
    if (queuedId) setSelectedClip(queuedId);
    setSelectedBin(bin.id);
    if (playheadRef.current <= 0.05 && queuedStart != null) seekTo(queuedStart);
  };

  const ingestAudioPath = async (path: string) => {
    const remembered = (await window.api?.rememberDroppedMedia?.(path)) ?? path;
    const existing = binsRef.current.find((b) => b.kind === 'audio' && b.path === remembered);
    if (existing) {
      placeOnTrack('a1', existing.id);
      return;
    }
    const { dur, known } = await probeDuration(remembered, 'audio');
    addBin('audio', remembered, dur, 'a1', known);
  };

  const refreshVoiceTools = async () => {
    try {
      const profile = await window.api?.getVoiceProfile?.();
      if (profile) setTtsReady(profile.tts_ready);
    } catch {
      setTtsReady(false);
    }
    try {
      const lib = await window.api?.listMediaLibrary?.();
      if (lib) setLibraryAudio(lib.audio.map((a) => ({ path: a.path, name: a.name })));
    } catch {
      /* optional */
    }
  };

  useEffect(() => {
    void refreshVoiceTools();
  }, []);

  const toggleVoiceRecord = async () => {
    if (!window.api?.startMicRecord || !window.api.stopMicRecord) return;
    if (voiceRecording) {
      setVoiceBusy(true);
      try {
        const stopped = await window.api.stopMicRecord();
        setVoiceRecording(false);
        await ingestAudioPath(stopped.file_path);
        await refreshVoiceTools();
        setVoiceError(null);
      } catch (err) {
        setVoiceError(ipcMessage(err, t('video.dir_voice_fail')));
        setVoiceRecording(false);
      } finally {
        setVoiceBusy(false);
      }
      return;
    }
    setVoiceError(null);
    try {
      await window.api.startMicRecord('wav');
      setVoiceRecording(true);
    } catch (err) {
      setVoiceError(ipcMessage(err, t('video.dir_voice_fail')));
    }
  };

  const generateVoiceover = async () => {
    if (!voiceLine.trim() || !window.api?.synthesizeVoice) return;
    setVoiceBusy(true);
    setVoiceError(null);
    try {
      let preparedText: string | undefined;
      if (window.api.prepareVoiceText) {
        const prep = await window.api.prepareVoiceText({ text: voiceLine.trim() });
        preparedText = prep.spoken;
      }
      const result = await window.api.synthesizeVoice({
        text: voiceLine.trim(),
        prepared_text: preparedText,
      });
      await ingestAudioPath(result.file_path);
      await refreshVoiceTools();
    } catch (err) {
      setVoiceError(ipcMessage(err, t('video.dir_voice_tts_off')));
    } finally {
      setVoiceBusy(false);
    }
  };

  const applyVoiceFix = async () => {
    if (!voiceFixPrompt.trim() || !window.api?.fixVoicePronunciation) return;
    setVoiceBusy(true);
    setVoiceError(null);
    try {
      await window.api.fixVoicePronunciation({
        prompt: voiceFixPrompt.trim(),
        context_text: voiceLine.trim() || undefined,
      });
      setVoiceFixPrompt('');
      if (voiceLine.trim() && window.api.synthesizeVoice) {
        let preparedText: string | undefined;
        if (window.api.prepareVoiceText) {
          const prep = await window.api.prepareVoiceText({ text: voiceLine.trim() });
          preparedText = prep.spoken;
        }
        const result = await window.api.synthesizeVoice({
          text: voiceLine.trim(),
          prepared_text: preparedText,
        });
        await ingestAudioPath(result.file_path);
        await refreshVoiceTools();
      }
    } catch (err) {
      setVoiceError(ipcMessage(err, t('video.dir_voice_fix_fail')));
    } finally {
      setVoiceBusy(false);
    }
  };

  const setVoiceoverExpanded = (expanded: boolean) => {
    setVoiceover((prev) => ({ ...prev, expanded }));
  };

  const openVoiceover = () => {
    setVoiceover((prev) => {
      const path = voiceoverSource?.path ?? prev.sourcePath;
      const samePath = path === prev.sourcePath;
      return {
        ...prev,
        expanded: true,
        sourcePath: path,
        sourceBinId: voiceoverSource?.binId ?? prev.sourceBinId,
        analysis: samePath ? prev.analysis : null,
        status: samePath ? prev.status : 'idle',
      };
    });
  };

  const analyzeVoiceover = async () => {
    const src = voiceoverSource;
    if (!src?.path || !window.api?.analyzeVideo) {
      setVoiceoverError(t('video.vo_no_video'));
      return;
    }
    setVoiceoverBusy(true);
    setVoiceoverError(null);
    setVoiceoverProgress({ stage: 'starting', percent: 3, detail: t('video.vo_analyze_start') });
    if (voiceoverPollRef.current) clearInterval(voiceoverPollRef.current);
    voiceoverPollRef.current = setInterval(() => {
      void window.api?.getVideoAnalyzeProgress?.().then((p) => {
        if (!p) return;
        setVoiceoverProgress({
          stage: p.stage,
          percent: p.percent,
          detail: p.detail || p.stage,
        });
      }).catch(() => {
        /* ignore */
      });
    }, 500);
    try {
      const result = await window.api.analyzeVideo({
        video_path: src.path,
        transcribe: true,
        scene_detect: true,
        language: 'auto',
        use_cache: true,
      });
      setVoiceover({
        sourcePath: src.path,
        sourceBinId: src.binId,
        analysis: result.context as unknown as VideoAnalysisContext,
        status: 'analyzed',
        expanded: true,
      });
      setVoiceoverProgress({ stage: 'done', percent: 100, detail: t('video.vo_analyze_done') });
    } catch (err) {
      setVoiceoverError(ipcMessage(err, t('video.vo_analyze_fail')));
    } finally {
      if (voiceoverPollRef.current) {
        clearInterval(voiceoverPollRef.current);
        voiceoverPollRef.current = null;
      }
      setVoiceoverBusy(false);
    }
  };

  const placeLibraryAudio = (path: string) => {
    void ingestAudioPath(path).catch((err) => {
      setVoiceError(ipcMessage(err, t('video.dir_voice_fail')));
    });
  };

  const hasTimelineGaps = useMemo(
    () => [...new Set(clips.map((c) => c.track))].some((track) => !track.startsWith('t') && trackHasGap(clips, track)),
    [clips],
  );

  const packGaps = () => {
    setClips((prev) => packAllGaps(prev));
  };

  const addVideoOverlayTrack = () => {
    setTrackLayout((layout) => ({
      ...layout,
      videos: Math.min(layout.videos + 1, 8),
    }));
  };

  const removeEmptyTrack = (track: TrackId) => {
    setTrackLayout((layout) => {
      if (!canRemoveEmptyTrack(track, clipsRef.current, layout)) return layout;
      const n = trackIndex(track);
      if (track.startsWith('v')) return { ...layout, videos: Math.max(1, n - 1) };
      if (track.startsWith('a')) return { ...layout, audios: Math.max(1, n - 1) };
      return { ...layout, titles: Math.max(1, n - 1) };
    });
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
    if (dragRef.current?.moved || scrubbingRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    seekTo((e.clientX - rect.left) / pxRef.current);
  };

  const scrubAt = (e: PointerEvent<HTMLElement>, commitVideo: boolean) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const next = paintPlayhead((e.clientX - rect.left) / pxRef.current);
    if (commitVideo) {
      pushPlayheadReact(next, true);
      setSeekNonce((n) => n + 1);
      return;
    }
    const now = performance.now();
    if (now - lastReactRef.current > 40) {
      lastReactRef.current = now;
      setPlayhead(next);
      setSeekNonce((n) => n + 1);
    }
  };

  const onRulerPointerDown = (e: PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('[data-clip], button')) return;
    scrubbingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (playing) setPlaying(false);
    scrubAt(e, true);
  };

  const onRulerPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (!scrubbingRef.current) return;
    scrubAt(e, false);
  };

  const onRulerPointerUp = (e: PointerEvent<HTMLElement>) => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    scrubAt(e, true);
  };

  const laneAtPoint = (x: number, y: number): TrackId | undefined => {
    const hits = document.elementsFromPoint(x, y);
    for (const node of hits) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.dataset.clip === 'true') continue;
      const lane = (node.dataset.trackLane ? node : node.closest('[data-track-lane]')) as HTMLElement | null;
      const id = lane?.dataset.trackLane as TrackId | undefined;
      if (id) return id;
    }
    return undefined;
  };

  const applyClipDrag = (clientX: number, clientY: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dt = (clientX - drag.startX) / pxRef.current;
    if (Math.abs(clientX - drag.startX) > 3) drag.moved = true;
    const clip = clipsRef.current.find((c) => c.id === drag.id);
    if (!clip) return;

    if (drag.mode === 'move') {
      drag.moved = drag.moved || Math.abs(clientX - drag.startX) > 3;
      let track = clip.track;
      const nextTrack = laneAtPoint(clientX, clientY);
      const layout = effectiveTrackLayout(clipsRef.current, trackLayoutRef.current);
      const allowed = allowedTracksForClip(clip, binsRef.current, layout);
      if (nextTrack && allowed.includes(nextTrack)) {
        track = nextTrack;
        setTrackLayout((prev) => ensureTrackVisible(prev, nextTrack));
      } else if (isVideoTrack(clip.track) && !clip.track.startsWith('t')) {
        const lastId = `v${layout.videos}` as TrackId;
        const lastLane = document.querySelector(`[data-track-lane="${lastId}"]`);
        if (lastLane && clientY > lastLane.getBoundingClientRect().bottom - 6 && layout.videos < 8) {
          const extra = `v${layout.videos + 1}` as TrackId;
          setTrackLayout((prev) => ensureTrackVisible(prev, extra));
          track = extra;
        }
      }
      const startSec = avoidOverlap(
        clipsRef.current,
        clip.id,
        track,
        Math.max(0, drag.origStart + dt),
        clip.durationSec,
      );
      patchClip(drag.id, { startSec, track });
      const scroller = boardScrollRef.current;
      if (scroller) {
        const box = scroller.getBoundingClientRect();
        const leftGuard = box.left + LABEL_W + 28;
        const rightGuard = box.right - 28;
        if (clientX > rightGuard) scroller.scrollLeft += 24;
        if (clientX < leftGuard) scroller.scrollLeft -= 24;
      }
      return;
    }

    const bin = binsRef.current.find((b) => b.id === clip.binId);
    const maxOut = bin ? Math.max(0.4, bin.durationSec - (drag.mode === 'out' ? drag.origSourceIn : 0)) : 3600;

    if (drag.mode === 'out') {
      drag.moved = true;
      const wanted = Math.min(maxOut, Math.max(0.4, drag.origDur + dt));
      patchClip(drag.id, {
        durationSec: maxDurationBeforeNext(clipsRef.current, clip.id, clip.track, drag.origStart, wanted),
        autoLength: false,
      });
      return;
    }

    drag.moved = true;
    const maxShift = drag.origDur - 0.4;
    const minShift = bin ? Math.max(-drag.origSourceIn, -(bin.inSec + drag.origSourceIn)) : -drag.origSourceIn;
    const shift = Math.min(maxShift, Math.max(minShift, dt));
    patchClip(drag.id, {
      startSec: Math.max(0, drag.origStart + shift),
      durationSec: drag.origDur - shift,
      sourceInSec: drag.origSourceIn + shift,
      autoLength: false,
    });
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
    applyClipDrag(e.clientX, e.clientY);
  };

  const finishClipMove = () => {
    const drag = dragRef.current;
    if (!drag || drag.mode !== 'move' || !drag.moved) return;
    const clip = clipsRef.current.find((c) => c.id === drag.id);
    if (!clip) return;
    const startSec = snapStart(clipsRef.current, clip.id, clip.track, clip.startSec, clip.durationSec);
    if (Math.abs(startSec - clip.startSec) > 0.01) patchClip(clip.id, { startSec });
  };

  const onClipPointerUp = (e: PointerEvent<HTMLElement>, clip: TimelineClip) => {
    const drag = dragRef.current;
    if (drag && !drag.moved) seekTo(clip.startSec);
    else finishClipMove();
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  useEffect(() => {
    const move = (e: globalThis.PointerEvent) => {
      if (!dragRef.current) return;
      applyClipDrag(e.clientX, e.clientY);
    };
    const up = () => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.moved) {
        const clip = clipsRef.current.find((c) => c.id === drag.id);
        if (clip) seekTo(clip.startSec);
      } else {
        finishClipMove();
      }
      dragRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  const live = useMemo(() => {
    const out: Record<string, string | undefined> = {};
    for (const { id } of tracks) {
      out[id] = clipAtTime(clips, id, playhead)?.id;
    }
    return out;
  }, [clips, playhead, tracks]);

  const snap: DirectorSnap = {
    t: t as DirectorSnap['t'],
    bins,
    clips,
    selectedBin,
    selectedClip,
    playhead,
    playing,
    seekNonce,
    pxPerSec,
    minPxPerSec,
    maxPxPerSec,
    fitTimeline,
    setViewW,
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
    tracks,
    trackLayout,
    visibleLayout: effectiveLayout,
    addVideoOverlayTrack,
    removeEmptyTrack,
    boardScrollRef,
    playheadElRef,
    clockElRef,
    live,
    seekTo,
    togglePlay,
    seekFromEvent,
    onRulerPointerDown,
    onRulerPointerMove,
    onRulerPointerUp,
    pickVideo: () => { void pickVideo(); },
    pickImage: () => { void pickImage(); },
    pickAudio: () => { void pickAudio(); },
    removeBin,
    setSelectedBin,
    setSelectedClip,
    patchBin,
    placeOnTrack,
    ingestDropped: (files, opts) => { void ingestDropped(files, opts); },
    dropActive,
    setDropActive,
    addCaption,
    removeClip,
    clearTrack,
    onClipPointerDown,
    onClipPointerMove,
    onClipPointerUp,
    applyProxy: (binId, force) => { void applyProxy(binId, force); },
    addSources,
    hasTimelineGaps,
    packGaps,
    voiceRecording,
    voiceBusy,
    voiceError,
    voiceLine,
    setVoiceLine,
    voiceFixPrompt,
    setVoiceFixPrompt,
    applyVoiceFix: () => { void applyVoiceFix(); },
    ttsReady,
    libraryAudio,
    toggleVoiceRecord: () => { void toggleVoiceRecord(); },
    generateVoiceover: () => { void generateVoiceover(); },
    placeLibraryAudio,
    overlayPos,
    setOverlayPos: (track, pos) => {
      setOverlayPosState((prev) => ({ ...prev, [track]: pos }));
    },
    exportBusy,
    exportPath,
    exportError,
    exportSavedTo,
    exportVideo: () => { void exportVideo(); },
    saveExportAs: () => { void saveExportAs(); },
    discardExport: () => { void discardExport(); },
    voiceover,
    voiceoverSource,
    voiceoverBusy,
    voiceoverError,
    voiceoverProgress,
    setVoiceoverExpanded,
    openVoiceover,
    analyzeVoiceover: () => { void analyzeVoiceover(); },
  };

  return <DirectorContext.Provider value={snap}>{children}</DirectorContext.Provider>;
}
