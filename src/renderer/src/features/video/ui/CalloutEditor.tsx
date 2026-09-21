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
}: CalloutEditorProps): ReactNode {
  const d = useDirector();
  const [mode, setMode] = useState<'view' | 'add'>('view');
  const [calloutText, setCalloutText] = useState(QUICK_PRESETS[0]);
  const [viewMode, setViewMode] = useState<'fit' | 'fill'>('fit');
  const [isFullscreen, setIsFullscreen] = useState(false);
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
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen?.().catch(() => {});
    } else {
      await document.exitFullscreen?.().catch(() => {});
    }
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
      type: 'accent',
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
      <div className={s.toolbar}>
        <div className={s.leftControls}>
          <div className={s.modeToggleGroup}>
            <button type="button" className={s.modeBtn} data-active={mode === 'view'} onClick={enterViewMode}>
              Просмотр
            </button>
            <button
              type="button"
              className={s.modeBtn}
              data-active={mode === 'add'}
              onClick={enterAddMode}
              title="Кликните по кадру, чтобы поставить подсказку"
            >
              + Указать на кадре
            </button>
          </div>

          {mode === 'add' ? (
            <div className={s.presetsRow}>
              <input
                type="text"
                className={s.calloutInput}
                value={calloutText}
                onChange={(e) => setCalloutText(e.target.value)}
                placeholder="Текст подсказки..."
                maxLength={120}
              />
              <div className={s.presetChips}>
                {QUICK_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={s.presetBtn}
                    data-active={calloutText === preset}
                    onClick={() => setCalloutText(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <span className={s.statsLabel}>
              Hints: {(d.callouts ?? []).length}
              {activeHints.length > 0 ? ` · now ${activeHints.length}` : ''}
            </span>
          )}
        </div>

        <div className={s.viewControls}>
          <button
            type="button"
            className={s.viewCtrlBtn}
            data-on={d.showHints}
            onClick={() => d.setShowHints(!d.showHints)}
            title="Показывать подсказки на превью"
          >
            {d.showHints ? 'Hints on' : 'Hints off'}
          </button>
          <button
            type="button"
            className={s.viewCtrlBtn}
            onClick={() => setViewMode(viewMode === 'fit' ? 'fill' : 'fit')}
          >
            {viewMode === 'fit' ? 'Заполнить блок' : 'По размеру'}
          </button>
          <button type="button" className={s.viewCtrlBtn} onClick={toggleFullscreen}>
            {isFullscreen ? 'Обычный вид' : 'Во весь экран'}
          </button>
        </div>
      </div>

      <div ref={containerRef} className={s.previewContainer} data-view-mode={viewMode}>
        {children}

        {isFullscreen ? (
          <button type="button" className={s.fullscreenExitBtn} onClick={toggleFullscreen}>
            ✕ Выйти
          </button>
        ) : null}

        <div
          className={s.overlayCanvas}
          data-mode={mode}
          onClick={handleCanvasClick}
        >
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
              onMove={(id, x, y) => {
                d.updateCallout(id, { targetX: x, targetY: y, boxX: x, boxY: y });
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
