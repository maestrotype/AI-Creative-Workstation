import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
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
  
  // Dragging state for card position
  const [draggingCard, setDraggingCard] = useState<{
    id: string;
    startX: number;
    startY: number;
    startBoxX: number;
    startBoxY: number;
  } | null>(null);

  // Resizing state for card dimensions
  const [resizingCard, setResizingCard] = useState<{
    id: string;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  // Quick settings popup for the active callout
  const [settingsOpenId, setSettingsOpenId] = useState<string | null>(null);

  // Video view mode: 'fit' (16:9 contained) or 'fill' (fill block without letterboxing)
  const [viewMode, setViewMode] = useState<'fit' | 'fill'>('fit');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const activeCallouts = useMemo(() => {
    if (!active) return [];
    return calloutsActiveAt(d.callouts ?? [], d.playhead);
  }, [active, d.callouts, d.playhead]);

  // Handle fullscreen changes
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen?.().catch(() => {});
    } else {
      await document.exitFullscreen?.().catch(() => {});
    }
  };

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
      boxW: 240,
      text,
      theme: 'accent',
      shape: 'rounded',
      pulse: true,
    });

    // Return to view mode so user can interact with the created callout
    setMode('view');
  };

  // Dragging card start
  const handleCardMouseDown = (e: MouseEvent, callout: Callout) => {
    if ((e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'BUTTON') {
      return;
    }
    setDraggingCard({
      id: callout.id,
      startX: e.clientX,
      startY: e.clientY,
      startBoxX: callout.boxX,
      startBoxY: callout.boxY,
    });
  };

  // Resizing card start
  const handleResizeMouseDown = (e: MouseEvent, callout: Callout) => {
    e.stopPropagation();
    e.preventDefault();
    setResizingCard({
      id: callout.id,
      startX: e.clientX,
      startY: e.clientY,
      startW: callout.boxW || 240,
      startH: callout.boxH || 80,
    });
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;

      // Handle card resizing
      if (resizingCard) {
        const deltaX = e.clientX - resizingCard.startX;
        const deltaY = e.clientY - resizingCard.startY;
        const newW = Math.max(140, Math.min(650, resizingCard.startW + deltaX));
        const newH = Math.max(50, Math.min(450, resizingCard.startH + deltaY));
        d.updateCallout(resizingCard.id, {
          boxW: Math.round(newW),
          boxH: Math.round(newH),
        });
        return;
      }

      // Handle card dragging
      if (draggingCard) {
        const rect = containerRef.current.getBoundingClientRect();
        const deltaXPct = ((e.clientX - draggingCard.startX) / rect.width) * 100;
        const deltaYPct = ((e.clientY - draggingCard.startY) / rect.height) * 100;

        const newX = Math.max(1, Math.min(85, draggingCard.startBoxX + deltaXPct));
        const newY = Math.max(1, Math.min(85, draggingCard.startBoxY + deltaYPct));

        d.updateCallout(draggingCard.id, {
          boxX: Math.round(newX * 10) / 10,
          boxY: Math.round(newY * 10) / 10,
        });
      }
    },
    [draggingCard, resizingCard, d],
  );

  const handleMouseUp = useCallback(() => {
    setDraggingCard(null);
    setResizingCard(null);
  }, []);

  return (
    <div className={s.wrapper} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
      {/* Top Toolbar */}
      <div className={s.toolbar}>
        <div className={s.leftControls}>
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
            <span className={s.statsLabel}>
              Подсказок: {(d.callouts ?? []).length} | Активных сейчас: {activeCallouts.length}
            </span>
          )}
        </div>

        {/* Right Controls: Video display controls */}
        <div className={s.viewControls}>
          <button
            type="button"
            className={s.viewCtrlBtn}
            onClick={() => setViewMode(viewMode === 'fit' ? 'fill' : 'fit')}
            title={viewMode === 'fit' ? 'Заполнить видео во весь блок (без полос)' : 'По размеру (сохранять 16:9)'}
          >
            {viewMode === 'fit' ? '⤢ Заполнить блок' : '⤡ По размеру'}
          </button>
          <button
            type="button"
            className={s.viewCtrlBtn}
            onClick={toggleFullscreen}
            title="Просмотр во весь экран (Escape для выхода)"
          >
            {isFullscreen ? '⛶ Обычный вид' : '⛶ Во весь экран'}
          </button>
        </div>
      </div>

      {/* Video Container with Overlays */}
      <div
        ref={containerRef}
        className={s.previewContainer}
        data-view-mode={viewMode}
      >
        {/* Underneath: The Video Player */}
        {children}

        {/* Floating exit fullscreen button when fullscreen */}
        {isFullscreen ? (
          <button
            type="button"
            className={s.fullscreenExitBtn}
            onClick={toggleFullscreen}
          >
            ✕ Выйти из полноэкранного режима
          </button>
        ) : null}

        {/* Overlay Canvas */}
        <div
          className={s.overlayCanvas}
          data-mode={mode}
          onClick={handleCanvasClick}
        >
          {/* SVG layer for connector arrows */}
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
                id="arrowhead-green"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#10b981" />
              </marker>
              <marker
                id="arrowhead-warning"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#f59e0b" />
              </marker>
            </defs>

            {activeCallouts.map((callout) => {
              if (callout.arrowStyle === 'none') return null;
              const startX = `${callout.boxX + 15}%`;
              const startY = `${callout.boxY + 5}%`;
              const endX = `${callout.targetX}%`;
              const endY = `${callout.targetY}%`;

              const strokeColor =
                callout.theme === 'success'
                  ? '#10b981'
                  : callout.theme === 'warning'
                    ? '#f59e0b'
                    : 'var(--color-accent, #3b82f6)';

              const markerId =
                callout.theme === 'success'
                  ? 'url(#arrowhead-green)'
                  : callout.theme === 'warning'
                    ? 'url(#arrowhead-warning)'
                    : 'url(#arrowhead-accent)';

              return (
                <g key={`arrow-${callout.id}`}>
                  {/* Subtle shadow path */}
                  <path
                    d={`M ${callout.boxX + 15} ${callout.boxY + 5} Q ${(callout.boxX + 15 + callout.targetX) / 2} ${callout.boxY} ${callout.targetX} ${callout.targetY}`}
                    fill="none"
                    stroke="rgba(0,0,0,0.5)"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  />
                  {/* Main connector line */}
                  <line
                    x1={startX}
                    y1={startY}
                    x2={endX}
                    y2={endY}
                    stroke={strokeColor}
                    strokeWidth="2"
                    strokeDasharray={callout.arrowStyle === 'straight' ? undefined : '4 3'}
                    markerEnd={markerId}
                  />
                </g>
              );
            })}
          </svg>

          {/* Active Callouts: Pins & Badges */}
          {activeCallouts.map((callout) => {
            const isSettingsOpen = settingsOpenId === callout.id;
            return (
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
                  data-shape={callout.shape || 'rounded'}
                  style={{
                    left: `${callout.boxX}%`,
                    top: `${callout.boxY}%`,
                    width: callout.boxW ? `${callout.boxW}px` : undefined,
                    height: callout.boxH ? `${callout.boxH}px` : undefined,
                  }}
                  onMouseDown={(e) => handleCardMouseDown(e, callout)}
                >
                  <div className={s.badgeHeader}>
                    <span className={s.badgeTimecode}>
                      {formatTimecode(callout.startSec)} – {formatTimecode(callout.endSec)}
                    </span>
                    <div className={s.badgeHeaderActions}>
                      <button
                        type="button"
                        className={s.badgeSettingsBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSettingsOpenId(isSettingsOpen ? null : callout.id);
                        }}
                        title="Настройки стиля подсказки (цвет, форма, стрелка)"
                      >
                        ⚙
                      </button>
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
                  </div>

                  <textarea
                    className={s.badgeInput}
                    rows={2}
                    value={callout.text}
                    onChange={(e) => d.updateCallout(callout.id, { text: e.target.value })}
                    placeholder="Текст подсказки..."
                    onClick={(e) => e.stopPropagation()}
                  />

                  {/* Settings Popover inside the Card */}
                  {isSettingsOpen ? (
                    <div className={s.settingsPopover} onClick={(e) => e.stopPropagation()}>
                      <div className={s.settingsRow}>
                        <span className={s.settingsLabel}>Цвет:</span>
                        <div className={s.settingsOptions}>
                          {(['accent', 'success', 'warning', 'dark', 'info'] as const).map((t) => (
                            <button
                              key={t}
                              type="button"
                              className={s.themeChip}
                              data-theme={t}
                              data-active={callout.theme === t}
                              onClick={() => d.updateCallout(callout.id, { theme: t })}
                            >
                              {t === 'accent' ? 'Синий' : t === 'success' ? 'Зеленый' : t === 'warning' ? 'Оранжевый' : t === 'info' ? 'Фиол' : 'Темный'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className={s.settingsRow}>
                        <span className={s.settingsLabel}>Форма:</span>
                        <div className={s.settingsOptions}>
                          {([
                            { id: 'rounded', label: 'Скругл.' },
                            { id: 'square', label: 'Прямоуг.' },
                            { id: 'pill', label: 'Капсула' },
                            { id: 'circle', label: 'Круг' },
                          ] as const).map((sh) => (
                            <button
                              key={sh.id}
                              type="button"
                              className={s.shapeBtn}
                              data-active={(callout.shape || 'rounded') === sh.id}
                              onClick={() => d.updateCallout(callout.id, { shape: sh.id })}
                            >
                              {sh.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className={s.settingsRow}>
                        <span className={s.settingsLabel}>Стрелка:</span>
                        <div className={s.settingsOptions}>
                          {(['curved', 'straight', 'none'] as const).map((arr) => (
                            <button
                              key={arr}
                              type="button"
                              className={s.shapeBtn}
                              data-active={callout.arrowStyle === arr}
                              onClick={() => d.updateCallout(callout.id, { arrowStyle: arr })}
                            >
                              {arr === 'curved' ? 'Изогнутая' : arr === 'straight' ? 'Прямая' : 'Без'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className={s.settingsRow}>
                        <span className={s.settingsLabel}>Пульс:</span>
                        <button
                          type="button"
                          className={s.shapeBtn}
                          data-active={callout.pulse}
                          onClick={() => d.updateCallout(callout.id, { pulse: !callout.pulse })}
                        >
                          {callout.pulse ? 'Включен' : 'Выключен'}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {/* Corner Resize Handle */}
                  <div
                    className={s.resizeHandle}
                    onMouseDown={(e) => handleResizeMouseDown(e, callout)}
                    title="Потяните, чтобы изменить размер карточки"
                  >
                    ⌟
                  </div>
                </div>
              </div>
            );
          })}
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
                <option value="info">Фиолетовый</option>
              </select>

              <select
                className={s.itemThemeSelect}
                value={callout.shape || 'rounded'}
                onChange={(e) => d.updateCallout(callout.id, { shape: e.target.value as Callout['shape'] })}
              >
                <option value="rounded">Скруглённая</option>
                <option value="square">Прямоугольная</option>
                <option value="pill">Капсула</option>
                <option value="circle">Круглая</option>
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
