import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './StudioPage.module.css';

interface Model {
  id: string;
  name: string;
  type: string;
  status: string;
}

const RECOMMENDED_MODELS = [
  { id: 'mlx-community/FLUX.1-schnell-4bit', name: 'FLUX.1 Schnell (4-bit)', type: 'image' },
  { id: 'mlx-community/sdxl-turbo-4bit', name: 'SDXL Turbo (4-bit)', type: 'image' },
  { id: 'mlx-community/Llama-3.2-3B-Instruct-4bit', name: 'Llama 3.2 3B Instruct (4-bit)', type: 'llm' }
];

export function StudioPage(): ReactNode {
  const { t } = useTranslation();
  const [models, setModels] = useState<Model[]>([]);

  const loadModels = async () => {
    if (window.api) {
      const dbModels = await window.api.getModels();
      setModels(dbModels);
    }
  };

  useEffect(() => {
    loadModels();
    
    let cleanup = () => {};
    if (window.api && window.api.onModelsUpdated) {
      cleanup = window.api.onModelsUpdated(() => {
        loadModels();
      });
    }
    return cleanup;
  }, []);

  const handleDownload = async (model: any) => {
    if (window.api) {
      await window.api.downloadModel(model);
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('studio.title')}</h1>
      </header>

      <div>
        <h3>{t('studio.my_models')}</h3>
        {models.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)' }}>{t('studio.no_models')}</p>
        ) : (
          <ul className={styles.modelList}>
            {models.map(m => (
              <li key={m.id} className={styles.modelCard}>
                <div className={styles.modelInfo}>
                  <span className={styles.modelName}>{m.name}</span>
                  <span className={styles.modelType}>{m.type}</span>
                </div>
                <span className={styles.status}>{m.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h3>{t('studio.discover')}</h3>
        <ul className={styles.modelList}>
          {RECOMMENDED_MODELS.map(m => {
            const localModel = models.find(local => local.id === m.id);
            const isDownloading = localModel?.status === 'downloading';
            const isReady = localModel?.status === 'ready';

            return (
              <li key={m.id} className={styles.modelCard}>
                <div className={styles.modelInfo}>
                  <span className={styles.modelName}>{m.name}</span>
                  <span className={styles.modelType}>{m.type}</span>
                </div>
                {!localModel && (
                  <button 
                    className={styles.downloadButton}
                    onClick={() => handleDownload(m)}
                  >
                    {t('studio.download')}
                  </button>
                )}
                {isDownloading && <span className={styles.status}>Downloading...</span>}
                {isReady && <span className={styles.status}>{t('studio.installed')}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
