import { useState, useRef, useMemo, useEffect } from 'react';
import type { ReactNode, MouseEvent } from 'react';

import { useDirector } from './DirectorBoard';
import { calloutsActiveAt } from '../model/callout';
import { HintOverlay } from './HintOverlay';
import s from './CalloutEditor.module.css';

interface CalloutEditorProps {
  children: ReactNode;
  active?: boolean;
  compactChrome?: boolean;
  onPlacementModeChange?: (placing: boolean) => void;
  onEraseRegion?: (box: { x: number; y: number; w: number; h: number }) => void;
  erasing?: boolean;
}

const QUICK_PRESETS = [
  'Нажмите сюда',
  'Кликните здесь',
  'Click here',
  'See details',
  'Главное меню',
];

export function CalloutEditor({
  children,
  active = true,
  compactChrome = false,
  onPlacementModeChange,
  onEraseRegion,
  erasing = false,
}: CalloutEditorProps): ReactNode {
  const d = useDirector();
  const [mode, setMode] = useState<'view' | 'add' | 'erase'>('view');
  const [eraseBox, setEraseBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const eraseStart = useRef<{ x: number; y: number } | null>(null);
  const [calloutText, setCalloutText] = useState(QUICK_PRESETS[0]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const activeHints = useMemo(() => {
    if (!active || !d.showHints) return [];
    return calloutsActiveAt(d.callouts ?? [], d.playhead);
  }, [active, d.showHints, d.callouts, d.playhead]);

  const editHints = useMemo(() => {
    if (!active || !d.showHints) return [];
    if (d.playing) return activeHints;
    // When paused: show active-at-playhead + selected (so you can edit off-range)
    const selected = (d.callouts ?? []).find((c) => c.id === d.selectedCallout);
    const list = [...activeHints];
    if (selected && !list.some((c) => c.id === selected.id)) list.push(selected);
    return list;
  }, [active, d.showHints, d.playing, activeHints, d.callouts, d.selectedCallout]);

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  useEffect(() => {
    onPlacementModeChange?.(mode === 'add');
  }, [mode, onPlacementModeChange]);

  const enterAddMode = () => setMode('add');
  const enterViewMode = () => setMode('view');

  const toggleFullscreen = async () => {
    if (!screenRef.current) return;
    if (!document.fullscreenElement) {
      await screenRef.current.requestFullscreen?.().catch(() => {});
    } else {
      await document.exitFullscreen?.().catch(() => {});
    }
  };

  const pointInFrame = (e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
    };
  };

  const handleCanvasClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!active || mode !== 'add' || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    d.addCallout({
      startSec: d.playhead,
      endSec: d.playhead + 3,
      targetX: Math.round(x * 10) / 10,
      targetY: Math.round(y * 10) / 10,
      text: calloutText.trim() || QUICK_PRESETS[0],
      type: 'pointer',
      arrowStyle: 'straight',
      size: 'm',
      animationIn: 'fade',
      animationOut: 'fade',
    });
    enterViewMode();
  };

  if (!active) return <>{children}</>;

  return (
    <div
      className={s.wrapper}
      data-compact={compactChrome || undefined}
      data-placing={mode === 'add' || undefined}
    >
      <div ref={screenRef} className={s.previewContainer}>
        <div
          ref={containerRef}
          className={s.frame}
          data-aspect={d.filmFormat === 'shorts' ? 'shorts' : 'wide'}
        >
          {children}

          <div
            className={s.overlayCanvas}
            data-mode={mode}
            onClick={handleCanvasClick}
            onPointerDown={(e) => {
              if (mode !== 'erase') return;
              const point = pointInFrame(e);
              if (!point) return;
              eraseStart.current = point;
              setEraseBox({ x: point.x, y: point.y, w: 0, h: 0 });
            }}
            onPointerMove={(e) => {
              const start = eraseStart.current;
              if (mode !== 'erase' || !start) return;
              const point = pointInFrame(e);
              if (!point) return;
              setEraseBox({
                x: Math.min(start.x, point.x),
                y: Math.min(start.y, point.y),
                w: Math.abs(point.x - start.x),
                h: Math.abs(point.y - start.y),
              });
            }}
            onPointerUp={() => {
              const box = eraseBox;
              eraseStart.current = null;
              if (mode !== 'erase' || !box || box.w < 1 || box.h < 1) return;
              const frame = containerRef.current?.getBoundingClientRect();
              const video = containerRef.current?.querySelector('video');
              let region = { x: box.x / 100, y: box.y / 100, w: box.w / 100, h: box.h / 100 };
              if (frame && video && video.videoWidth > 0 && video.videoHeight > 0) {
                const scale = Math.min(frame.width / video.videoWidth, frame.height / video.videoHeight);
                const dispW = video.videoWidth * scale;
                const dispH = video.videoHeight * scale;
                const offX = (frame.width - dispW) / 2;
                const offY = (frame.height - dispH) / 2;
                const left = box.x / 100 * frame.width;
                const top = box.y / 100 * frame.height;
                region = {
                  x: Math.max(0, Math.min(1, (left - offX) / dispW)),
                  y: Math.max(0, Math.min(1, (top - offY) / dispH)),
                  w: Math.max(0.01, Math.min(1, (box.w / 100 * frame.width) / dispW)),
                  h: Math.max(0.01, Math.min(1, (box.h / 100 * frame.height) / dispH)),
                };
              }
              onEraseRegion?.(region);
              setEraseBox(null);
              setMode('view');
            }}
          >
            {eraseBox && eraseBox.w > 0 ? (
              <span
                className={s.eraseBox}
                style={{ left: `${eraseBox.x}%`, top: `${eraseBox.y}%`, width: `${eraseBox.w}%`, height: `${eraseBox.h}%` }}
              />
            ) : null}
            {d.showHints ? (
              <HintOverlay
                hints={editHints}
                playhead={d.playhead}
                playing={d.playing}
                selectedId={d.selectedCallout}
                editable={!d.playing && mode === 'view'}
                onSelect={(id) => {
                  d.setSelectedCallout(id);
                  d.setSelectedClip(null);
                }}
                onMoveBox={(id, x, y) => {
                  d.updateCallout(id, { boxX: x, boxY: y });
                }}
                onMoveTarget={(id, x, y) => {
                  d.updateCallout(id, { targetX: x, targetY: y });
                }}
              />
            ) : null}
          </div>
        </div>
        <div className={s.chrome}>
            <div className={s.modeToggleGroup}>
              <button type="button" className={s.modeBtn} data-active={mode === 'view'} onClick={enterViewMode}>
                Кадр
              </button>
              <button
                type="button"
                className={s.modeBtn}
                data-active={mode === 'add'}
                onClick={enterAddMode}
                title="Кликните по месту на кадре. Текст встанет рядом и укажет на эту точку."
              >
                Метка
              </button>
            </div>
            {mode === 'add' ? (
              <input
                type="text"
                className={s.calloutInput}
                value={calloutText}
                onChange={(e) => setCalloutText(e.target.value)}
                placeholder="Текст"
                maxLength={120}
              />
            ) : (
              <span className={s.statsLabel}>{(d.callouts ?? []).length}</span>
            )}
            <button
              type="button"
              className={s.modeBtn}
              data-active={mode === 'erase'}
              disabled={erasing}
              title="Обведите кнопки в тот момент, где они видны. Сотрётся только этот кусок, не весь ролик."
              onClick={() => setMode(mode === 'erase' ? 'view' : 'erase')}
            >
              {erasing ? 'Стираю…' : 'Стереть'}
            </button>
            <button
              type="button"
              className={s.viewCtrlBtn}
              data-on={d.showHints}
              onClick={() => d.setShowHints(!d.showHints)}
              title="Показывать подсказки"
            >
              Подсказки
            </button>
            <button type="button" className={s.viewCtrlBtn} onClick={toggleFullscreen} title="На весь экран">
              {isFullscreen ? 'Свернуть' : 'Экран'}
            </button>
          </div>
      </div>
    </div>
  );
}
