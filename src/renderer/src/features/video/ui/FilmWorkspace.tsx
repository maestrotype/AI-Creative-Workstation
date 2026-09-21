import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { formatClock } from '../model/directorTimeline';
import { useDirector } from './DirectorBoard';
import { DirectorResultPane, DirectorSourcesPane } from './DirectorPanes';
import { TrackMixer } from './TrackMixer';
import { ClipInspector } from './ClipInspector';
import s from './FilmWorkspace.module.css';

export function FilmWorkspace({
  onOpenVoiceover,
}: {
  onOpenVoiceover?: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const d = useDirector();
  const filmName = d.projectScope?.name?.trim() || t('projects.untitled');

  return (
    <div className={s.root}>
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

      <div className={s.stage}>
        <aside className={s.media}>
          <div className={s.panelLabel}>Media</div>
          <DirectorSourcesPane onOpenVoiceover={onOpenVoiceover} compact />
        </aside>
        <section className={s.preview}>
          <div className={s.panelLabel}>Preview</div>
          <DirectorResultPane previewActive compact />
        </section>
        <aside className={s.inspector}>
          <ClipInspector onOpenVoiceover={onOpenVoiceover} />
        </aside>
      </div>

      <section className={s.timeline}>
        <div className={s.timelineHead}>
          <span className={s.panelLabel}>Timeline</span>
          <span className={s.timelineHint}>fit = whole film · drag edges to trim · ⌘/Ctrl+wheel zoom</span>
        </div>
        <div className={s.timelineBody}>
          <TrackMixer embedded />
        </div>
      </section>
    </div>
  );
}
