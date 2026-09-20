import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import type { CSSProperties, ReactNode, PointerEvent, WheelEvent } from 'react';
import { useDirector } from './DirectorBoard';
import { formatTimecode } from '../model/videoAnalysis';
import {
  moveClipWithRipple,
  moveTimedRangeWithRipple,
  sanitizeClips,
  unstackAllTracks,
  type TimelineClip,
} from '../model/directorTimeline';
import type { Callout } from '../model/callout';
import s from './TrackMixer.module.css';

type ExtractMode = 'both' | 'audio_only' | 'mute_video';

const LABEL_W = 140;
/** Shortest clip should be at least this wide after auto-zoom (NLE-style). */
const READABLE_CLIP_PX = 40;

interface DraggingState {
  type: 'clip' | 'callout';
  mode: 'move' | 'trim-in' | 'trim-out';
  id: string;
  startX: number;
  origStartSec: number;
  durationSec: number;
  origSourceIn: number;
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

function pickRulerStep(pxPerSec: number): number {
  const raw = 72 / Math.max(pxPerSec, 0.001);
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((step) => step >= raw) ?? Math.max(raw, 1);
}

export function TrackMixer(): ReactNode {
  const d = useDirector();
  const [extractModalOpen, setExtractModalOpen] = useState(false);
  const [extractMode, setExtractMode] = useState<ExtractMode>('both');
  const [extractSuccess, setExtractSuccess] = useState<string | null>(null);

  // Selected item on the timeline (can be deleted via Backspace/Delete key or button)
  const [selectedItem, setSelectedItem] = useState<{ type: 'clip' | 'callout'; id: string } | null>(null);

  // Dragging state for moving clips & callouts along timeline
  const [draggingItem, setDraggingItem] = useState<DraggingState | null>(null);
  /** Live layout preview while dragging — neighbors shove aside before commit. */
  const [previewClips, setPreviewClips] = useState<TimelineClip[] | null>(null);
  const [previewCallouts, setPreviewCallouts] = useState<Callout[] | null>(null);
  const baselineClipsRef = useRef<TimelineClip[] | null>(null);
  const baselineCalloutsRef = useRef<Callout[] | null>(null);
  const previewClipsRef = useRef<TimelineClip[] | null>(null);
  const previewCalloutsRef = useRef<Callout[] | null>(null);

  // Dragging state for the playhead scrubber needle
  const [draggingPlayhead, setDraggingPlayhead] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const [viewportW, setViewportW] = useState(480);
  /** Mixer owns its zoom so Director "fit" effect cannot crush short clips again. */
  const [mixerPx, setMixerPx] = useState<number | null>(null);

  const displayClips = useMemo(
    () => unstackAllTracks(previewClips ?? d.clips),
    [previewClips, d.clips],
  );
  const displayCallouts = previewCallouts ?? d.callouts ?? [];

  // Calculate timeline bounds
  const totalSec = useMemo(() => {
    const clipEnds = displayClips.map((c) => c.startSec + c.durationSec);
    const sourceSec = d.voiceoverSource?.durationSec ?? 0;
    const calloutEnds = displayCallouts.map((c) => c.endSec);
    const maxEnd = Math.max(10, ...clipEnds, sourceSec, ...calloutEnds);
    return Math.ceil(maxEnd);
  }, [displayClips, d.voiceoverSource, displayCallouts]);

  const fitPx = Math.max(1.2, (Math.max(viewportW, 240) - LABEL_W - 24) / Math.max(totalSec, 1));
  const maxMixerPx = Math.max(64, fitPx * 16);
  const minMixerPx = fitPx;

  const readablePx = useMemo(() => {
    const onV1 = displayClips.filter((c) => c.track === 'v1');
    if (onV1.length === 0) return fitPx;
    const minDur = Math.min(...onV1.map((c) => Math.max(0.05, c.durationSec)));
    if (fitPx * minDur >= READABLE_CLIP_PX * 0.9) return fitPx;
    return Math.min(maxMixerPx, Math.max(fitPx, READABLE_CLIP_PX / minDur));
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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => setViewportW(el.clientWidth);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Prefer readable zoom once viewport is known (scroll sideways — don't crush clips).
  useEffect(() => {
    if (viewportW < 220) return;
    setMixerPx((prev) => (prev == null ? readablePx : prev));
  }, [viewportW, readablePx]);

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

  const commitZoom = (next: number) => {
    const clamped = Math.min(maxMixerPx, Math.max(minMixerPx, next));
    setMixerPx(clamped);
    d.setPxPerSec(clamped);
  };

  const zoomBy = (factor: number) => {
    commitZoom(pxPerSec * factor);
  };

  const zoomFit = () => {
    commitZoom(fitPx);
  };

  const zoomReadable = () => {
    commitZoom(readablePx);
  };

  const onTimelineWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const scroller = scrollRef.current;
    const prevPx = pxPerSec;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const next = Math.min(maxMixerPx, Math.max(minMixerPx, prevPx * factor));
    if (!scroller) {
      commitZoom(next);
      return;
    }
    const rect = scroller.getBoundingClientRect();
    const xInView = e.clientX - rect.left;
    const timeUnderCursor = (scroller.scrollLeft + xInView) / prevPx;
    commitZoom(next);
    requestAnimationFrame(() => {
      scroller.scrollLeft = Math.max(0, timeUnderCursor * next - xInView);
    });
  };

  const setSelectedClipDuration = (seconds: number) => {
    if (!selectedItem || selectedItem.type !== 'clip') return;
    const dur = Math.max(0.4, Math.round(seconds * 10) / 10);
    const baseline = d.clips.map((clip) => (
      clip.id === selectedItem.id
        ? { ...clip, durationSec: dur, autoLength: false }
        : { ...clip }
    ));
    d.replaceClips(unstackAllTracks(baseline));
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
    setDraggingItem({
      type,
      mode,
      id,
      startX: e.clientX,
      origStartSec: startSec,
      durationSec,
      origSourceIn: sourceIn,
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
          const nextDur = Math.max(0.4, Math.round((draggingItem.durationSec + deltaSec) * 10) / 10);
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
          const nextStart = Math.round((draggingItem.origStartSec + shift) * 10) / 10;
          const nextDur = Math.round((draggingItem.durationSec - shift) * 10) / 10;
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

        const maxStart = Math.max(0, totalSec * 2);
        const newStart = Math.max(0, Math.min(maxStart, draggingItem.origStartSec + deltaSec));
        const rounded = Math.round(newStart * 10) / 10;
        const next = moveClipWithRipple(base, draggingItem.id, rounded);
        previewClipsRef.current = next;
        setPreviewClips(next);
        setDraggingItem((prev) =>
          prev ? { ...prev, currentStartSec: rounded } : null,
        );
        return;
      }

      if (draggingItem.type === 'callout' && baselineCalloutsRef.current) {
        const maxStart = Math.max(0, totalSec - draggingItem.durationSec);
        const newStart = Math.max(0, Math.min(maxStart, draggingItem.origStartSec + deltaSec));
        const rounded = Math.round(newStart * 10) / 10;
        const next = moveTimedRangeWithRipple(
          baselineCalloutsRef.current,
          draggingItem.id,
          rounded,
        );
        previewCalloutsRef.current = next;
        setPreviewCallouts(next);
        setDraggingItem((prev) =>
          prev ? { ...prev, currentStartSec: rounded } : null,
        );
      }
    };

    const handlePointerUp = () => {
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
  const selectedClip = selectedItem?.type === 'clip'
    ? displayClips.find((c) => c.id === selectedItem.id) ?? null
    : null;
  const selectedBin = selectedClip?.binId
    ? d.bins.find((b) => b.id === selectedClip.binId) ?? null
    : null;
  const canEditDuration = Boolean(selectedClip);

  const renderMixerClip = (
    clip: TimelineClip,
    index: number,
    tone: 'video' | 'still' | 'audioOriginal' | 'audioExtracted',
  ) => {
    const isDragging = draggingItem?.type === 'clip' && draggingItem.id === clip.id;
    const isSelected = selectedItem?.id === clip.id;
    const toneClass = {
      video: s.clipVideo,
      still: s.clipStill,
      audioOriginal: s.clipAudioOriginal,
      audioExtracted: s.clipAudioExtracted,
    }[tone];
    const showDur = clip.durationSec;
    const bin = clip.binId ? d.bins.find((b) => b.id === clip.binId) ?? null : null;
    const isImage = bin?.kind === 'image';
    // For images: use file:// protocol so Electron can load local images in <img> tags
    const thumbSrc = isImage && bin?.path
      ? bin.path.startsWith('file://') ? bin.path : `file://${bin.path}`
      : null;

    return (
      <div
        key={clip.id}
        className={`${s.clipBlock} ${toneClass} ${isDragging ? s.clipDragging : ''} ${isImage ? s.clipIsImage : ''}`}
        data-selected={isSelected}
        data-alt={index % 2 === 1}
        data-narrow={(showDur * pxPerSec) < 56}
        data-shoving={Boolean(previewClips) && !isDragging}
        style={laneStyle(clip.startSec, showDur, pxPerSec)}
        onPointerDown={(e) =>
          handleItemPointerDown(e, 'clip', clip.id, clip.startSec, clip.durationSec, 'move')
        }
        onClick={(e) => {
          e.stopPropagation();
          setSelectedItem({ type: 'clip', id: clip.id });
        }}
        title={`${clip.label} · ${formatTimecode(clip.startSec)}–${formatTimecode(clip.startSec + showDur)} (${formatTimecode(showDur)}) — тяните край для длительности`}
      >
        {/* Trim handle: in */}
        <span
          className={s.clipTrim}
          data-edge="in"
          onPointerDown={(e) => {
            e.stopPropagation();
            handleItemPointerDown(e, 'clip', clip.id, clip.startSec, clip.durationSec, 'trim-in');
          }}
          title="Изменить начало / длительность"
        />

        {/* Image thumbnail background */}
        {thumbSrc ? (
          <img
            className={s.clipThumb}
            src={thumbSrc}
            alt=""
            draggable={false}
          />
        ) : null}

        {/* Clip content overlay */}
        <span className={s.clipContent}>
          {isImage ? (
            <>
              <span className={s.clipIcon}>🖼</span>
              <span className={s.clipTitle}>{clip.label}</span>
              <span className={s.clipDurBadge}>
                {isDragging && draggingItem?.mode === 'move'
                  ? formatTimecode(clip.startSec)
                  : `${Math.round(showDur * 10) / 10}s`}
              </span>
            </>
          ) : (
            <>
              <span className={s.clipTitle}>{clip.label}</span>
              <span className={s.clipDuration}>
                {isDragging && draggingItem?.mode === 'move'
                  ? formatTimecode(clip.startSec)
                  : formatTimecode(showDur)}
              </span>
            </>
          )}
        </span>

        {/* Delete button */}
        <button
          type="button"
          className={s.clipDeleteBtn}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            d.removeClip(clip.id);
            if (selectedItem?.id === clip.id) setSelectedItem(null);
          }}
          title="Удалить клип (Delete)"
        >
          ✕
        </button>

        {/* Trim handle: out */}
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
    <div className={s.container} onClick={() => setSelectedItem(null)}>
      {/* Top Bar with Transport Controls & Actions */}
      <div className={s.topBar} onClick={(e) => e.stopPropagation()}>
        <div className={s.transport}>
          <button
            type="button"
            className={s.playBtn}
            onClick={d.togglePlay}
            disabled={!hasVideoSource && d.clips.length === 0}
            title={d.playing ? 'Пауза (Пробел)' : 'Воспроизведение (Пробел)'}
          >
            {d.playing ? '❚❚ Пауза' : '▶ Воспроизвести'}
          </button>
          <div className={s.timecodeBadge}>
            {formatTimecode(d.playhead)} / {formatTimecode(totalSec)}
          </div>
          <div className={s.zoomGroup} title="Масштаб: клипы никогда не раздуваются сверх своего времени — приближайте шкалу">
            <button type="button" className={s.zoomBtn} onClick={() => zoomBy(1 / 1.25)} title="Отдалить">−</button>
            <button type="button" className={s.zoomBtn} onClick={zoomFit} title="Вписать всю шкалу (клипы могут стать узкими)">fit</button>
            <button type="button" className={s.zoomBtn} onClick={zoomReadable} title="Читаемый масштаб коротких клипов">1:1</button>
            <button type="button" className={s.zoomBtn} onClick={() => zoomBy(1.25)} title="Приблизить">+</button>
            <span className={s.zoomHint}>⌘/Ctrl + колёсико</span>
          </div>
        </div>

        <div className={s.actions}>
          {canEditDuration && selectedClip ? (
            <div className={s.durationGroup} title="Длительность выбранного клипа на шкале">
              <span className={s.durationLabel}>Длит.</span>
              <button
                type="button"
                className={s.zoomBtn}
                onClick={() => setSelectedClipDuration(selectedClip.durationSec - 0.5)}
                title="Короче на 0.5 с"
              >
                −
              </button>
              <input
                className={s.durationInput}
                type="number"
                min={0.4}
                step={0.1}
                value={Math.round(selectedClip.durationSec * 10) / 10}
                onChange={(e) => setSelectedClipDuration(Number(e.target.value) || 0.4)}
                onClick={(e) => e.stopPropagation()}
                title={selectedBin?.kind === 'image' ? 'Сколько секунд показывать изображение' : 'Длительность клипа'}
              />
              <span className={s.durationUnit}>с</span>
              <button
                type="button"
                className={s.zoomBtn}
                onClick={() => setSelectedClipDuration(selectedClip.durationSec + 0.5)}
                title="Длиннее на 0.5 с"
              >
                +
              </button>
              {selectedBin?.kind === 'image' ? (
                <>
                  <button type="button" className={s.zoomBtn} onClick={() => setSelectedClipDuration(2)} title="2 с">2</button>
                  <button type="button" className={s.zoomBtn} onClick={() => setSelectedClipDuration(4)} title="4 с">4</button>
                  <button type="button" className={s.zoomBtn} onClick={() => setSelectedClipDuration(8)} title="8 с">8</button>
                </>
              ) : null}
            </div>
          ) : null}

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
                endSec: Math.min(totalSec, d.playhead + 4),
                targetX: 50,
                targetY: 50,
                text: 'Нажмите здесь для перехода',
              });
            }}
            title="Добавить графическую подсказку-стрелку на текущей секунде"
          >
            💬 + Подсказка
          </button>
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

      {/* Split: fixed track labels | scrollable time canvas (no sticky left offset) */}
      <div
        className={s.timelineShell}
        data-scrubbing={draggingPlayhead || d.playing}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.labelRail} aria-hidden={false}>
          <div className={s.headerCol}>Таймлайн</div>
          <div className={s.trackHeader}>
            <div className={s.trackTitleWrap}>
              <span className={s.trackIcon}>🎬</span>
              <span className={s.trackLabel}>V1 Видео</span>
            </div>
          </div>
          <div className={s.trackHeader}>
            <div className={s.trackTitleWrap}>
              <span className={s.trackIcon}>🖼</span>
              <span className={s.trackLabel}>V2 Графика</span>
            </div>
          </div>
          <div className={s.trackHeader}>
            <div className={s.trackTitleWrap}>
              <span className={s.trackIcon}>🔊</span>
              <span className={s.trackLabel}>A1 Звук/Голос</span>
            </div>
          </div>
          <div className={s.trackHeader}>
            <div className={s.trackTitleWrap}>
              <span className={s.trackIcon}>🎵</span>
              <span className={s.trackLabel}>A2 Экстракт</span>
            </div>
          </div>
          <div className={s.trackHeader}>
            <div className={s.trackTitleWrap}>
              <span className={s.trackIcon}>💬</span>
              <span className={s.trackLabel}>C1 Подсказки</span>
            </div>
          </div>
        </div>

        <div
          ref={scrollRef}
          className={s.timelineArea}
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

            <div className={s.trackBody}>
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
              {v2Clips.map((clip, index) => renderMixerClip(clip, index, 'still'))}
            </div>

            <div className={s.trackBody}>
              {a1Clips.length > 0 ? (
                a1Clips.map((clip, index) => renderMixerClip(clip, index, 'audioOriginal'))
              ) : hasVideoSource ? (
                <div
                  className={`${s.clipBlock} ${s.clipAudioOriginal}`}
                  style={{ left: 0, width: bodyPx, opacity: 0.7 }}
                  title="Оригинальная звуковая дорожка видеофайла"
                >
                  <span className={s.clipTitle}>Оригинальный звук видео</span>
                  <span className={s.clipDuration}>{formatTimecode(d.voiceoverSource?.durationSec ?? 0)}</span>
                </div>
              ) : null}
            </div>

            <div className={s.trackBody}>
              {a2Clips.map((clip, index) => renderMixerClip(clip, index, 'audioExtracted'))}
            </div>

            <div className={s.trackBody}>
              {displayCallouts.map((callout) => {
                const isDragging = draggingItem?.type === 'callout' && draggingItem.id === callout.id;
                const isSelected = selectedItem?.id === callout.id;
                const duration = Math.max(0.5, callout.endSec - callout.startSec);
                const isActive = d.playhead >= callout.startSec && d.playhead <= callout.endSec;

                return (
                  <div
                    key={callout.id}
                    className={`${s.clipBlock} ${s.clipCallout} ${isDragging ? s.clipDragging : ''}`}
                    data-selected={isSelected}
                    data-shoving={Boolean(previewCallouts) && !isDragging}
                    style={{
                      ...laneStyle(callout.startSec, duration, pxPerSec),
                      outline: isSelected
                        ? '2px solid var(--color-accent)'
                        : isActive
                          ? '2px solid #fff'
                          : undefined,
                    }}
                    onPointerDown={(e) =>
                      handleItemPointerDown(e, 'callout', callout.id, callout.startSec, duration)
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedItem({ type: 'callout', id: callout.id });
                      d.seekTo(callout.startSec);
                    }}
                    title={`[${formatTimecode(callout.startSec)} - ${formatTimecode(callout.startSec + duration)}] ${callout.text} — перетащите для перемещения, ✕ или Del для удаления`}
                  >
                    <span className={s.clipTitle}>💬 {callout.text}</span>
                    <span className={s.clipDuration}>
                      {isDragging ? formatTimecode(callout.startSec) : `${Math.round(duration * 10) / 10}s`}
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
                      title="Удалить подсказку (Delete)"
                    >
                      ✕
                    </button>
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
