import type { ReactNode } from 'react';

import { useTranslation } from 'react-i18next';
import { useCreateStore } from '../../store/createStore';
import { AlertIcon, RefreshIcon } from '../../../../shared/ui/icons';
import styles from './ErrorStep.module.css';

export function ErrorStep(): ReactNode {
  const { t } = useTranslation();
  const error = useCreateStore((s) => s.error);
  const clipStillPath = useCreateStore((s) => s.clipStillPath);
  const retryGeneration = useCreateStore((s) => s.retryGeneration);
  const startOver = useCreateStore((s) => s.startOver);
  const animateFromResult = useCreateStore((s) => s.animateFromResult);

  if (!error) return null;

  const isSidecarDown = error.kind === 'sidecar_unavailable';
  const isNoModel = error.kind === 'no_model' || error.kind === 'no_video_model';
  const isGpuMemory = error.kind === 'gpu_memory';
  const isCapability = error.kind === 'video_capability';
  const isLowMotion = error.kind === 'low_motion';
  const isNeedStill = error.kind === 'need_still';
  const messageKey = isSidecarDown
    ? 'create.error.sidecar_unavailable'
    : error.kind === 'no_video_model'
      ? 'create.error.no_video_model'
      : isNoModel
        ? 'create.error.no_model'
        : isGpuMemory
          ? 'create.error.mps_memory'
          : isNeedStill
            ? 'create.error.need_still'
            : isCapability
              ? 'create.error.video_capability'
              : isLowMotion
                ? 'create.error.low_motion'
                : 'create.error.generation_failed';

  return (
    <div className={styles.container}>
      <AlertIcon size={48} />

      <h2 className={styles.title}>{t('create.error.title')}</h2>
      <p className={styles.message}>
        {t(messageKey)}
      </p>

      {(error.kind === 'generation_failed' || isCapability || isLowMotion) ? (
        <pre className={styles.detail}>{error.message}</pre>
      ) : null}

      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.actionButton} ${styles.primaryAction}`}
          onClick={retryGeneration}
        >
          <RefreshIcon size={18} />
          {t('create.btn_retry')}
        </button>
        {isCapability && clipStillPath ? (
          <button type="button" className={styles.actionButton} onClick={animateFromResult}>
            {t('create.btn_animate')}
          </button>
        ) : null}
        <button type="button" className={styles.actionButton} onClick={startOver}>
          {t('create.btn_start_over')}
        </button>
      </div>
    </div>
  );
}