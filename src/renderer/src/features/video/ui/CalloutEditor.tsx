import { useState, useRef, useMemo, useCallback } from 'react';
import type { ReactNode, MouseEvent } from 'react';
import { useDirector } from './DirectorBoard';
import type { Callout } from '../model/callout';
import { calloutsActiveAt } from '../model/callout';
import { formatTimecode } from '../model/videoAnalysis';
import s from './CalloutEditor.module.css';

interface CalloutEditorProps {
  children: ReactNode;
  active?: boolean;
}

const QUICK_PRESETS = [
  'Нажмите сюда',
  'Кликните здесь',
  'Click here',
  'Tap to continue',
  'See details below',
  'Главное меню',
];

export function CalloutEditor({ children, active = true }: CalloutEditorProps): ReactNode {
  const d = useDirector();
  const [mode, setMode] = useState<'view' | 'add'>('view');
  const [calloutText, setCalloutText] = useState<string>(QUICK_PRESETS[0]);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const activeCallouts = useMemo(() => {
    if (!active) return [];
    return calloutsActiveAt(d.callouts ?? [], d.playhead);
  }, [active, d.callouts, d.playhead]);

  if (!active) {
    return <>{children}</>;
  }

  // Handle clicking on video frame in 'add' mode to drop a pin
  const handleCanvasClick = (e: MouseEvent<HTMLDivElement>) => {
    if (mode !== 'add' || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

    const text = calloutText.trim() || QUICK_PRESETS[0];

    d.addCallout({
      startSec: d.playhead,
      endSec: d.playhead + 4.0,
      targetX: Math.round(x * 10) / 10,
      targetY: Math.round(y * 10) / 10,
      text,
      theme: 'accent',
      pulse: true,
    });

    // Return to view mode so user can interact with the created callout
    setMode('view');
  };

  // Dragging logic for the floating callout card
  const handleCardMouseDown = (calloutId: string) => {
    setDraggingId(calloutId);
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!draggingId || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(2, Math.min(75, ((e.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(2, Math.min(80, ((e.clientY - rect.top) / rect.height) * 100));

      d.updateCallout(draggingId, {
        boxX: Math.round(x * 10) / 10,
        boxY: Math.round(y * 10) / 10,
      });
    },
    [draggingId, d],
  );

  const handleMouseUp = useCallback(() => {
    setDraggingId(null);
  }, []);

  return (
    <div className={s.wrapper} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
      {/* Top Toolbar */}
      <div className={s.toolbar}>
        <div className={s.modeToggleGroup}>
          <button
            type="button"
            className={s.modeBtn}
            data-active={mode === 'view'}
            onClick={() => setMode('view')}
          >
            👁 Просмотр
          </button>
          <button
            type="button"
            className={s.modeBtn}
            data-active={mode === 'add'}
            onClick={() => setMode('add')}
            title="Кликните на кадр видео, чтобы установить стрелку с подсказкой"
          >
            📍 + Указать на кадре
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
          <span style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-tertiary)' }}>
            Подсказок: {(d.callouts ?? []).length} | Активных сейчас: {activeCallouts.length}
          </span>
        )}
      </div>

      {/* Video Container with Overlays */}
      <div ref={containerRef} className={s.previewContainer}>
        {/* Underneath: The Video Player */}
        {children}

        {/* Overlay Canvas */}
        <div
          className={s.overlayCanvas}
          data-mode={mode}
          onClick={handleCanvasClick}
        >
          {/* SVG layer for curved connector arrows */}
          <svg className={s.svgLayer}>
            <defs>
              <marker
                id="arrowhead-accent"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="var(--color-accent, #3b82f6)" />
              </marker>
              <marker
                id="arrowhead-red"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#ff4757" />
              </marker>
            </defs>

            {activeCallouts.map((callout) => {
              if (callout.arrowStyle === 'none') return null;
              // Coordinates in percentage converted to SVG viewbox percentages
              const startX = `${callout.boxX + 15}%`;
              const startY = `${callout.boxY + 5}%`;
              const endX = `${callout.targetX}%`;
              const endY = `${callout.targetY}%`;

              return (
                <g key={`arrow-${callout.id}`}>
                  {/* Subtle shadow path */}
                  <path
                    d={`M ${callout.boxX + 15} ${callout.boxY + 5} Q ${(callout.boxX + 15 + callout.targetX) / 2} ${callout.boxY} ${callout.targetX} ${callout.targetY}`}
                    fill="none"
                    stroke="rgba(0,0,0,0.5)"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    style={{ transform: 'none' }}
                  />
                  {/* Glowing main arrow line */}
                  <line
                    x1={startX}
                    y1={startY}
                    x2={endX}
                    y2={endY}
                    stroke="var(--color-accent, #3b82f6)"
                    strokeWidth="2"
                    strokeDasharray="4 3"
                    markerEnd="url(#arrowhead-accent)"
                  />
                </g>
              );
            })}
          </svg>

          {/* Active Callouts: Pins & Badges */}
          {activeCallouts.map((callout) => (
            <div key={callout.id}>
              {/* Target Pin Point */}
              <div
                className={s.targetPin}
                style={{ left: `${callout.targetX}%`, top: `${callout.targetY}%` }}
                title={`Точка указателя [${callout.targetX}%, ${callout.targetY}%]`}
              >
                {callout.pulse ? <div className={s.radarPulse} /> : null}
              </div>

              {/* Floating Card Badge */}
              <div
                className={s.calloutBadge}
                data-theme={callout.theme}
                style={{ left: `${callout.boxX}%`, top: `${callout.boxY}%` }}
                onMouseDown={() => handleCardMouseDown(callout.id)}
              >
                <div className={s.badgeHeader}>
                  <span className={s.badgeTimecode}>
                    {formatTimecode(callout.startSec)} – {formatTimecode(callout.endSec)}
                  </span>
                  <button
                    type="button"
                    className={s.badgeCloseBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      d.removeCallout(callout.id);
                    }}
                    title="Удалить подсказку"
                  >
                    ✕
                  </button>
                </div>

                <textarea
                  className={s.badgeInput}
                  rows={2}
                  value={callout.text}
                  onChange={(e) => d.updateCallout(callout.id, { text: e.target.value })}
                  placeholder="Текст подсказки..."
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* List / Management Strip of All Callouts */}
      <div className={s.calloutList}>
        {(d.callouts ?? []).length === 0 ? (
          <p className={s.emptyHint}>
            Подсказок пока нет. Нажмите <strong>«📍 + Указать на кадре»</strong> в панели сверху и кликните по нужной области видео.
          </p>
        ) : (
          (d.callouts ?? []).map((callout) => (
            <div key={callout.id} className={s.calloutListItem}>
              <button
                type="button"
                className={s.itemTimeBtn}
                onClick={() => d.seekTo(callout.startSec)}
                title="Перейти к появлению подсказки"
              >
                {formatTimecode(callout.startSec)}
              </button>

              <input
                className={s.itemText}
                value={callout.text}
                onChange={(e) => d.updateCallout(callout.id, { text: e.target.value })}
                placeholder="Текст подсказки..."
              />

              <select
                className={s.itemThemeSelect}
                value={callout.theme}
                onChange={(e) => d.updateCallout(callout.id, { theme: e.target.value as Callout['theme'] })}
              >
                <option value="accent">Акцент (Синий)</option>
                <option value="success">Успех (Зеленый)</option>
                <option value="warning">Внимание (Оранжевый)</option>
                <option value="dark">Тёмный</option>
              </select>

              <button
                type="button"
                className={s.itemDeleteBtn}
                onClick={() => d.removeCallout(callout.id)}
                title="Удалить"
              >
                🗑
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
