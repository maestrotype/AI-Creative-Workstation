import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './StudioPage.module.css';

interface Model {
  id: string;
  name: string;
  type: string;
  status: string;
  errorMessage?: string | null;
}

interface RecommendedModel {
  id: string;
  name: string;
  type: string;
  gated: boolean;
  size: string;
  note: string;
}

const RECOMMENDED_MODELS: RecommendedModel[] = [
  // Open — no token needed
  { id: 'stabilityai/sdxl-turbo', name: 'SDXL Turbo', type: 'image', gated: false, size: '~7 ГБ', note: 'Быстрая, 1-4 шага' },
  { id: 'stabilityai/stable-diffusion-xl-base-1.0', name: 'SDXL Base 1.0', type: 'image', gated: false, size: '~7 ГБ', note: 'Лучшее качество среди SD' },
  // Gated — нужен HF Token + принять лицензию на сайте HF
  { id: 'black-forest-labs/FLUX.1-schnell', name: 'FLUX.1 Schnell', type: 'image', gated: true, size: '~32 ГБ', note: 'Топ качество, 4 шага' },
  { id: 'black-forest-labs/FLUX.1-dev', name: 'FLUX.1 Dev', type: 'image', gated: true, size: '~32 ГБ', note: 'Лучшее качество' },
];

export function StudioPage(): ReactNode {
  const { t } = useTranslation();
  const [models, setModels] = useState<Model[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});

  const loadModels = async () => {
    if (window.api) {
      const dbModels = await window.api.getModels();
      setModels(dbModels);
    }
  };

  useEffect(() => {
    loadModels();
    
    const cleanupModels = window.api?.onModelsUpdated(() => loadModels()) ?? (() => {});
    const cleanupProgress = window.api?.onDownloadProgress(({ modelId, percent }) => {
      setDownloadProgress(prev => ({ ...prev, [modelId]: percent }));
    }) ?? (() => {});

    return () => { cleanupModels(); cleanupProgress(); };
  }, []);

  const handleDownload = async (model: any) => {
    if (window.api) {
      try {
        await window.api.downloadModel(model);
      } catch (err: any) {
        alert("Download error: " + err.message);
        console.error(err);
      }
    } else {
      alert("window.api is not available!");
    }
  };

  const handleRetry = async (model: any) => {
    if (window.api) {
      await window.api.retryDownload(model);
    }
  };

  const handleDelete = async (modelId: string) => {
    if (window.api) {
      await window.api.deleteModel(modelId);
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className={styles.status} style={{
                    color: m.status === 'error' ? '#e53e3e' : m.status === 'ready' ? '#48bb78' : undefined
                  }}>
                    {m.status === 'ready' ? '✓ ready' : m.status === 'error' ? '✗ error' : m.status}
                  </span>
                  {m.status === 'error' && m.errorMessage && (
                    <span style={{ fontSize: '11px', color: '#e53e3e', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.errorMessage ?? undefined}>
                      {m.errorMessage}
                    </span>
                  )}
                  <button
                    onClick={() => handleDelete(m.id)}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-border-default)',
                      color: 'var(--color-text-secondary)',
                      borderRadius: '50%',
                      width: '24px',
                      height: '24px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      lineHeight: 1,
                      padding: 0,
                    }}
                    title="Remove from list"
                  >
                    ×
                  </button>
                </div>
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
            const isError = localModel?.status === 'error';

            return (
              <li key={m.id} className={styles.modelCard}>
                <div className={styles.modelInfo}>
                  <span className={styles.modelName}>
                    {m.name}
                    {m.gated && <span style={{ fontSize: '11px', marginLeft: '6px', color: 'var(--color-text-secondary)', opacity: 0.7 }}>🔒 HF Token</span>}
                  </span>
                  <span className={styles.modelType}>
                    {m.type} · {m.size} · <span style={{ opacity: 0.7 }}>{m.note}</span>
                  </span>
                </div>
                {!localModel && (
                  <button 
                    className={styles.downloadButton}
                    onClick={() => handleDownload(m)}
                  >
                    {t('studio.download')}
                  </button>
                )}
                {isDownloading && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', minWidth: '120px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--color-accent)' }}>
                      {downloadProgress[m.id] != null ? `${downloadProgress[m.id]}%` : '⏳ Подготовка...'}
                    </span>
                    <div style={{ width: '120px', height: '4px', background: 'var(--color-bg-elevated)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{
                        width: `${downloadProgress[m.id] ?? 0}%`,
                        height: '100%',
                        background: 'var(--color-accent)',
                        borderRadius: '2px',
                        transition: 'width 0.3s ease'
                      }} />
                    </div>
                  </div>
                )}
                {isReady && <span className={styles.status}>✓ {t('studio.installed')}</span>}
                {isError && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', minWidth: '120px' }}>
                    {localModel?.errorMessage && (
                      <span style={{ fontSize: '11px', color: '#e53e3e', maxWidth: '200px', textAlign: 'right', wordBreak: 'break-word' }}>
                        {localModel.errorMessage}
                      </span>
                    )}
                    <button 
                      className={styles.downloadButton}
                      style={{ background: 'var(--color-error, #e53e3e)' }}
                      onClick={() => handleRetry(m)}
                    >
                      ↺ Retry
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
