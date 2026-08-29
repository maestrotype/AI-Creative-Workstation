import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../../shared/lib/formatBytes';
import styles from './StudioResources.module.css';

interface StudioResourcesProps {
  ramTotal: number;
  ramFree: number;
  diskTotal: number;
  diskFree: number;
}

export function StudioResources({ ramTotal, ramFree, diskTotal, diskFree }: StudioResourcesProps): ReactNode {
  const { t } = useTranslation();
  const ramUsed = ramTotal - ramFree;

  return (
    <div className={styles.bar}>
      <div className={styles.item}>
        <span className={styles.label}>{t('studio.resources_ram')}</span>
        <span className={styles.value}>
          {t('studio.resources_free_of', {
            free: formatBytes(ramFree),
            total: formatBytes(ramTotal),
          })}
        </span>
        <div className={styles.track}>
          <div className={styles.fillRam} style={{ width: `${ramTotal > 0 ? (ramUsed / ramTotal) * 100 : 0}%` }} />
        </div>
      </div>
      <div className={styles.item}>
        <span className={styles.label}>{t('studio.resources_disk')}</span>
        <span className={styles.value}>
          {t('studio.resources_free_of', {
            free: formatBytes(diskFree),
            total: formatBytes(diskTotal),
          })}
        </span>
        <div className={styles.track}>
          <div className={styles.fillDisk} style={{ width: `${diskTotal > 0 ? ((diskTotal - diskFree) / diskTotal) * 100 : 0}%` }} />
        </div>
      </div>
    </div>
  );
}
