import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './AssetsPage.module.css';

export function AssetsPage(): ReactNode {
  const { t } = useTranslation();

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('assets.title')}</h1>
      </header>

      <div className={styles.placeholder}>
        {t('assets.placeholder')}
      </div>
    </div>
  );
}
