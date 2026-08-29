import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { FromIdeaPanel } from './FromIdeaPanel';
import { FromRecordingPanel } from './FromRecordingPanel';
import styles from './VideoPage.module.css';

type VideoMode = 'idea' | 'recording';

export function VideoPage(): ReactNode {
  const { t } = useTranslation();
  const [mode, setMode] = useState<VideoMode>('idea');

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('video.title')}</h1>
          <p className={styles.lead}>{t('video.lead')}</p>
        </div>
      </header>

      <div className={styles.pills}>
        <button type="button" className={styles.pill} data-on={mode === 'idea'} onClick={() => setMode('idea')}>
          {t('video.mode_idea')}
        </button>
        <button type="button" className={styles.pill} data-on={mode === 'recording'} onClick={() => setMode('recording')}>
          {t('video.mode_recording')}
        </button>
      </div>

      {mode === 'idea' ? <FromIdeaPanel /> : <FromRecordingPanel />}
    </div>
  );
}
