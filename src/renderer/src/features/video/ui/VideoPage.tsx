import { useEffect, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { DirectorProvider, useDirector } from './DirectorBoard';
import {
  DirectorResultPane,
  DirectorSourcesPane,
  DirectorTimelinePane,
} from './DirectorPanes';
import { FromIdeaPanel } from './FromIdeaPanel';
import { FromRecordingPanel } from './FromRecordingPanel';
import { VideoDock, VideoMenuBar, useDockLayout } from './VideoDock';
import { VideoPipelineShell } from './VideoPipelineShell';
import type { DockState } from '../model/videoDockLayout';
import { peekProjectHandoff } from '../../projects/model/handoff';
import { useWorkspaceBridgeStore } from '../../studio/store/workspaceBridgeStore';
import styles from './VideoPage.module.css';

function maxZ(state: DockState): number {
  return Math.max(...Object.values(state.panels).map((p) => p.z), 1);
}

function StoryboardPane(): ReactNode {
  const d = useDirector();
  return (
    <div className={styles.densePane}>
      <FromIdeaPanel
        embedded
        onSendToTimeline={(items) => {
          d.addSources(
            items.map((it) => ({ kind: 'image' as const, path: it.path, name: it.name, durationSec: it.durationSec })),
            true,
          );
        }}
      />
    </div>
  );
}

function RecordingPane(): ReactNode {
  const d = useDirector();
  return (
    <div className={styles.densePane}>
      <FromRecordingPanel
        embedded
        onProduced={(path) => { d.addSources([{ kind: 'video', path }], true); }}
      />
    </div>
  );
}

function VideoStudioShell(): ReactNode {
  const { t } = useTranslation();
  const [dock, setDock] = useDockLayout();
  const d = useDirector();
  const takePendingTitleCard = useWorkspaceBridgeStore((s) => s.takePendingTitleCard);
  const titleCardOnTimeline = d.bins.some((bin) => bin.kind === 'image');

  const openVoiceover = () => {
    d.openVoiceover();
    // Voiceover lives in the pipeline mode: one centered stage, no panel hunting.
    setDock({
      ...dock,
      mode: 'pipeline',
      panels: {
        ...dock.panels,
        sources: {
          ...dock.panels.sources,
          visible: true,
          z: maxZ(dock) + 1,
        },
      },
    });
  };

  useEffect(() => {
    const path = takePendingTitleCard();
    if (!path) return;
    d.addSources([{ kind: 'image', path, name: t('video.title_card_name'), durationSec: 5, track: 'v2' }], true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!d.projectScope) return;
    openVoiceover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.projectScope?.id]);

  return (
    <>
      {d.projectScope ? (
        <div className={styles.projectBanner}>
          <Link className={styles.projectBannerBack} to={`/projects/${d.projectScope.id}`}>
            {t('video.back_to_project')}
          </Link>
          <span>
            {t('video.finishing_project', { name: d.projectScope.name || t('projects.untitled') })}
          </span>
        </div>
      ) : (
        <div className={styles.projectBanner}>
          <Link className={styles.projectBannerBack} to="/projects">
            {t('video.open_films')}
          </Link>
          <span>{t('video.dub_existing_lead')}</span>
        </div>
      )}
      {titleCardOnTimeline ? (
        <div className={styles.projectBanner}>
          <span>{t('video.title_card_on_v2')}</span>
        </div>
      ) : null}
      <VideoMenuBar state={dock} onState={setDock} onOpenVoiceover={openVoiceover} />
      <div className={styles.studioBody}>
        <div className={styles.studioLayer} hidden={dock.mode !== 'pipeline'}>
          <VideoPipelineShell active={dock.mode === 'pipeline'} />
        </div>
        <div className={styles.studioLayer} hidden={dock.mode === 'pipeline'}>
          <VideoDock
            state={dock}
            onState={setDock}
            panels={{
              timeline: <DirectorTimelinePane />,
              preview: <DirectorResultPane previewActive={dock.mode !== 'pipeline'} />,
              sources: <DirectorSourcesPane onOpenVoiceover={openVoiceover} />,
              storyboard: <StoryboardPane />,
              recording: <RecordingPane />,
            }}
          />
        </div>
      </div>
    </>
  );
}

export function VideoPage(): ReactNode {
  const [params] = useSearchParams();
  const fromQuery = params.get('project');
  const fromHandoff = peekProjectHandoff()?.projectId || null;
  const projectId = fromQuery || fromHandoff || null;
  const scopeKey = projectId || 'standalone';
  return (
    <div className={styles.container} data-mode="studio">
      <DirectorProvider key={scopeKey} projectId={projectId}>
        <VideoStudioShell />
      </DirectorProvider>
    </div>
  );
}
