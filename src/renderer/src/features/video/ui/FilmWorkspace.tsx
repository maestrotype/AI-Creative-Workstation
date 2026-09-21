import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatClock } from '../model/directorTimeline';
import { toAssetUrl } from '../model/directorMedia';
import { useDirector } from './DirectorBoard';
import { DirectorResultPane, DirectorSourcesPane } from './DirectorPanes';
import { TrackMixer } from './TrackMixer';
import { ClipInspector } from './ClipInspector';
import s from './FilmWorkspace.module.css';

const STAGE_MIN = 0.32;
const STAGE_MAX = 0.68;
const STAGE_DEFAULT = 0.42;
const STAGE_HINTS = 0.52;

export function FilmWorkspace({
  onOpenVoiceover,
}: {
  onOpenVoiceover?: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const d = useDirector();
  const filmName = d.projectScope?.name?.trim() || t('projects.untitled');
  const productThumb = d.productStillPath ? toAssetUrl(d.productStillPath) : null;
  const vClips = d.clips.filter((c) => c.track.startsWith('v')).length;

  const [stageFrac, setStageFrac] = useState(STAGE_DEFAULT);
  const [previewFocus, setPreviewFocus] = useState(false);
  const [placingHints, setPlacingHints] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const dragRef = useRef<{ startY: number; startFrac: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const effectiveFocus = previewFocus || placingHints;
  const appliedFrac = effectiveFocus ? Math.max(stageFrac, STAGE_HINTS) : stageFrac;

  const onHintPlacementChange = useCallback((placing: boolean) => {
    setPlacingHints(placing);
    if (placing) setPreviewFocus(true);
  }, []);

  useEffect(() => {
    if (!splitting) return undefined;
    const onMove = (e: PointerEvent) => {
      const root = rootRef.current;
      const drag = dragRef.current;
      if (!root || !drag) return;
      const rect = root.getBoundingClientRect();
      const usable = Math.max(200, rect.height - 52);
      const delta = (e.clientY - drag.startY) / usable;
      const next = Math.min(STAGE_MAX, Math.max(STAGE_MIN, drag.startFrac + delta));
      setStageFrac(next);
      setPreviewFocus(false);
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
    dragRef.current = { startY: e.clientY, startFrac: appliedFrac };
    setSplitting(true);
  };

  return (
    <div
      ref={rootRef}
      className={s.root}
      data-preview-focus={effectiveFocus || undefined}
      style={{
        gridTemplateRows: `auto minmax(200px, ${appliedFrac}fr) 10px minmax(240px, ${1 - appliedFrac}fr)`,
      }}
    >
      <header className={s.toolbar}>
        <div className={s.brand}>
          <span className={s.filmName}>{filmName}</span>
          <span className={s.sub}>
            {d.productStillPath ? 'Product film' : 'Film editor'}
            {d.assemblyRationale ? ` · ${d.assemblyRationale}` : ''}
          </span>
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
            title="Undo (⌘Z / Ctrl+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            className={s.ghost}
            disabled={!d.canRedo}
            onClick={d.redo}
            title="Redo (⇧⌘Z / Ctrl+Y)"
          >
            Redo
          </button>
          <button
            type="button"
            className={s.ghost}
            data-on={effectiveFocus}
            onClick={() => setPreviewFocus((v) => !v)}
            title="Чуть крупнее превью — таймлайн остаётся usable"
          >
            {effectiveFocus ? 'Превью ✓' : 'Крупный превью'}
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

      <div className={s.stage} data-focus={effectiveFocus || undefined}>
        <aside className={s.media}>
          <div className={s.panelLabel}>Media</div>
          <DirectorSourcesPane onOpenVoiceover={onOpenVoiceover} compact />
        </aside>
        <section className={s.preview}>
          <div className={s.panelLabel}>
            Preview
            {placingHints ? <span className={s.placeHint}> · кликните по кадру</span> : null}
          </div>
          <DirectorResultPane
            previewActive
            compact
            onHintPlacementChange={onHintPlacementChange}
          />
        </section>
        <aside className={s.inspector}>
          <ClipInspector onOpenVoiceover={onOpenVoiceover} />
        </aside>
      </div>

      <div
        className={s.splitHandle}
        onPointerDown={onSplitPointerDown}
        title="Потяните, чтобы изменить высоту превью / таймлайна"
        role="separator"
        aria-orientation="horizontal"
        aria-valuenow={Math.round(appliedFrac * 100)}
      >
        <span className={s.splitGrip} />
      </div>

      <section className={s.timeline}>
        <div className={s.timelineHead}>
          <div className={s.productStrip}>
            {productThumb ? (
              <img className={s.productStripThumb} src={productThumb} alt="" />
            ) : (
              <button
                type="button"
                className={s.productStripThumbEmpty}
                onClick={d.pickProductStill}
                title="Set product still"
              >
                +
              </button>
            )}
            <div className={s.productStripMeta}>
              <span className={s.panelLabel}>Timeline</span>
              <strong>{filmName}</strong>
              <span>
                {productThumb
                  ? `${formatClock(d.total)} · ${vClips} shots · on-product`
                  : 'Set product still to lock this film to one product'}
                {(d.callouts?.length ?? 0) > 0 ? ` · ${d.callouts!.length} hints` : ''}
              </span>
            </div>
          </div>
          <span className={s.timelineHint}>
            drag splitter ↑↓ · Крупный превью · «+ Указать на кадре»
          </span>
        </div>
        <div className={s.timelineBody}>
          <TrackMixer embedded />
        </div>
      </section>
    </div>
  );
}
