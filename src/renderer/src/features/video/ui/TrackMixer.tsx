import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import type { ReactNode, PointerEvent } from 'react';
import { useDirector } from './DirectorBoard';
import { formatTimecode } from '../model/videoAnalysis';
import s from './TrackMixer.module.css';

type ExtractMode = 'both' | 'audio_only' | 'mute_video';

interface DraggingState {
  type: 'clip' | 'callout';
  id: string;
  startX: number;
  origStartSec: number;
  durationSec: number;
  currentStartSec: number;
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

  // Dragging state for the playhead scrubber needle
  const [draggingPlayhead, setDraggingPlayhead] = useState(false);

  const rulerRef = useRef<HTMLDivElement | null>(null);

  // Calculate timeline bounds
  const totalSec = useMemo(() => {
    const clipEnds = d.clips.map((c) => c.startSec + c.durationSec);
    const sourceSec = d.voiceoverSource?.durationSec ?? 0;
    const calloutEnds = (d.callouts ?? []).map((c) => c.endSec);
    const maxEnd = Math.max(10, ...clipEnds, sourceSec, ...calloutEnds);
    return Math.ceil(maxEnd);
  }, [d.clips, d.voiceoverSource, d.callouts]);

  const v1Clips = useMemo(() => d.clips.filter((c) => c.track === 'v1'), [d.clips]);
  const v2Clips = useMemo(() => d.clips.filter((c) => c.track === 'v2'), [d.clips]);
  const a1Clips = useMemo(() => d.clips.filter((c) => c.track === 'a1'), [d.clips]);
  const a2Clips = useMemo(() => d.clips.filter((c) => c.track === 'a2'), [d.clips]);

  // Helper to seek precisely from clientX coordinate relative to ruler
  const seekFromClientX = useCallback(
    (clientX: number) => {
      const rulerEl = rulerRef.current;
      if (!rulerEl) return;
      const rect = rulerEl.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const ratio = rect.width > 0 ? clickX / rect.width : 0;
      d.seekTo(ratio * totalSec);
    },
    [d, totalSec],
  );

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
    e: PointerEvent<HTMLDivElement>,
    type: 'clip' | 'callout',
    id: string,
    origStartSec: number,
    durationSec: number,
  ) => {
    // If clicked on delete button, do nothing (delete button handles its own click)
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    e.stopPropagation();
    e.preventDefault();

    setSelectedItem({ type, id });
    setDraggingItem({
      type,
      id,
      startX: e.clientX,
      origStartSec,
      durationSec,
      currentStartSec: origStartSec,
    });
  };

  // Window listeners for smooth timeline clip dragging
  useEffect(() => {
    if (!draggingItem) return;

    const handlePointerMove = (e: globalThis.PointerEvent) => {
      const rulerEl = rulerRef.current;
      if (!rulerEl) return;
      const rulerWidth = rulerEl.clientWidth;
      if (rulerWidth <= 0) return;

      const deltaPx = e.clientX - draggingItem.startX;
      const deltaSec = (deltaPx / rulerWidth) * totalSec;
      const maxStart = Math.max(0, totalSec - draggingItem.durationSec);
      const newStart = Math.max(0, Math.min(maxStart, draggingItem.origStartSec + deltaSec));

      setDraggingItem((prev) =>
        prev ? { ...prev, currentStartSec: Math.round(newStart * 10) / 10 } : null,
      );
    };

    const handlePointerUp = () => {
      if (draggingItem) {
        if (draggingItem.type === 'clip') {
          d.patchClip(draggingItem.id, { startSec: draggingItem.currentStartSec });
        } else {
          d.updateCallout(draggingItem.id, {
            startSec: draggingItem.currentStartSec,
            endSec: draggingItem.currentStartSec + draggingItem.durationSec,
          });
        }
        setDraggingItem(null);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [draggingItem, totalSec, d]);

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

  // Generate ruler tick marks (every 5 or 10 sec)
  const ticks = useMemo(() => {
    const step = totalSec > 60 ? 10 : 5;
    const count = Math.floor(totalSec / step);
    const result: Array<{ sec: number; leftPct: number }> = [];
    for (let i = 0; i <= count; i += 1) {
      const sec = i * step;
      result.push({
        sec,
        leftPct: (sec / totalSec) * 100,
      });
    }
    return result;
  }, [totalSec]);

  const playheadPct = Math.min(100, Math.max(0, (d.playhead / totalSec) * 100));
  const hasVideoSource = Boolean(d.voiceoverSource?.path);

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

      {/* Multi-Track Timeline Diagram */}
      <div className={s.timelineArea} onClick={(e) => e.stopPropagation()}>
        {/* Playhead vertical needle with draggable thumb */}
        <div
          className={s.playheadLine}
          style={{ left: `calc(140px + (100% - 140px) * ${playheadPct / 100})` }}
        >
          <div
            className={s.playheadThumb}
            onPointerDown={handlePlayheadPointerDown}
            title="Зажмите и тяните для перемотки времени"
          />
        </div>

        {/* Ruler Row: clicking/dragging here navigates time */}
        <div className={s.rulerRow}>
          <div className={s.headerCol}>Таймлайн</div>
          <div
            ref={rulerRef}
            className={s.rulerCanvas}
            onPointerDown={handlePlayheadPointerDown}
            title="Кликните или тяните по шкале времени для перемотки"
          >
            {ticks.map((t) => (
              <div key={t.sec} className={s.rulerTick} style={{ left: `${t.leftPct}%` }}>
                {formatTimecode(t.sec)}
              </div>
            ))}
          </div>
        </div>

        {/* Track 1: Video (V1) */}
        <div className={s.trackLane}>
          <div className={s.trackHeader}>
            <div className={s.trackTitleWrap}>
              <span className={s.trackIcon}>🎬</span>
              <span className={s.trackLabel}>V1 Видео</span>
            </div>
          </div>
          <div className={s.trackBody}>
            {v1Clips.length > 0 ? (
              v1Clips.map((clip) => {
                const isDragging = draggingItem?.type === 'clip' && draggingItem.id === clip.id;
                const isSelected = selectedItem?.id === clip.id;
                const startSec = isDragging ? draggingItem.currentStartSec : clip.startSec;
                const left = (startSec / totalSec) * 100;
                const width = Math.max(3, (clip.durationSec / totalSec) * 100);

                return (
                  <div
                    key={clip.id}
                    className={`${s.clipBlock} ${s.clipVideo} ${isDragging ? s.clipDragging : ''}`}
                    data-selected={isSelected}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    onPointerDown={(e) =>
                      handleItemPointerDown(e, 'clip', clip.id, clip.startSec, clip.durationSec)
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedItem({ type: 'clip', id: clip.id });
                    }}
                    title={`${clip.label} (${formatTimecode(clip.durationSec)}) — перетащите для перемещения, ✕ или Del для удаления`}
                  >
                    <span className={s.clipTitle}>{clip.label}</span>
                    <span className={s.clipDuration}>
                      {isDragging ? formatTimecode(startSec) : formatTimecode(clip.durationSec)}
                    </span>
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
                  </div>
                );
              })
            ) : d.voiceoverSource ? (
              <div
                className={`${s.clipBlock} ${s.clipVideo}`}
                style={{ left: '0%', width: '100%' }}
                title={`${d.voiceoverSource.name} (${formatTimecode(d.voiceoverSource.durationSec)})`}
              >
                <span className={s.clipTitle}>{d.voiceoverSource.name}</span>
                <span className={s.clipDuration}>{formatTimecode(d.voiceoverSource.durationSec)}</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Track 2: Overlays / Stills (V2) */}
        <div className={s.trackLane}>
          <div className={s.trackHeader}>
            <div className={s.trackTitleWrap}>
              <span className={s.trackIcon}>🖼</span>
              <span className={s.trackLabel}>V2 Графика</span>
            </div>
          </div>
          <div className={s.trackBody}>
            {v2Clips.map((clip) => {
              const isDragging = draggingItem?.type === 'clip' && draggingItem.id === clip.id;
              const isSelected = selectedItem?.id === clip.id;
              const startSec = isDragging ? draggingItem.currentStartSec : clip.startSec;
              const left = (startSec / totalSec) * 100;
              const width = Math.max(3, (clip.durationSec / totalSec) * 100);

              return (
                <div
                  key={clip.id}
                  className={`${s.clipBlock} ${s.clipStill} ${isDragging ? s.clipDragging : ''}`}
                  data-selected={isSelected}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  onPointerDown={(e) =>
                    handleItemPointerDown(e, 'clip', clip.id, clip.startSec, clip.durationSec)
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedItem({ type: 'clip', id: clip.id });
                  }}
                  title={`${clip.label} (${formatTimecode(clip.durationSec)}) — перетащите для перемещения, ✕ или Del для удаления`}
                >
                  <span className={s.clipTitle}>{clip.label}</span>
                  <span className={s.clipDuration}>
                    {isDragging ? formatTimecode(startSec) : formatTimecode(clip.durationSec)}
                  </span>
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
                    title="Удалить графику (Delete)"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Track 3: Audio A1 (Original / Voiceover) */}
        <div className={s.trackLane}>
          <div className={s.trackHeader}>
            <div className={s.trackTitleWrap}>
              <span className={s.trackIcon}>🔊</span>
              <span className={s.trackLabel}>A1 Звук/Голос</span>
            </div>
          </div>
          <div className={s.trackBody}>
            {a1Clips.length > 0 ? (
              a1Clips.map((clip) => {
                const isDragging = draggingItem?.type === 'clip' && draggingItem.id === clip.id;
                const isSelected = selectedItem?.id === clip.id;
                const startSec = isDragging ? draggingItem.currentStartSec : clip.startSec;
                const left = (startSec / totalSec) * 100;
                const width = Math.max(3, (clip.durationSec / totalSec) * 100);

                return (
                  <div
                    key={clip.id}
                    className={`${s.clipBlock} ${s.clipAudioOriginal} ${isDragging ? s.clipDragging : ''}`}
                    data-selected={isSelected}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    onPointerDown={(e) =>
                      handleItemPointerDown(e, 'clip', clip.id, clip.startSec, clip.durationSec)
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedItem({ type: 'clip', id: clip.id });
                    }}
                    title={`${clip.label} (${formatTimecode(clip.durationSec)}) — перетащите для перемещения, ✕ или Del для удаления`}
                  >
                    <span className={s.clipTitle}>{clip.label}</span>
                    <span className={s.clipDuration}>
                      {isDragging ? formatTimecode(startSec) : formatTimecode(clip.durationSec)}
                    </span>
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
                      title="Удалить аудиоклип (Delete)"
                    >
                      ✕
                    </button>
                  </div>
                );
              })
            ) : hasVideoSource ? (
              <div
                className={`${s.clipBlock} ${s.clipAudioOriginal}`}
                style={{ left: '0%', width: '100%', opacity: 0.7 }}
                title="Оригинальная звуковая дорожка видеофайла"
              >
                <span className={s.clipTitle}>Оригинальный звук видео</span>
                <span className={s.clipDuration}>{formatTimecode(d.voiceoverSource?.durationSec ?? 0)}</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Track 4: Audio A2 (Music / Extracted) */}
        <div className={s.trackLane}>
          <div className={s.trackHeader}>
            <div className={s.trackTitleWrap}>
              <span className={s.trackIcon}>🎵</span>
              <span className={s.trackLabel}>A2 Экстракт</span>
            </div>
          </div>
          <div className={s.trackBody}>
            {a2Clips.map((clip) => {
              const isDragging = draggingItem?.type === 'clip' && draggingItem.id === clip.id;
              const isSelected = selectedItem?.id === clip.id;
              const startSec = isDragging ? draggingItem.currentStartSec : clip.startSec;
              const left = (startSec / totalSec) * 100;
              const width = Math.max(3, (clip.durationSec / totalSec) * 100);

              return (
                <div
                  key={clip.id}
                  className={`${s.clipBlock} ${s.clipAudioExtracted} ${isDragging ? s.clipDragging : ''}`}
                  data-selected={isSelected}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  onPointerDown={(e) =>
                    handleItemPointerDown(e, 'clip', clip.id, clip.startSec, clip.durationSec)
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedItem({ type: 'clip', id: clip.id });
                  }}
                  title={`${clip.label} (${formatTimecode(clip.durationSec)}) — перетащите для перемещения, ✕ или Del для удаления`}
                >
                  <span className={s.clipTitle}>{clip.label}</span>
                  <span className={s.clipDuration}>
                    {isDragging ? formatTimecode(startSec) : formatTimecode(clip.durationSec)}
                  </span>
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
                    title="Удалить извлечённый трек (Delete)"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Track 5: Callouts & Hints (C1) */}
        <div className={s.trackLane}>
          <div className={s.trackHeader}>
            <div className={s.trackTitleWrap}>
              <span className={s.trackIcon}>💬</span>
              <span className={s.trackLabel}>C1 Подсказки</span>
            </div>
          </div>
          <div className={s.trackBody}>
            {(d.callouts ?? []).map((callout) => {
              const isDragging = draggingItem?.type === 'callout' && draggingItem.id === callout.id;
              const isSelected = selectedItem?.id === callout.id;
              const duration = Math.max(0.5, callout.endSec - callout.startSec);
              const startSec = isDragging ? draggingItem.currentStartSec : callout.startSec;
              const left = (startSec / totalSec) * 100;
              const width = Math.max(3, (duration / totalSec) * 100);
              const isActive = d.playhead >= callout.startSec && d.playhead <= callout.endSec;

              return (
                <div
                  key={callout.id}
                  className={`${s.clipBlock} ${s.clipCallout} ${isDragging ? s.clipDragging : ''}`}
                  data-selected={isSelected}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
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
                  title={`[${formatTimecode(startSec)} - ${formatTimecode(startSec + duration)}] ${callout.text} — перетащите для перемещения, ✕ или Del для удаления`}
                >
                  <span className={s.clipTitle}>💬 {callout.text}</span>
                  <span className={s.clipDuration}>
                    {isDragging ? formatTimecode(startSec) : `${Math.round(duration * 10) / 10}s`}
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
