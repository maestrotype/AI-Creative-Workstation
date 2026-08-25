import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ProjectsPage.module.css';

export function ProjectsPage(): ReactNode {
  const { t } = useTranslation();

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('projects.title')}</h1>
        <button type="button" className={styles.newButton}>
          {t('projects.new_project')}
        </button>
      </header>

      <div className={styles.placeholder}>
        {t('projects.placeholder')}
      </div>
    </div>
  );
}
