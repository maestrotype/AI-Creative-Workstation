import type { ReactNode } from 'react';

import { useCreateStore } from '../../store/createStore';
import styles from './GeneratingStep.module.css';

export function GeneratingStep(): ReactNode {
  const progress = useCreateStore((s) => s.generationProgress);
  const cancelGeneration = useCreateStore((s) => s.cancelGeneration);

  const percent = progress ? Math.round(progress.progress * 100) : 0;
  const message = progress?.message ?? 'Starting generation...';
  const estimated = progress?.estimatedSecondsLeft ?? 0;

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
          🔒 Running locally on your Mac
        </span>
        <span>
          {estimated > 0 ? `Estimated: ${estimated}s` : 'Finishing up...'}
        </span>
      </div>

      <button
        type="button"
        className={styles.cancelButton}
        onClick={cancelGeneration}
      >
        Cancel
      </button>
    </div>
  );
}
