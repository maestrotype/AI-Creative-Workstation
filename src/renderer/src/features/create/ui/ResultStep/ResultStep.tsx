import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCreateStore } from '../../store/createStore';
import { filePathFromAssetUrl, useWorkspaceBridgeStore } from '../../../studio/store/workspaceBridgeStore';
import { ImageIcon, RefreshIcon, UserIcon, DownloadIcon } from '../../../../shared/ui/icons';
import styles from './ResultStep.module.css';
import { cx } from '../../../../shared/lib/cx';

export function ResultStep(): ReactNode {
  const { t } = useTranslation();
  const result = useCreateStore((s) => s.result);
  const tryVariation = useCreateStore((s) => s.tryVariation);
  const setLastImagePath = useWorkspaceBridgeStore((s) => s.setLastImagePath);

  useEffect(() => {
    const path = filePathFromAssetUrl(result?.thumbnailUrl);
    if (path) setLastImagePath(path);
  }, [result, setLastImagePath]);

  if (!result) return null;

  return (
    <div className={styles.container}>
      <div className={styles.imageArea}>
        {result.thumbnailUrl ? (
          <img 
            key={result.id}
            src={result.thumbnailUrl} 
            alt={result.prompt} 
            className={styles.generatedImage} 
          />
        ) : (
          <div className={styles.placeholderContent}>
            <ImageIcon size={48} />
            <span>{t('create.status.generation_successful')}</span>
          </div>
        )}
      </div>

      <p className={styles.prompt}>
        "{result.prompt}"
      </p>

      <div className={styles.actions}>
        <button
          type="button"
          className={cx(styles.actionButton, styles.primaryAction)}
          onClick={tryVariation}
        >
          <RefreshIcon size={18} />
          {t('create.btn_try_variations')}
        </button>
        
        <button type="button" className={styles.actionButton}>
          {t('create.btn_edit_this')}
        </button>

        <Link to="/threed" className={styles.actionButton}>
          {t('create.btn_send_3d')}
        </Link>
        <Link to="/video" className={styles.actionButton}>
          {t('create.btn_send_video')}
        </Link>

        <button type="button" className={styles.actionButton}>
          <UserIcon size={18} />
          {t('create.btn_save_character')}
        </button>

        <button type="button" className={styles.actionButton}>
          <DownloadIcon size={18} />
          {t('create.btn_export')}
        </button>
      </div>
    </div>
  );
}
