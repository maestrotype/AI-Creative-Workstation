import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import type { CSSProperties, ReactNode, PointerEvent, WheelEvent } from 'react';
import { useDirector } from './DirectorBoard';
import { formatTimecode } from '../model/videoAnalysis';
import {
  moveClipWithRipple,
  moveTimedRangeWithRipple,
  sanitizeClips,
  unstackAllTracks,
  filmTotalSec,
  type TimelineClip,
} from '../model/directorTimeline';
import type { Callout } from '../model/callout';
import { hintDuration, hintLaneTone, hintTypeLabel } from '../model/callout';
import { clipDisplayName } from '../model/clipDisplayName';
import { ClipMediaFace } from './ClipMediaFace';
import s from './TrackMixer.module.css';

type ExtractMode = 'both' | 'audio_only' | 'mute_video';

const LABEL_W = 140;
/** A short product shot stays a block you can grab, even beside a multi-minute upload. */
const READABLE_CLIP_PX = 108;

interface DraggingState {
  type: 'clip' | 'callout';
  mode: 'move' | 'trim-in' | 'trim-out';
  id: string;
  startX: number;
  origStartSec: number;
  durationSec: number;
  origSourceIn: number;
  origTrack: TimelineClip['track'];
  currentStartSec: number;
  currentDurationSec: number;
}

/**
 * Exact time geometry — never inflate width.
 * Fake min-width is what made clips stack visually when zoomed out.
 */
function laneStyle(startSec: number, durationSec: number, pxPerSec: number): CSSProperties {
  const left = Math.max(0, startSec) * pxPerSec;
  const width = Math.max(0.5, durationSec * pxPerSec - 1);
  return { left, width };
}

function videoTrackAt(clientY: number, v2El: HTMLDivElement | null, v1El: HTMLDivElement | null): 'v1' | 'v2' | null {
  if (v2El) {
    const box = v2El.getBoundingClientRect();
    if (clientY >= box.top && clientY <= box.bottom) return 'v2';
  }
  if (v1El) {
    const box = v1El.getBoundingClientRect();
    if (clientY >= box.top && clientY <= box.bottom) return 'v1';
  }
  return null;
}

function pickRulerStep(pxPerSec: number): number {
  const raw = 72 / Math.max(pxPerSec, 0.001);
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((step) => step >= raw) ?? Math.max(raw, 1);
}

export function TrackMixer({ embedded = false }: { embedded?: boolean } = {}): ReactNode {
  const d = useDirector();
  const [extractModalOpen, setExtractModalOpen] = useState(false);
  const [extractMode, setExtractMode] = useState<ExtractMode>('both');
  const [extractSuccess, setExtractSuccess] = useState<string | null>(null);

  // Selected item on the timeline (can be deleted via Backspace/Delete key or button)
  const [selectedItem, setSelectedItem] = useState<{ type: 'clip' | 'callout'; id: string } | null>(
    () => (d.selectedClip ? { type: 'clip', id: d.selectedClip } : null),
  );

  // Dragging state for moving clips & callouts along timeline
  const [draggingItem, setDraggingItem] = useState<DraggingState | null>(null);
  /** Live layout preview while dragging — neighbors shove aside before commit. */
  const [previewClips, setPreviewClips] = useState<TimelineClip[] | null>(null);
  const [previewCallouts, setPreviewCallouts] = useState<Callout[] | null>(null);
  const baselineClipsRef = useRef<TimelineClip[] | null>(null);
  const baselineCalloutsRef = useRef<Callout[] | null>(null);
  const v2TrackRef = useRef<HTMLDivElement | null>(null);
  const v1TrackRef = useRef<HTMLDivElement | null>(null);
  const [dropTargetTrack, setDropTargetTrack] = useState<'v1' | 'v2' | null>(null);
  const previewClipsRef = useRef<TimelineClip[] | null>(null);
  const previewCalloutsRef = useRef<Callout[] | null>(null);

  // Dragging state for the playhead scrubber needle
  const [draggingPlayhead, setDraggingPlayhead] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const [viewportW, setViewportW] = useState(480);
  /** Mixer owns its zoom so Director "fit" effect cannot crush short clips again. */
  const [mixerPx, setMixerPx] = useState<number | null>(null);
  /** Once the user zooms manually, stop auto-fitting on resize. */
  const [userZoomed, setUserZoomed] = useState(false);

  const displayClips = useMemo(
    () => unstackAllTracks(previewClips ?? d.clips),
    [previewClips, d.clips],
  );
  const displayCallouts = previewCallouts ?? d.callouts ?? [];

  // Calculate timeline bounds
  const totalSec = useMemo(() => {
    return filmTotalSec(displayClips, displayCallouts, d.voiceoverSource?.durationSec ?? 0);
  }, [displayClips, d.voiceoverSource, displayCallouts]);

  const fitPx = Math.max(1.2, (Math.max(viewportW, 240) - LABEL_W - 24) / Math.max(totalSec, 1));
  const maxMixerPx = Math.max(40, fitPx * 16);
  const minMixerPx = fitPx;

  const readablePx = useMemo(() => {
    const onV1 = displayClips.filter((c) => c.track === 'v1' && c.durationSec >= 0.8);
    if (onV1.length === 0) return fitPx;
    const shorts = onV1.filter((c) => c.durationSec <= 12);
    const ref = shorts.length
      ? Math.min(...shorts.map((c) => c.durationSec))
      : Math.min(...onV1.map((c) => c.durationSec));
    if (fitPx * ref >= READABLE_CLIP_PX * 0.9) return fitPx;
    return Math.min(maxMixerPx, Math.max(fitPx, READABLE_CLIP_PX / ref));
  }, [displayClips, fitPx, maxMixerPx]);

  const pxPerSec = mixerPx ?? readablePx;
  const bodyPx = Math.max(viewportW - LABEL_W, Math.ceil(totalSec * pxPerSec) + 48);

  const v1Clips = useMemo(
    () => displayClips.filter((c) => c.track === 'v1').sort((a, b) => a.startSec - b.startSec),
    [displayClips],
  );
  const v2Clips = useMemo(
    () => displayClips.filter((c) => c.track === 'v2').sort((a, b) => a.startSec - b.startSec),
    [displayClips],
  );
  const a1Clips = useMemo(
    () => displayClips.filter((c) => c.track === 'a1').sort((a, b) => a.startSec - b.startSec),
    [displayClips],
  );
  const a2Clips = useMemo(
    () => displayClips.filter((c) => c.track === 'a2').sort((a, b) => a.startSec - b.startSec),
    [displayClips],
  );

  /** Still order on V1 → Hero / Detail / Angle… (skip uploaded video). */
  const stillSeqById = useMemo(() => {
    const map = new Map<string, number>();
    let i = 0;
    for (const clip of [...v1Clips, ...v2Clips]) {
      const bin = clip.binId ? d.bins.find((b) => b.id === clip.binId) : null;
      if (bin?.kind === 'image') {
        map.set(clip.id, i);
        i += 1;
      }
    }
    return map;
  }, [v1Clips, v2Clips, d.bins]);

  const [canScrollX, setCanScrollX] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => setCanScrollX(el.scrollWidth > el.clientWidth + 4);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [bodyPx, pxPerSec, totalSec]);

  const atFitZoom = Math.abs(pxPerSec - fitPx) < Math.max(0.08, fitPx * 0.06);
  const [viewOrigin, setViewOrigin] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => {
      setViewportW(el.clientWidth);
      setViewOrigin(el.scrollLeft);
    };
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', sync);
      ro.disconnect();
    };
  }, []);

  // Persist a clean layout if older sessions still have stacked clips.
  useEffect(() => {
    if (draggingItem || previewClips) return;
    const healed = sanitizeClips(d.clips);
    if (healed !== d.clips) d.replaceClips(healed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.clips, draggingItem, previewClips]);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const rulerEl = rulerRef.current;
      if (!rulerEl) return;
      const rect = rulerEl.getBoundingClientRect();
      const x = Math.max(0, Math.min(bodyPx, clientX - rect.left));
      d.seekTo(Math.min(totalSec, x / Math.max(pxPerSec, 0.001)));
    },
    [d, totalSec, bodyPx, pxPerSec],
  );

  const commitZoom = (next: number, fromUser = true) => {
    const clamped = Math.min(maxMixerPx, Math.max(minMixerPx, next));
    if (fromUser) setUserZoomed(true);
    setMixerPx(clamped);
    d.setPxPerSec(clamped);
  };

  const zoomBy = (factor: number) => {
    commitZoom(pxPerSec * factor, true);
  };

  const zoomFit = () => {
    commitZoom(fitPx, true);
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollLeft = 0;
        setViewOrigin(0);
      }
    });
  };

  const zoomReadable = () => {
    setUserZoomed(false);
    commitZoom(readablePx, false);
  };

  // Shot scale until the user chooses «Весь ролик». Long footage scrolls.
  useEffect(() => {
    if (viewportW < 220 || userZoomed) return;
    setMixerPx(readablePx);
    d.setPxPerSec(readablePx);
  }, [viewportW, userZoomed, readablePx, d]);

  // Keep playhead visible in the horizontal scroll viewport.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || draggingItem || draggingPlayhead) return;
    const x = d.playhead * pxPerSec;
    const left = scroller.scrollLeft;
    const right = left + scroller.clientWidth;
    const margin = 48;
    if (x < left + margin) scroller.scrollLeft = Math.max(0, x - margin);
    else if (x > right - margin) scroller.scrollLeft = x - scroller.clientWidth + margin;
  }, [d.playhead, pxPerSec, draggingItem, draggingPlayhead]);

  const onTimelineWheel = (e: WheelEvent<HTMLDivElement>) => {
    const scroller = scrollRef.current;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const prevPx = pxPerSec;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = Math.min(maxMixerPx, Math.max(minMixerPx, prevPx * factor));
      if (!scroller) {
        commitZoom(next, true);
        return;
      }
      const rect = scroller.getBoundingClientRect();
      const xInView = e.clientX - rect.left;
      const timeUnderCursor = (scroller.scrollLeft + xInView) / prevPx;
      commitZoom(next, true);
      requestAnimationFrame(() => {
        scroller.scrollLeft = Math.max(0, timeUnderCursor * next - xInView);
      });
      return;
    }
    // NLE-style: wheel pans the film when content overflows (Shift optional).
    if (scroller && scroller.scrollWidth > scroller.clientWidth + 2) {
      const dx = e.shiftKey ? (e.deltaY || e.deltaX) : (e.deltaX || e.deltaY);
      if (dx !== 0) {
        e.preventDefault();
        scroller.scrollLeft += dx;
      }
    }
  };

  const selectClip = (id: string | null) => {
    if (!id) {
      setSelectedItem(null);
      d.setSelectedClip(null);
      d.setSelectedCallout(null);
      return;
    }
    setSelectedItem({ type: 'clip', id });
    d.setSelectedClip(id);
    d.setSelectedCallout(null);
  };

  // Pointer down on playhead thumb or ruler starts playhead dragging
  const handlePlayheadPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingPlayhead(true);
    seekFromClientX(e.clientX);
  };

  // Window listeners for playhead scrubbing
  useEffect(() => {
    if (!draggingPlayhead) return;

    const handlePointerMove = (e: globalThis.PointerEvent) => {
      seekFromClientX(e.clientX);
    };

    const handlePointerUp = () => {
      setDraggingPlayhead(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [draggingPlayhead, seekFromClientX]);

  // Handle pointer down to start dragging a clip or callout
  const handleItemPointerDown = (
    e: PointerEvent<Element>,
    type: 'clip' | 'callout',
    id: string,
    origStartSec: number,
    durationSec: number,
    mode: DraggingState['mode'] = 'move',
  ) => {
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    e.stopPropagation();
    e.preventDefault();

    setSelectedItem({ type, id });
    if (type === 'clip') d.setSelectedClip(id);
    let startSec = origStartSec;
    let sourceIn = 0;
    previewClipsRef.current = null;
    previewCalloutsRef.current = null;
    setPreviewClips(null);
    setPreviewCallouts(null);
    if (type === 'clip') {
      const baseline = d.clips.map((clip) => ({ ...clip }));
      baselineClipsRef.current = baseline;
      baselineCalloutsRef.current = null;
      const mine = baseline.find((clip) => clip.id === id);
      startSec = mine?.startSec ?? origStartSec;
      sourceIn = mine?.sourceInSec ?? 0;
      durationSec = mine?.durationSec ?? durationSec;
    } else {
      const baseline = (d.callouts ?? []).map((item) => ({ ...item }));
      baselineCalloutsRef.current = baseline;
      baselineClipsRef.current = null;
      startSec = baseline.find((item) => item.id === id)?.startSec ?? origStartSec;
    }
    const origTrack = type === 'clip'
      ? (baselineClipsRef.current?.find((clip) => clip.id === id)?.track ?? 'v1')
      : 'v1';
    setDraggingItem({
      type,
      mode,
      id,
      startX: e.clientX,
      origStartSec: startSec,
      durationSec,
      origSourceIn: sourceIn,
      origTrack,
      currentStartSec: startSec,
      currentDurationSec: durationSec,
    });
  };

  // Window listeners for smooth timeline clip dragging / trim with neighbor shove
  useEffect(() => {
    if (!draggingItem) return;

    const handlePointerMove = (e: globalThis.PointerEvent) => {
      const deltaPx = e.clientX - draggingItem.startX;
      const deltaSec = deltaPx / Math.max(pxPerSec, 0.001);

      if (draggingItem.type === 'clip' && baselineClipsRef.current) {
        const base = baselineClipsRef.current;
        const target = base.find((c) => c.id === draggingItem.id);
        if (!target) return;

        if (draggingItem.mode === 'trim-out') {
          const bin = d.bins.find((b) => b.id === target.binId);
          const maxDur = bin?.kind === 'video'
            ? Math.max(0.4, (bin.durationSec || draggingItem.durationSec) - target.sourceInSec)
            : 3600;
          const nextDur = Math.max(0.4, Math.min(maxDur, Math.round((draggingItem.durationSec + deltaSec) * 100) / 100));
          const withDur = base.map((clip) => (
            clip.id === draggingItem.id
              ? { ...clip, durationSec: nextDur, autoLength: false }
              : clip
          ));
          const next = unstackAllTracks(withDur);
          previewClipsRef.current = next;
          setPreviewClips(next);
          setDraggingItem((prev) => (
            prev ? { ...prev, currentDurationSec: nextDur, currentStartSec: target.startSec } : null
          ));
          return;
        }

        if (draggingItem.mode === 'trim-in') {
          const maxShift = draggingItem.durationSec - 0.4;
          const shift = Math.max(-draggingItem.origStartSec, Math.min(maxShift, deltaSec));
          const nextStart = Math.round((draggingItem.origStartSec + shift) * 100) / 100;
          const nextDur = Math.round((draggingItem.durationSec - shift) * 100) / 100;
          const bin = d.bins.find((b) => b.id === target.binId);
          const nextSource = bin?.kind === 'image'
            ? target.sourceInSec
            : Math.max(0, draggingItem.origSourceIn + shift);
          const withTrim = base.map((clip) => (
            clip.id === draggingItem.id
              ? {
                  ...clip,
                  startSec: nextStart,
                  durationSec: nextDur,
                  sourceInSec: nextSource,
                  autoLength: false,
                }
              : clip
          ));
          const next = unstackAllTracks(withTrim);
          previewClipsRef.current = next;
          setPreviewClips(next);
          setDraggingItem((prev) => (
            prev ? { ...prev, currentStartSec: nextStart, currentDurationSec: nextDur } : null
          ));
          return;
        }

        const lane = videoTrackAt(e.clientY, v2TrackRef.current, v1TrackRef.current);
        const canSwapLane = target.track === 'v1' || target.track === 'v2';
        const nextTrack = canSwapLane && (lane === 'v1' || lane === 'v2') ? lane : target.track;
        setDropTargetTrack(canSwapLane && (nextTrack === 'v1' || nextTrack === 'v2') ? nextTrack : null);

        const maxStart = Math.max(0, totalSec * 2);
        const newStart = Math.max(0, Math.min(maxStart, draggingItem.origStartSec + deltaSec));
        const rounded = Math.round(newStart * 100) / 100;
        const withTrack = nextTrack === target.track
          ? base
          : base.map((clip) => (clip.id === draggingItem.id ? { ...clip, track: nextTrack } : clip));
        const next = unstackAllTracks(moveClipWithRipple(withTrack, draggingItem.id, rounded));
        previewClipsRef.current = next;
        setPreviewClips(next);
        setDraggingItem((prev) =>
          prev ? { ...prev, currentStartSec: rounded } : null,
        );
        return;
      }

      if (draggingItem.type === 'callout' && baselineCalloutsRef.current) {
        const base = baselineCalloutsRef.current;
        const target = base.find((c) => c.id === draggingItem.id);
        if (!target) return;

        if (draggingItem.mode === 'trim-out') {
          const nextDur = Math.max(0.4, Math.round((draggingItem.durationSec + deltaSec) * 100) / 100);
          const next = base.map((item) => (
            item.id === draggingItem.id
              ? { ...item, endSec: item.startSec + nextDur }
              : item
          ));
          previewCalloutsRef.current = next;
          setPreviewCallouts(next);
          setDraggingItem((prev) => (
            prev ? { ...prev, currentDurationSec: nextDur } : null
          ));
          return;
        }

        if (draggingItem.mode === 'trim-in') {
          const maxShift = draggingItem.durationSec - 0.4;
          const shift = Math.max(-draggingItem.origStartSec, Math.min(maxShift, deltaSec));
          const nextStart = Math.round((draggingItem.origStartSec + shift) * 100) / 100;
          const nextDur = Math.round((draggingItem.durationSec - shift) * 100) / 100;
          const next = base.map((item) => (
            item.id === draggingItem.id
              ? { ...item, startSec: nextStart, endSec: nextStart + nextDur }
              : item
          ));
          previewCalloutsRef.current = next;
          setPreviewCallouts(next);
          setDraggingItem((prev) => (
            prev ? { ...prev, currentStartSec: nextStart, currentDurationSec: nextDur } : null
          ));
          return;
        }

        const maxStart = Math.max(0, totalSec - draggingItem.durationSec);
        const newStart = Math.max(0, Math.min(maxStart, draggingItem.origStartSec + deltaSec));
        const rounded = Math.round(newStart * 100) / 100;
        const next = moveTimedRangeWithRipple(base, draggingItem.id, rounded);
        previewCalloutsRef.current = next;
        setPreviewCallouts(next);
        setDraggingItem((prev) =>
          prev ? { ...prev, currentStartSec: rounded } : null,
        );
      }
    };

    const handlePointerUp = () => {
      setDropTargetTrack(null);
      if (draggingItem) {
        if (draggingItem.type === 'clip' && previewClipsRef.current) {
          d.replaceClips(previewClipsRef.current);
        } else if (draggingItem.type === 'callout' && previewCalloutsRef.current) {
          for (const item of previewCalloutsRef.current) {
            const orig = baselineCalloutsRef.current?.find((c) => c.id === item.id);
            if (!orig) continue;
            if (
              Math.abs(orig.startSec - item.startSec) > 0.001
              || Math.abs(orig.endSec - item.endSec) > 0.001
            ) {
              d.updateCallout(item.id, { startSec: item.startSec, endSec: item.endSec });
            }
          }
        }
        setDraggingItem(null);
        setPreviewClips(null);
        setPreviewCallouts(null);
        previewClipsRef.current = null;
        previewCalloutsRef.current = null;
        baselineClipsRef.current = null;
        baselineCalloutsRef.current = null;
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [draggingItem, totalSec, d, pxPerSec]);

  // Keyboard shortcut to delete selected clip or callout via Delete / Backspace
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tagName = (e.target as HTMLElement)?.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA') return;

        if (selectedItem) {
          e.preventDefault();
          if (selectedItem.type === 'clip') {
            d.removeClip(selectedItem.id);
          } else {
            d.removeCallout(selectedItem.id);
          }
          setSelectedItem(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItem, d]);

  const onConfirmExtract = async () => {
    try {
      await d.extractAudioTrack(extractMode);
      setExtractModalOpen(false);
      setExtractSuccess(
        extractMode === 'both'
          ? 'Звук успешно отделён на дорожку A2, а видео заменено на версию без звука.'
          : extractMode === 'audio_only'
            ? 'Аудиодорожка успешно извлечена в WAV и добавлена на дорожку A2.'
            : 'Создана копия видеофайла без звука.',
      );
      setTimeout(() => setExtractSuccess(null), 5000);
    } catch {
      // Error handled inside extractAudioTrack
    }
  };

  // Generate ruler tick marks with spacing that stays readable at current zoom
  const ticks = useMemo(() => {
    const step = pickRulerStep(pxPerSec);
    const result: Array<{ sec: number; leftPx: number }> = [];
    for (let sec = 0; sec <= totalSec + 0.001; sec += step) {
      result.push({ sec, leftPx: sec * pxPerSec });
    }
    return result;
  }, [totalSec, pxPerSec]);

  const playheadLeft = d.playhead * pxPerSec;
  const hasVideoSource = Boolean(d.voiceoverSource?.path);
  // Keep mixer selection aligned with Director inspector / AI actions.
  useEffect(() => {
    if (!d.selectedClip) return;
    setSelectedItem((prev) => (prev?.type === 'clip' && prev.id === d.selectedClip
      ? prev
      : { type: 'clip', id: d.selectedClip! }));
  }, [d.selectedClip]);

  const renderMixerClip = (
    clip: TimelineClip,
    index: number,
    tone: 'video' | 'still' | 'audioOriginal' | 'audioExtracted',
  ) => {
    const isDragging = draggingItem?.type === 'clip' && draggingItem.id === clip.id;
    const isSelected = selectedItem?.id === clip.id || d.selectedClip === clip.id;
    const toneClass = {
      video: s.clipVideo,
      still: s.clipStill,
      audioOriginal: s.clipAudioOriginal,
      audioExtracted: s.clipAudioExtracted,
    }[tone];
    const showDur = clip.durationSec;
    const widthPx = Math.max(1, showDur * pxPerSec);
    const bin = clip.binId ? d.bins.find((b) => b.id === clip.binId) ?? null : null;
    const shot = bin?.shotId ? d.shots.find((item) => item.id === bin.shotId) ?? null : null;
    const faceTone = bin?.kind === 'image'
      ? 'still'
      : (bin?.kind === 'audio' || tone.startsWith('audio'))
        ? 'audio'
        : 'video';
    const mediaUrl = bin && bin.kind !== 'image' && bin.path ? (d.blobs[bin.path] ?? null) : null;
    const origin = bin?.shotId ? 'ai' as const : bin ? 'original' as const : null;
    const seq = stillSeqById.get(clip.id);
    const displayName = clipDisplayName(clip, bin, shot, seq, { compact: widthPx < 72 });

    return (
      <div
        key={clip.id}
        className={`${s.clipBlock} ${toneClass} ${isDragging ? s.clipDragging : ''} ${faceTone === 'still' ? s.clipIsImage : ''} ${faceTone === 'video' ? s.clipIsVideo : ''} ${faceTone === 'audio' ? s.clipIsAudio : ''}`}
        data-selected={isSelected}
        data-alt={index % 2 === 1}
        data-narrow={widthPx < 72}
        data-shoving={Boolean(previewClips) && !isDragging}
        style={laneStyle(clip.startSec, showDur, pxPerSec)}
        onPointerDown={(e) =>
          handleItemPointerDown(e, 'clip', clip.id, clip.startSec, clip.durationSec, 'move')
        }
        onClick={(e) => {
          e.stopPropagation();
          selectClip(clip.id);
        }}
        title={`${displayName} · ${formatTimecode(clip.startSec)}–${formatTimecode(clip.startSec + showDur)} (${formatTimecode(showDur)})`}
      >
        <span
          className={s.clipTrim}
          data-edge="in"
          onPointerDown={(e) => {
            e.stopPropagation();
            handleItemPointerDown(e, 'clip', clip.id, clip.startSec, clip.durationSec, 'trim-in');
          }}
          title="Trim in"
        />

        <ClipMediaFace
          clip={clip}
          bin={bin}
          shot={shot}
          mediaUrl={mediaUrl}
          widthPx={widthPx}
          tone={faceTone}
          origin={origin}
          sequenceIndex={seq}
        />

        <span className={s.clipDurFloat}>
          {isDragging && draggingItem?.mode === 'move'
            ? formatTimecode(clip.startSec)
            : `${Math.round(showDur * 10) / 10}s`}
        </span>

        <button
          type="button"
          className={s.clipDeleteBtn}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            d.removeClip(clip.id);
            if (selectedItem?.id === clip.id) selectClip(null);
          }}
          title="Удалить клип (Delete)"
        >
          ✕
        </button>

        <span
          className={s.clipTrim}
          data-edge="out"
          onPointerDown={(e) => {
            e.stopPropagation();
            handleItemPointerDown(e, 'clip', clip.id, clip.startSec, clip.durationSec, 'trim-out');
          }}
          title="Изменить длительность (ресайз)"
        />
      </div>
    );
  };


  return (
    <div
      className={`${s.container} ${embedded ? s.embedded : ''}`}
      onClick={() => selectClip(null)}
    >
      <div className={s.topBar} onClick={(e) => e.stopPropagation()}>
        <div className={s.transport}>
          {embedded ? null : (
            <button
              type="button"
              className={s.playBtn}
              onClick={d.togglePlay}
              disabled={!hasVideoSource && d.clips.length === 0}
              title={d.playing ? 'Пауза (Пробел)' : 'Воспроизведение (Пробел)'}
            >
              {d.playing ? '❚❚ Пауза' : '▶ Воспроизвести'}
            </button>
          )}
          <div className={s.timecodeBadge}>
            {formatTimecode(d.playhead)} / {formatTimecode(totalSec)}
          </div>
          <div className={s.zoomGroup} title="Масштаб шкалы">
            <button type="button" className={s.zoomBtn} onClick={() => zoomBy(1 / 1.25)} title="Отдалить">−</button>
            <button
              type="button"
              className={s.zoomBtn}
              data-on={atFitZoom}
              onClick={zoomFit}
              title="Весь ролик в ширину окна"
            >
              Весь ролик
            </button>
            <button
              type="button"
              className={s.zoomBtn}
              data-on={!atFitZoom && Math.abs(pxPerSec - readablePx) < Math.max(0.4, readablePx * 0.08)}
              onClick={zoomReadable}
              title="Короткие кадры остаются крупными, длинная запись прокручивается"
            >
              Кадры
            </button>
            <button type="button" className={s.zoomBtn} onClick={() => zoomBy(1.25)} title="Приблизить">+</button>
          </div>
        </div>

        <div className={s.actions}>
          {hasVideoSource ? (
            <button
              type="button"
              className={s.actionBtnPrimary}
              onClick={() => setExtractModalOpen(true)}
              disabled={d.extractAudioBusy}
              title="Отделить аудиодорожку от исходного видеофайла"
            >
              🎵 {d.extractAudioBusy ? 'Извлечение...' : 'Отделить звук'}
            </button>
          ) : null}

          <button
            type="button"
            className={s.actionBtn}
            onClick={() => {
              d.addCallout({
                startSec: d.playhead,
                endSec: d.playhead + 3,
                targetX: 50,
                targetY: 42,
                text: 'Нажмите сюда',
                type: 'arrow',
                size: 'm',
                animationIn: 'fade',
                animationOut: 'fade',
              });
            }}
            title="Добавить подсказку на playhead (3с)"
          >
            + Подсказка
          </button>
          {d.productStillPath ? (
            <button
              type="button"
              className={s.actionBtn}
              disabled={d.aiBusy}
              onClick={() => { void d.generateProductShotSet(); }}
              title="Четыре кадра одного товара (если задан still)"
            >
              {d.aiBusy ? (d.aiStatus || 'Съёмка…') : '4 кадра'}
            </button>
          ) : null}
        </div>
      </div>

      {extractSuccess ? (
        <div style={{ color: 'var(--color-success)', fontSize: 'var(--text-body-sm)', padding: '4px 8px' }}>
          ✓ {extractSuccess}
        </div>
      ) : null}
      {d.extractAudioError ? (
        <div style={{ color: 'var(--color-error)', fontSize: 'var(--text-body-sm)', padding: '4px 8px' }}>
          ⚠ {d.extractAudioError}
        </div>
      ) : null}

      <div
        className={s.minimap}
        title="Карта ролика — клик переносит окно"
        onPointerDown={(e) => {
          const el = scrollRef.current;
          if (!el || totalSec <= 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
          el.scrollLeft = Math.max(0, ratio * totalSec * pxPerSec - el.clientWidth / 2);
          setViewOrigin(el.scrollLeft);
        }}
      >
        {v1Clips.map((clip) => (
          <span
            key={clip.id}
            className={s.minimapClip}
            data-short={clip.durationSec <= 12}
            style={{
              left: `${(clip.startSec / Math.max(totalSec, 0.001)) * 100}%`,
              width: `${Math.max(0.6, (clip.durationSec / Math.max(totalSec, 0.001)) * 100)}%`,
            }}
          />
        ))}
        <span
          className={s.minimapWindow}
          style={{
            left: `${(viewOrigin / Math.max(bodyPx, 1)) * 100}%`,
            width: `${Math.min(100, (Math.max(viewportW, 1) / Math.max(bodyPx, 1)) * 100)}%`,
          }}
        />
      </div>

      {/* Split: fixed track labels | scrollable time canvas (no sticky left offset) */}
      <div
        className={s.timelineShell}
        data-scrubbing={draggingPlayhead || d.playing}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.labelRail} aria-hidden={false}>
          <div className={s.headerCol}>Таймлайн</div>
          <div className={s.trackHeader} data-lane="overlay">
            <div className={s.trackTitleWrap}>
              <span className={s.trackIcon}>🖼</span>
              <span className={s.trackLabel}>V2 Overlays</span>
            </div>
          </div>
          <div className={s.trackHeader} data-lane="video">
            <div className={s.trackTitleWrap}>
              <span className={s.trackIcon}>🎬</span>
              <span className={s.trackLabel}>V1 Video</span>
            </div>
          </div>
          <div className={s.trackHeader}>
            <div className={s.trackTitleWrap}>
              <span className={s.trackIcon}>🔊</span>
              <span className={s.trackLabel}>A1 Narration</span>
            </div>
          </div>
          <div className={s.trackHeader}>
            <div className={s.trackTitleWrap}>
              <span className={s.trackIcon}>🎵</span>
              <span className={s.trackLabel}>A2 Music</span>
            </div>
          </div>
          <div className={s.trackHeader}>
            <div className={s.trackTitleWrap}>
              <span className={s.trackIcon}>💬</span>
              <span className={s.trackLabel}>C1 Hints</span>
            </div>
          </div>
        </div>

        <div
          ref={scrollRef}
          className={s.timelineArea}
          data-can-scroll={canScrollX}
          onWheel={onTimelineWheel}
        >
          <div
            className={s.timelineCanvas}
            style={{ width: bodyPx, minWidth: bodyPx }}
          >
            <div
              className={s.playheadLine}
              style={{ left: playheadLeft }}
            >
              <div
                className={s.playheadThumb}
                onPointerDown={handlePlayheadPointerDown}
                title="Зажмите и тяните для перемотки времени"
              />
            </div>

            <div
              ref={rulerRef}
              className={s.rulerCanvas}
              onPointerDown={handlePlayheadPointerDown}
              title="Кликните или тяните по шкале времени для перемотки"
            >
              {ticks.map((t) => (
                <div key={t.sec} className={s.rulerTick} style={{ left: t.leftPx }}>
                  {formatTimecode(t.sec)}
                </div>
              ))}
            </div>

            <div
              ref={v2TrackRef}
              className={`${s.trackBody} ${s.trackBodyVideo}`}
              data-drop-target={dropTargetTrack === 'v2' || undefined}
            >
              {v2Clips.map((clip, index) => renderMixerClip(clip, index, 'still'))}
            </div>

            <div
              ref={v1TrackRef}
              className={`${s.trackBody} ${s.trackBodyVideo}`}
              data-drop-target={dropTargetTrack === 'v1' || undefined}
            >
              {v1Clips.length > 0 ? (
                v1Clips.map((clip, index) => renderMixerClip(clip, index, 'video'))
              ) : d.voiceoverSource ? (
                <div
                  className={`${s.clipBlock} ${s.clipVideo}`}
                  style={{ left: 0, width: bodyPx }}
                  title={`${d.voiceoverSource.name} (${formatTimecode(d.voiceoverSource.durationSec)})`}
                >
                  <span className={s.clipTitle}>{d.voiceoverSource.name}</span>
                  <span className={s.clipDuration}>{formatTimecode(d.voiceoverSource.durationSec)}</span>
                </div>
              ) : null}
            </div>

            <div className={s.trackBody}>
              {a1Clips.length > 0 ? (
                a1Clips.map((clip, index) => renderMixerClip(clip, index, 'audioOriginal'))
              ) : hasVideoSource ? (
                <div
                  className={`${s.clipBlock} ${s.clipAudioOriginal}`}
                  style={{
                    left: 0,
                    width: Math.max(
                      8,
                      Math.min(bodyPx, (d.voiceoverSource?.durationSec ?? totalSec) * pxPerSec),
                    ),
                    opacity: 0.7,
                  }}
                  title="Original video audio"
                >
                  <span className={s.clipTitle}>Narration</span>
                  <span className={s.clipDuration}>
                    {formatTimecode(Math.min(d.voiceoverSource?.durationSec ?? 0, totalSec))}
                  </span>
                </div>
              ) : null}
            </div>

            <div className={s.trackBody}>
              {a2Clips.map((clip, index) => renderMixerClip(clip, index, 'audioExtracted'))}
            </div>

            <div className={s.trackBody}>
              {displayCallouts.map((callout) => {
                const isDragging = draggingItem?.type === 'callout' && draggingItem.id === callout.id;
                const isSelected = selectedItem?.id === callout.id || d.selectedCallout === callout.id;
                const duration = hintDuration(callout);
                const tone = hintLaneTone(callout.type);

                return (
                  <div
                    key={callout.id}
                    className={`${s.clipBlock} ${s.clipCallout} ${isDragging ? s.clipDragging : ''}`}
                    data-selected={isSelected}
                    data-hint-tone={tone}
                    data-shoving={Boolean(previewCallouts) && !isDragging}
                    style={laneStyle(callout.startSec, duration, pxPerSec)}
                    onPointerDown={(e) =>
                      handleItemPointerDown(e, 'callout', callout.id, callout.startSec, duration, 'move')
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedItem({ type: 'callout', id: callout.id });
                      d.setSelectedCallout(callout.id);
                      d.setSelectedClip(null);
                      d.seekTo(callout.startSec);
                    }}
                    title={`${hintTypeLabel(callout.type)} · ${callout.text}`}
                  >
                    <span
                      className={s.clipTrim}
                      data-edge="in"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        handleItemPointerDown(e, 'callout', callout.id, callout.startSec, duration, 'trim-in');
                      }}
                      title="Trim in"
                    />
                    <span className={s.clipTitle}>{callout.text || hintTypeLabel(callout.type)}</span>
                    <span className={s.clipDuration}>
                      {isDragging && draggingItem?.mode === 'move'
                        ? formatTimecode(callout.startSec)
                        : `${Math.round(duration * 10) / 10}s`}
                    </span>
                    <button
                      type="button"
                      className={s.clipDeleteBtn}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        d.removeCallout(callout.id);
                        if (selectedItem?.id === callout.id) setSelectedItem(null);
                      }}
                      title="Удалить"
                    >
                      ✕
                    </button>
                    <span
                      className={s.clipTrim}
                      data-edge="out"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        handleItemPointerDown(e, 'callout', callout.id, callout.startSec, duration, 'trim-out');
                      }}
                      title="Trim out"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Audio Extraction Modal Dialogue */}
      {extractModalOpen ? (
        <div className={s.modalOverlay} onClick={() => setExtractModalOpen(false)}>
          <div className={s.modalBox} onClick={(e) => e.stopPropagation()}>
            <header className={s.modalHead}>
              <h3 className={s.modalTitle}>🎵 Отделение звуковой дорожки</h3>
              <p className={s.modalSubtitle}>
                Извлечение аудио из «{d.voiceoverSource?.name}» для последующей обработки, наложения эффектов или замены на свою озвучку.
              </p>
            </header>

            <div className={s.optionList}>
              <label
                className={s.optionCard}
                data-selected={extractMode === 'both'}
                onClick={() => setExtractMode('both')}
              >
                <div className={s.radioCircle}>
                  {extractMode === 'both' ? <div className={s.radioDot} /> : null}
                </div>
                <div className={s.optionText}>
                  <div className={s.optionHeading}>Извлечь аудио и заглушить видео (Рекомендуется)</div>
                  <div className={s.optionDesc}>
                    Сохраняет звук в WAV-файл на дорожке A2, а видеофайл заменяет на версию без звука. Идеально для замены голоса на новый или раздельной настройки громкости.
                  </div>
                </div>
              </label>

              <label
                className={s.optionCard}
                data-selected={extractMode === 'audio_only'}
                onClick={() => setExtractMode('audio_only')}
              >
                <div className={s.radioCircle}>
                  {extractMode === 'audio_only' ? <div className={s.radioDot} /> : null}
                </div>
                <div className={s.optionText}>
                  <div className={s.optionHeading}>Только извлечь звук в отдельный WAV</div>
                  <div className={s.optionDesc}>
                    Создает аудиофайл WAV и добавляет его в проект, не изменяя исходное видео.
                  </div>
                </div>
              </label>

              <label
                className={s.optionCard}
                data-selected={extractMode === 'mute_video'}
                onClick={() => setExtractMode('mute_video')}
              >
                <div className={s.radioCircle}>
                  {extractMode === 'mute_video' ? <div className={s.radioDot} /> : null}
                </div>
                <div className={s.optionText}>
                  <div className={s.optionHeading}>Создать версию видео без звука (Muted)</div>
                  <div className={s.optionDesc}>
                    Быстро удаляет аудиодорожку из видеофайла без пережатия видеопотока.
                  </div>
                </div>
              </label>
            </div>

            <footer className={s.modalFooter}>
              <button
                type="button"
                className={s.actionBtn}
                onClick={() => setExtractModalOpen(false)}
                disabled={d.extractAudioBusy}
              >
                Отмена
              </button>
              <button
                type="button"
                className={s.actionBtnPrimary}
                onClick={onConfirmExtract}
                disabled={d.extractAudioBusy}
              >
                {d.extractAudioBusy ? 'Выполняется извлечение...' : 'Выполнить'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
