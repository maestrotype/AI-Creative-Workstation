import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../../shared/lib/formatBytes';
import styles from './DownloadProgress.module.css';

export interface DownloadProgressState {
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
}

interface DownloadProgressProps {
  progress?: DownloadProgressState;
}

export function DownloadProgress({ progress }: DownloadProgressProps): ReactNode {
  const { t } = useTranslation();
  const percent = progress?.percent ?? 0;
  const downloaded = progress?.downloadedBytes ?? 0;
  const total = progress?.totalBytes ?? 0;

  const label = total > 0
    ? t('studio.download_progress_bytes', {
      downloaded: formatBytes(downloaded),
      total: formatBytes(total),
      percent,
    })
    : downloaded > 0
      ? t('studio.download_progress_partial', { downloaded: formatBytes(downloaded), percent })
      : t('studio.download_progress_unknown', { percent });

  return (
    <div className={styles.wrap}>
      <span className={styles.label}>{label}</span>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${Math.max(percent, total > 0 ? 2 : 0)}%` }} />
      </div>
    </div>
  );
}
