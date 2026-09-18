import { useState, useRef, useMemo, useCallback } from 'react';
import type { ReactNode, MouseEvent } from 'react';
import { useDirector } from './DirectorBoard';
import { formatTimecode } from '../model/videoAnalysis';
import s from './TrackMixer.module.css';

type ExtractMode = 'both' | 'audio_only' | 'mute_video';

export function TrackMixer(): ReactNode {
  const d = useDirector();
  const [extractModalOpen, setExtractModalOpen] = useState(false);
  const [extractMode, setExtractMode] = useState<ExtractMode>('both');
  const [extractSuccess, setExtractSuccess] = useState<string | null>(null);

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

  // Handle seeking via clicking or dragging on ruler / track body
  const handleSeek = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = Math.max(0, e.clientX - rect.left);
      const ratio = Math.min(1, Math.max(0, clickX / rect.width));
      const targetSec = ratio * totalSec;
      d.seekTo(targetSec);
    },
    [d, totalSec],
  );

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
    <div className={s.container}>
      {/* Top Bar with Transport Controls & Actions */}
      <div className={s.topBar}>
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
      <div className={s.timelineArea}>
        {/* Playhead vertical needle */}
        <div className={s.playheadLine} style={{ left: `calc(140px + (100% - 140px) * ${playheadPct / 100})` }}>
          <div className={s.playheadThumb} />
        </div>

        {/* Ruler Row */}
        <div className={s.rulerRow}>
          <div className={s.headerCol}>Таймлайн</div>
          <div ref={rulerRef} className={s.rulerCanvas} onClick={handleSeek}>
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
          <div className={s.trackBody} onClick={handleSeek}>
            {v1Clips.length > 0 ? (
              v1Clips.map((clip) => {
                const left = (clip.startSec / totalSec) * 100;
                const width = Math.max(2, (clip.durationSec / totalSec) * 100);
                return (
                  <div
                    key={clip.id}
                    className={`${s.clipBlock} ${s.clipVideo}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${clip.label} (${formatTimecode(clip.durationSec)})`}
                  >
                    <span className={s.clipTitle}>{clip.label}</span>
                    <span className={s.clipDuration}>{formatTimecode(clip.durationSec)}</span>
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
          <div className={s.trackBody} onClick={handleSeek}>
            {v2Clips.map((clip) => {
              const left = (clip.startSec / totalSec) * 100;
              const width = Math.max(2, (clip.durationSec / totalSec) * 100);
              return (
                <div
                  key={clip.id}
                  className={`${s.clipBlock} ${s.clipStill}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${clip.label} (${formatTimecode(clip.durationSec)})`}
                >
                  <span className={s.clipTitle}>{clip.label}</span>
                  <span className={s.clipDuration}>{formatTimecode(clip.durationSec)}</span>
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
          <div className={s.trackBody} onClick={handleSeek}>
            {a1Clips.length > 0 ? (
              a1Clips.map((clip) => {
                const left = (clip.startSec / totalSec) * 100;
                const width = Math.max(2, (clip.durationSec / totalSec) * 100);
                return (
                  <div
                    key={clip.id}
                    className={`${s.clipBlock} ${s.clipAudioOriginal}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${clip.label} (${formatTimecode(clip.durationSec)})`}
                  >
                    <span className={s.clipTitle}>{clip.label}</span>
                    <span className={s.clipDuration}>{formatTimecode(clip.durationSec)}</span>
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
          <div className={s.trackBody} onClick={handleSeek}>
            {a2Clips.map((clip) => {
              const left = (clip.startSec / totalSec) * 100;
              const width = Math.max(2, (clip.durationSec / totalSec) * 100);
              return (
                <div
                  key={clip.id}
                  className={`${s.clipBlock} ${s.clipAudioExtracted}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${clip.label} (${formatTimecode(clip.durationSec)})`}
                >
                  <span className={s.clipTitle}>{clip.label}</span>
                  <span className={s.clipDuration}>{formatTimecode(clip.durationSec)}</span>
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
          <div className={s.trackBody} onClick={handleSeek}>
            {(d.callouts ?? []).map((callout) => {
              const left = (callout.startSec / totalSec) * 100;
              const width = Math.max(3, ((callout.endSec - callout.startSec) / totalSec) * 100);
              const isActive = d.playhead >= callout.startSec && d.playhead <= callout.endSec;
              return (
                <div
                  key={callout.id}
                  className={`${s.clipBlock} ${s.clipCallout}`}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    outline: isActive ? '2px solid #fff' : undefined,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    d.seekTo(callout.startSec);
                  }}
                  title={`[${formatTimecode(callout.startSec)} - ${formatTimecode(callout.endSec)}] ${callout.text}`}
                >
                  <span className={s.clipTitle}>💬 {callout.text}</span>
                  <span className={s.clipDuration}>{Math.round((callout.endSec - callout.startSec) * 10) / 10}s</span>
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
