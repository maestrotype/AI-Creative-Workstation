import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
// We'll reuse AssetsPage.module.css or ProjectsPage.module.css since they are identical
import styles from '../../projects/ui/ProjectsPage.module.css';

export function StudioPage(): ReactNode {
  const { t } = useTranslation();

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('studio.title')}</h1>
      </header>

      <div className={styles.placeholder}>
        {t('studio.placeholder')}
      </div>
    </div>
  );
}
