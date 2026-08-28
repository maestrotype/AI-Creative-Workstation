import type { ReactNode } from 'react';

import { useTranslation } from 'react-i18next';
import { useCreateStore } from '../../store/createStore';
import styles from './GeneratingStep.module.css';

export function GeneratingStep(): ReactNode {
  const { t } = useTranslation();
  const progress = useCreateStore((s) => s.generationProgress);
  const cancelGeneration = useCreateStore((s) => s.cancelGeneration);

  const percent = progress ? Math.round(progress.progress * 100) : 0;

  // NOTE: progress.message comes from the generation API and is in English.
  // In a real app, the API could return translation keys or localized strings.
  const message = progress?.message ?? t('create.status.starting');
  const estimated = progress?.estimatedSecondsLeft ?? 0;
  const elapsed = progress?.elapsedSeconds ?? 0;

  return (
    <div className={styles.container}>
      <div className={styles.spinner} aria-hidden="true" />
      
      <p className={styles.message} aria-live="polite">
        {message}
      </p>

      <div className={styles.progressBarContainer} aria-hidden="true">
        <div 
          className={styles.progressBar} 
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className={styles.meta}>
        <span className={styles.privacy}>
          {t('create.status.running_locally')}
        </span>
        <span>
          {estimated > 0 
            ? t('create.status.estimated', { seconds: estimated }) 
            : elapsed > 0
              ? t('create.status.elapsed', { seconds: elapsed })
              : t('create.status.finishing')}
        </span>
      </div>

      <button
        type="button"
        className={styles.cancelButton}
        onClick={cancelGeneration}
      >
        {t('create.btn_cancel')}
      </button>
    </div>
  );
}
