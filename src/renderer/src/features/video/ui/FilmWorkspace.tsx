import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatClock } from '../model/directorTimeline';
import { toAssetUrl } from '../model/directorMedia';
import { useDirector } from './DirectorBoard';
import { DirectorGeneratePane, DirectorResultPane, DirectorSourcesPane } from './DirectorPanes';
import { TrackMixer } from './TrackMixer';
import { ClipInspector } from './ClipInspector';
import { VoiceoverSection } from './VoiceoverSection';
import { FromIdeaPanel } from './FromIdeaPanel';
import { FromRecordingPanel } from './FromRecordingPanel';
import s from './FilmWorkspace.module.css';

const TIMELINE_RESERVE = 340;
const FRAME_MIN = 180;
const COLUMN_KEY = 'acw-film-columns';
const MEDIA_MIN = 200;
const MEDIA_MAX = 420;
const INSPECTOR_MIN = 220;
const INSPECTOR_MAX = 460;

function readColumns(): { media: number; inspector: number } {
  try {
    const raw = localStorage.getItem(COLUMN_KEY);
    const parsed = raw ? JSON.parse(raw) as { media?: number; inspector?: number } : null;
    return {
      media: clamp(parsed?.media ?? 248, MEDIA_MIN, MEDIA_MAX),
      inspector: clamp(parsed?.inspector ?? 300, INSPECTOR_MIN, INSPECTOR_MAX),
    };
  } catch {
    return { media: 248, inspector: 300 };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function FilmWorkspace({
  openNarration = false,
}: {
  openNarration?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const d = useDirector();
  const filmName = d.projectScope?.name?.trim() || t('projects.untitled');
  const productThumb = d.productStillPath ? toAssetUrl(d.productStillPath) : null;

  const [frameH, setFrameH] = useState(360);
  const [frameOverride, setFrameOverride] = useState<number | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [columns, setColumns] = useState(readColumns);
  const [columnDrag, setColumnDrag] = useState<'media' | 'inspector' | null>(null);
  const [mediaTab, setMediaTab] = useState<'assets' | 'generate' | 'record'>('assets');
  const [generateTab, setGenerateTab] = useState<'storyboard' | 'ai'>('storyboard');
  const [inspectorTab, setInspectorTab] = useState<'edit' | 'narration'>('edit');
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const columnDragRef = useRef<{ edge: 'media' | 'inspector'; startX: number; startW: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const openedNarrationRef = useRef(false);

  const openVoiceover = useCallback(() => {
    setInspectorTab('narration');
    void d.openVoiceover();
  }, [d]);

  useEffect(() => {
    if (!openNarration || openedNarrationRef.current) return;
    openedNarrationRef.current = true;
    setInspectorTab('narration');
    void d.openVoiceover();
  }, [openNarration, d]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const measure = () => {
      const toolbar = root.querySelector('header')?.clientHeight ?? 40;
      const stage = root.querySelector('[data-stage]') as HTMLElement | null;
      const column = stage?.querySelector('[data-preview]') as HTMLElement | null;
      const columnW = column?.clientWidth || Math.max(320, root.clientWidth - 460);
      const available = root.clientHeight - toolbar - 6;
      const reserve = Math.min(TIMELINE_RESERVE, Math.max(220, available * 0.48));
      const ratio = d.filmFormat === 'shorts' ? 16 / 9 : 9 / 16;
      const natural = columnW * ratio;
      const maxH = Math.max(FRAME_MIN, available - reserve);
      const autoH = Math.min(natural, maxH);
      const nextH = frameOverride == null
        ? autoH
        : Math.min(natural, Math.max(FRAME_MIN, frameOverride));
      const nextW = Math.min(columnW, nextH / ratio);
      setFrameH((prev) => (Math.abs(prev - nextH) < 0.5 ? prev : nextH));
      root.style.setProperty('--frame-h', `${Math.round(nextH)}px`);
      root.style.setProperty('--frame-w', `${Math.round(nextW)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [d.filmFormat, frameOverride]);

  useEffect(() => {
    if (!splitting) return undefined;
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setFrameOverride(drag.startH + (e.clientY - drag.startY));
    };
    const onUp = () => {
      dragRef.current = null;
      setSplitting(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [splitting]);

  const onSplitPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: frameH };
    setSplitting(true);
  };

  useEffect(() => {
    if (!columnDrag) return undefined;
    const onMove = (e: PointerEvent) => {
      const drag = columnDragRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      setColumns((prev) => {
        const next = drag.edge === 'media'
          ? { ...prev, media: clamp(drag.startW + delta, MEDIA_MIN, MEDIA_MAX) }
          : { ...prev, inspector: clamp(drag.startW - delta, INSPECTOR_MIN, INSPECTOR_MAX) };
        return next.media === prev.media && next.inspector === prev.inspector ? prev : next;
      });
    };
    const onUp = () => {
      columnDragRef.current = null;
      setColumnDrag(null);
      setColumns((prev) => {
        localStorage.setItem(COLUMN_KEY, JSON.stringify(prev));
        return prev;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [columnDrag]);

  const onColumnPointerDown = (edge: 'media' | 'inspector') => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    columnDragRef.current = {
      edge,
      startX: e.clientX,
      startW: edge === 'media' ? columns.media : columns.inspector,
    };
    setColumnDrag(edge);
  };

  return (
    <div
      ref={rootRef}
      className={s.root}
      style={{
        gridTemplateRows: 'auto var(--frame-h, 360px) 6px minmax(0, 1fr)',
      }}
    >
      <header className={s.toolbar}>
        <div className={s.brand}>
          {productThumb ? <img className={s.productMark} src={productThumb} alt="" /> : null}
          <div className={s.brandText}>
            <span className={s.filmName}>{filmName}</span>
            <span className={s.sub}>
              {d.productStillPath ? 'Товарный still для AI-вставок' : 'Монтаж · озвучка · подсказки'}
              {d.assemblyRationale ? ` · ${d.assemblyRationale}` : ''}
            </span>
          </div>
        </div>
        <div className={s.transport}>
          <button
            type="button"
            className={s.play}
            onClick={d.togglePlay}
            disabled={d.clips.length === 0 || d.bins.some((b) => b.proxying)}
          >
            {d.playing ? t('video.dir_pause') : t('video.dir_play')}
          </button>
          <span className={s.timecode}>
            {formatClock(d.playhead)} / {formatClock(d.total)}
          </span>
        </div>
        <div className={s.tools}>
          <button
            type="button"
            className={s.ghost}
            disabled={!d.canUndo}
            onClick={d.undo}
            title={t('video.dir_undo_hint')}
          >
            {t('video.dir_undo')}
          </button>
          <button
            type="button"
            className={s.ghost}
            disabled={!d.canRedo}
            onClick={d.redo}
            title={t('video.dir_redo_hint')}
          >
            {t('video.dir_redo')}
          </button>
          <button
            type="button"
            className={s.ghost}
            onClick={d.splitAtPlayhead}
            disabled={!d.selectedClip && !d.clips.length}
            title={t('video.dir_split_hint')}
          >
            {t('video.dir_split')}
          </button>
          <button
            type="button"
            className={s.export}
            onClick={d.exportVideo}
            disabled={d.clips.length === 0 || d.exportBusy || d.bins.some((b) => b.proxying)}
          >
            {d.exportBusy ? t('video.dir_exporting') : t('video.dir_export')}
          </button>
        </div>
      </header>

      <div
        className={s.stage}
        data-stage
        style={{
          gridTemplateColumns: `${columns.media}px 6px minmax(0, 1fr) 6px ${columns.inspector}px`,
        }}
      >
        <aside className={s.media}>
          <div className={s.panelTabs} role="tablist" aria-label="Media tools">
            {(['assets', 'generate', 'record'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={mediaTab === tab}
                data-on={mediaTab === tab || undefined}
                onClick={() => setMediaTab(tab)}
              >
                {tab === 'assets' ? 'Assets' : tab === 'generate' ? 'Generate' : 'Record'}
              </button>
            ))}
          </div>
          <div className={s.panelContent}>
            {mediaTab === 'assets' ? (
              <DirectorSourcesPane onOpenVoiceover={openVoiceover} compact />
            ) : null}
            {mediaTab === 'generate' ? (
              <div className={s.generateShell}>
                <div className={s.subTabs}>
                  <button type="button" data-on={generateTab === 'storyboard' || undefined} onClick={() => setGenerateTab('storyboard')}>Идея</button>
                  <button type="button" data-on={generateTab === 'ai' || undefined} onClick={() => setGenerateTab('ai')}>AI</button>
                </div>
                <div className={s.generateBody}>
                  {generateTab === 'storyboard' ? (
                    <FromIdeaPanel
                      embedded
                      projectId={d.projectScope?.id ?? null}
                      onSendToTimeline={(items) => {
                        d.addSources(items.map((item) => ({
                          kind: 'image' as const,
                          path: item.path,
                          name: item.name,
                          durationSec: item.durationSec,
                        })), true);
                        setMediaTab('assets');
                      }}
                    />
                  ) : (
                    <DirectorGeneratePane />
                  )}
                </div>
              </div>
            ) : null}
            {mediaTab === 'record' ? (
              <FromRecordingPanel
                embedded
                trackSource={(() => {
                  const clip = d.clips.find((item) => (
                    item.track === 'v1'
                    && d.playhead >= item.startSec
                    && d.playhead < item.startSec + item.durationSec
                  )) ?? d.clips.find((item) => item.track === 'v1');
                  const bin = clip?.binId ? d.bins.find((item) => item.id === clip.binId) : null;
                  if (!bin || bin.kind !== 'video' || !bin.path) return null;
                  return { path: bin.path, name: clip?.label || bin.name || 'Клип' };
                })()}
                onProduced={(path) => {
                  const clip = d.clips.find((item) => (
                    item.track === 'v1'
                    && d.playhead >= item.startSec
                    && d.playhead < item.startSec + item.durationSec
                  ));
                  if (clip?.binId) d.patchBin(clip.binId, { path });
                  else d.addSources([{ kind: 'video', path }], true);
                }}
              />
            ) : null}
          </div>
        </aside>
        <div
          className={s.colHandle}
          onPointerDown={onColumnPointerDown('media')}
          role="separator"
          aria-orientation="vertical"
          title="Потяните, чтобы изменить ширину левой колонки"
        />
        <section className={s.preview} data-preview>
          <DirectorResultPane
            previewActive
            compact
          />
        </section>
        <div
          className={s.colHandle}
          onPointerDown={onColumnPointerDown('inspector')}
          role="separator"
          aria-orientation="vertical"
          title="Потяните, чтобы изменить ширину правой колонки"
        />
        <aside className={s.inspector}>
          <div className={s.panelTabs} role="tablist" aria-label="Inspector">
            <button type="button" role="tab" data-on={inspectorTab === 'edit' || undefined} aria-selected={inspectorTab === 'edit'} onClick={() => setInspectorTab('edit')}>
              {d.selectedCallout ? 'Hint' : d.selectedClip ? 'Clip' : 'Film'}
            </button>
            <button type="button" role="tab" data-on={inspectorTab === 'narration' || undefined} aria-selected={inspectorTab === 'narration'} onClick={openVoiceover}>
              Narration
            </button>
          </div>
          <div className={s.panelContent}>
            {inspectorTab === 'edit' ? <ClipInspector onOpenVoiceover={openVoiceover} /> : <VoiceoverSection />}
          </div>
        </aside>
      </div>

      <div
        className={s.splitHandle}
        onPointerDown={onSplitPointerDown}
        title="Потяните, чтобы изменить высоту превью / таймлайна"
        role="separator"
        aria-orientation="horizontal"
        aria-valuenow={Math.round(frameH)}
      >
        <span className={s.splitGrip} />
      </div>

      <section className={s.timeline}>
        <div className={s.timelineBody}>
          <TrackMixer embedded />
        </div>
      </section>
    </div>
  );
}
