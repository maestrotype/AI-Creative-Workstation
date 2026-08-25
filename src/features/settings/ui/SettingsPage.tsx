import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../../projects/ui/ProjectsPage.module.css';

export function SettingsPage(): ReactNode {
  const { t, i18n } = useTranslation();

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('settings.title')}</h1>
      </header>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <button 
          onClick={() => changeLanguage('en')}
          style={{ padding: '0.5rem 1rem', cursor: 'pointer', borderRadius: '4px', border: '1px solid var(--color-border-subtle)', background: i18n.language === 'en' ? 'var(--color-accent-subtle)' : 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
        >
          {t('settings.en')}
        </button>
        <button 
          onClick={() => changeLanguage('ru')}
          style={{ padding: '0.5rem 1rem', cursor: 'pointer', borderRadius: '4px', border: '1px solid var(--color-border-subtle)', background: i18n.language === 'ru' ? 'var(--color-accent-subtle)' : 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
        >
          {t('settings.ru')}
        </button>
      </div>

      <div className={styles.placeholder}>
        {t('settings.placeholder')}
      </div>
    </div>
  );
}
