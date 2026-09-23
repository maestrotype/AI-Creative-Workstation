import { useEffect, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { DirectorProvider, useDirector } from './DirectorBoard';
import { FilmWorkspace } from './FilmWorkspace';
import { useWorkspaceBridgeStore } from '../../studio/store/workspaceBridgeStore';
import styles from './VideoPage.module.css';

function VideoStudioShell(): ReactNode {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const openVoice = params.get('voice') === '1';
  const d = useDirector();
  const takePendingTitleCard = useWorkspaceBridgeStore((s) => s.takePendingTitleCard);

  useEffect(() => {
    const path = takePendingTitleCard();
    if (!path) return;
    d.addSources([{ kind: 'image', path, name: t('video.title_card_name'), durationSec: 5 }], true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {d.filmLoadError ? (
        <div className={styles.projectBanner}>
          <Link className={styles.projectBannerBack} to="/projects">
            {t('video.open_films')}
          </Link>
          <span>{d.filmLoadError}</span>
        </div>
      ) : d.projectScope ? (
        <div className={styles.projectBanner}>
          <Link className={styles.projectBannerBack} to={`/projects/${d.projectScope.id}`}>
            {t('video.back_to_project')}
          </Link>
          <span>{t('video.finishing_project', { name: d.projectScope.name || t('projects.untitled') })}</span>
        </div>
      ) : (
        <div className={styles.projectBanner}>
          <Link className={styles.projectBannerBack} to="/projects">
            {t('video.open_films')}
          </Link>
          <span>{t('video.dub_existing_lead')}</span>
        </div>
      )}
      <div className={styles.studioBody}>
        <div className={styles.studioLayer}>
          <FilmWorkspace openNarration={openVoice} />
        </div>
      </div>
    </>
  );
}

export function VideoPage(): ReactNode {
  const [params] = useSearchParams();
  const projectId = (params.get('project') || '').trim() || null;
  const scopeKey = projectId || 'standalone';
  return (
    <div className={styles.container} data-mode="studio">
      <DirectorProvider key={scopeKey} projectId={projectId}>
        <VideoStudioShell />
      </DirectorProvider>
    </div>
  );
}

