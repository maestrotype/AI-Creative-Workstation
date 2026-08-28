import type { ReactNode } from 'react';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../../projects/ui/ProjectsPage.module.css';

export function SettingsPage(): ReactNode {
  const { t, i18n } = useTranslation();
  const [hfToken, setHfToken] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.api?.getSetting('HF_TOKEN').then(val => {
      if (val) setHfToken(val);
    });
  }, []);

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  const handleSaveToken = async () => {
    await window.api?.setSetting('HF_TOKEN', hfToken.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('settings.title')}</h1>
      </header>

      {/* Language */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
          {t('settings.language')}
        </h2>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={() => changeLanguage('en')}
            style={{ padding: '0.5rem 1.25rem', cursor: 'pointer', borderRadius: '8px', border: '1px solid var(--color-border-subtle)', background: i18n.language === 'en' ? 'var(--color-accent)' : 'var(--color-bg-card)', color: i18n.language === 'en' ? '#000' : 'var(--color-text-primary)', fontWeight: 500 }}
          >
            {t('settings.en')}
          </button>
          <button
            onClick={() => changeLanguage('ru')}
            style={{ padding: '0.5rem 1.25rem', cursor: 'pointer', borderRadius: '8px', border: '1px solid var(--color-border-subtle)', background: i18n.language === 'ru' ? 'var(--color-accent)' : 'var(--color-bg-card)', color: i18n.language === 'ru' ? '#000' : 'var(--color-text-primary)', fontWeight: 500 }}
          >
            {t('settings.ru')}
          </button>
        </div>
      </section>

      {/* HF Token */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
          Hugging Face Token
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
          Нужен для скачивания закрытых моделей (FLUX.1 Schnell, FLUX.1 Dev).
          Получи на <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent)' }}>huggingface.co/settings/tokens</a> (тип: Read).
          Перед скачиванием FLUX — прими лицензию на странице модели на сайте HF.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <input
            type="password"
            value={hfToken}
            onChange={e => { setHfToken(e.target.value); setSaved(false); }}
            placeholder="hf_xxxxxxxxxxxxxxxxxxxx"
            style={{
              flex: 1,
              padding: '0.6rem 0.875rem',
              borderRadius: '8px',
              border: '1px solid var(--color-border-subtle)',
              background: 'var(--color-bg-card)',
              color: 'var(--color-text-primary)',
              fontFamily: 'monospace',
              fontSize: '13px',
              outline: 'none',
            }}
          />
          <button
            onClick={handleSaveToken}
            style={{
              padding: '0.6rem 1.25rem',
              borderRadius: '8px',
              border: 'none',
              background: saved ? '#48bb78' : 'var(--color-accent)',
              color: '#000',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.2s',
              whiteSpace: 'nowrap',
            }}
          >
            {saved ? '✓ Сохранено' : 'Сохранить'}
          </button>
        </div>
      </section>
    </div>
  );
}
