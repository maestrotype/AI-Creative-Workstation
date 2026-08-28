import type { ReactNode } from 'react';

import { useTranslation } from 'react-i18next';
import { useCreateStore } from '../../store/createStore';
import { AlertIcon, RefreshIcon } from '../../../../shared/ui/icons';
import styles from './ErrorStep.module.css';

export function ErrorStep(): ReactNode {
  const { t } = useTranslation();
  const error = useCreateStore((s) => s.error);
  const retryGeneration = useCreateStore((s) => s.retryGeneration);
  const reset = useCreateStore((s) => s.reset);

  if (!error) return null;

  const isSidecarDown = error.kind === 'sidecar_unavailable';
  const isNoModel = error.kind === 'no_model';
  const messageKey = isSidecarDown
    ? 'create.error.sidecar_unavailable'
    : isNoModel
      ? 'create.error.no_model'
      : 'create.error.generation_failed';

  return (
    <div className={styles.container}>
      <AlertIcon size={48} />

      <h2 className={styles.title}>{t('create.error.title')}</h2>
      <p className={styles.message}>
        {t(messageKey)}
      </p>

      {!isSidecarDown && !isNoModel && <pre className={styles.detail}>{error.message}</pre>}

      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.actionButton} ${styles.primaryAction}`}
          onClick={retryGeneration}
        >
          <RefreshIcon size={18} />
          {t('create.btn_retry')}
        </button>
        <button type="button" className={styles.actionButton} onClick={reset}>
          {t('create.btn_back')}
        </button>
      </div>
    </div>
  );
}