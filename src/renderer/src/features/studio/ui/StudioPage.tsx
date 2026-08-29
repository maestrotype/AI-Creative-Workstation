import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import styles from './StudioPage.module.css';
import { CATALOG_ENGINES, ENGINE_FAMILIES, type EngineFamily } from '../model/engineCatalog';

interface Model {
  id: string;
  name: string;
  type: string;
  status: string;
  errorMessage?: string | null;
}

function isFamily(value: string | null): value is EngineFamily {
  return ENGINE_FAMILIES.includes(value as EngineFamily);
}

export function StudioPage(): ReactNode {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const family: EngineFamily = isFamily(searchParams.get('family')) ? searchParams.get('family') as EngineFamily : 'image';
  const [models, setModels] = useState<Model[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [loadedCacheKeys, setLoadedCacheKeys] = useState<string[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [unloadingId, setUnloadingId] = useState<string | null>(null);
  const [unloadError, setUnloadError] = useState<string | null>(null);
  const [voiceHas, setVoiceHas] = useState(false);
  const [ttsReady, setTtsReady] = useState(false);

  const toCacheKey = (modelId: string) => modelId.replaceAll('/', '__');
  const familyModels = models.filter((m) => m.type === family);
  const catalog = CATALOG_ENGINES.filter((m) => m.type === family);

  const loadModels = async () => {
    if (window.api) {
      const dbModels = await window.api.getModels();
      setModels(dbModels);
      try {
        const loaded = await window.api.getLoadedModels();
        setLoadedCacheKeys(loaded);
      } catch {
        setLoadedCacheKeys([]);
      }
      try {
        setActiveModelId(await window.api.getActiveModel());
      } catch {
        setActiveModelId(null);
      }
    }
  };

  useEffect(() => {
    loadModels();
    void window.api?.getVoiceProfile?.().then((profile) => {
      setVoiceHas(profile.has_sample);
      setTtsReady(profile.tts_ready);
    }).catch(() => {});

    const cleanupModels = window.api?.onModelsUpdated(() => loadModels()) ?? (() => {});
    const cleanupProgress = window.api?.onDownloadProgress(({ modelId, percent }) => {
      setDownloadProgress((prev) => ({ ...prev, [modelId]: percent }));
    }) ?? (() => {});

    return () => { cleanupModels(); cleanupProgress(); };
  }, []);

  const handleDownload = async (model: (typeof CATALOG_ENGINES)[number]) => {
    if (!model.downloadable || !window.api) return;
    try {
      await window.api.downloadModel(model);
    } catch (err: unknown) {
      alert('Download error: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleRetry = async (model: (typeof CATALOG_ENGINES)[number]) => {
    if (window.api) await window.api.retryDownload(model);
  };

  const handleUse = async (modelId: string) => {
    if (family !== 'image' || !window.api) return;
    await window.api.setActiveModel(modelId);
    await loadModels();
  };

  const handleUnload = async (modelId: string) => {
    if (!window.api) return;
    setUnloadError(null);
    setUnloadingId(modelId);
    try {
      const result = await window.api.unloadModel(modelId);
      await loadModels();
      if (!result.unloaded) {
        setUnloadError(t('studio.unload_failed', { reason: result.reason ?? 'unknown' }));
      }
    } catch (err) {
      setUnloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnloadingId(null);
    }
  };

  const handleDelete = async (modelId: string) => {
    if (!window.api) return;
    if (!window.confirm(t('studio.delete_confirm'))) return;
    await window.api.deleteModel(modelId);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('studio.title')}</h1>
      </header>

      <p className={styles.lead}>{t('studio.lead')}</p>

      <div className={styles.pills}>
        {ENGINE_FAMILIES.map((id) => (
          <button
            key={id}
            type="button"
            className={styles.pill}
            data-on={family === id}
            onClick={() => setSearchParams(id === 'image' ? {} : { family: id })}
          >
            {t(`studio.family_${id}`)}
          </button>
        ))}
      </div>

      <p className={styles.hint}>{t(`studio.family_hint_${family}`)}</p>
      {unloadError ? <p className={styles.unloadError}>{unloadError}</p> : null}

      {family === 'voice' ? (
        <div className={styles.modelCard}>
          <div className={styles.modelInfo}>
            <span className={styles.modelName}>{t('studio.voice_engine')}</span>
            <span className={styles.modelType}>
              {voiceHas ? t('studio.voice_sample_on') : t('studio.voice_sample_off')}
              {' · '}
              {ttsReady ? t('studio.tts_on') : t('studio.tts_off')}
            </span>
          </div>
          <Link className={styles.textButton} to="/assets">{t('studio.voice_record_in_assets')}</Link>
        </div>
      ) : (
        <>
          <div>
            <h3>{t('studio.my_models')}</h3>
            {familyModels.length === 0 ? (
              <p className={styles.hint}>{t('studio.no_models_family')}</p>
            ) : (
              <ul className={styles.modelList}>
                {familyModels.map((m) => (
                  <li key={m.id} className={styles.modelCard}>
                    <div className={styles.modelInfo}>
                      <span className={styles.modelName}>{m.name}</span>
                      <span className={styles.modelType}>{m.type}</span>
                    </div>
                    <div className={styles.modelActions}>
                      <span className={styles.status} style={{
                        color: m.status === 'error' ? '#e53e3e' : m.status === 'ready' ? '#48bb78' : undefined,
                      }}>
                        {m.status === 'ready' ? '✓ ready' : m.status === 'error' ? '✗ error' : m.status}
                      </span>
                      {m.status === 'ready' && family === 'image' && activeModelId === m.id && (
                        <span className={styles.status}>{t('studio.using')}</span>
                      )}
                      {m.status === 'ready' && loadedCacheKeys.includes(toCacheKey(m.id)) && (
                        <span className={styles.status}>{t('studio.in_ram')}</span>
                      )}
                      {m.status === 'error' && m.errorMessage && (
                        <span style={{ fontSize: '11px', color: '#e53e3e', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.errorMessage ?? undefined}>
                          {m.errorMessage}
                        </span>
                      )}
                      {m.status === 'ready' && family === 'image' && activeModelId !== m.id && (
                        <button
                          type="button"
                          className={styles.textButton}
                          onClick={() => handleUse(m.id)}
                          title={t('studio.use_title')}
                        >
                          {t('studio.use')}
                        </button>
                      )}
                      {m.status === 'ready' && (
                        <button
                          type="button"
                          className={styles.textButton}
                          onClick={() => { void handleUnload(m.id); }}
                          disabled={unloadingId === m.id || !loadedCacheKeys.includes(toCacheKey(m.id))}
                          title={loadedCacheKeys.includes(toCacheKey(m.id)) ? t('studio.unload_title') : t('studio.unload_idle_title')}
                        >
                          {unloadingId === m.id ? t('studio.unloading') : t('studio.unload')}
                        </button>
                      )}
                      <button
                        type="button"
                        className={styles.textButtonDanger}
                        onClick={() => handleDelete(m.id)}
                        title={t('studio.delete_title')}
                      >
                        {t('studio.delete_disk')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3>{t('studio.discover')}</h3>
            <ul className={styles.modelList}>
              {catalog.map((m) => {
                const localModel = models.find((local) => local.id === m.id);
                const isDownloading = localModel?.status === 'downloading';
                const isReady = localModel?.status === 'ready';
                const isError = localModel?.status === 'error';

                return (
                  <li key={m.id} className={styles.modelCard}>
                    <div className={styles.modelInfo}>
                      <span className={styles.modelName}>
                        {m.name}
                        {m.gated && <span className={styles.gated}>🔒 HF Token</span>}
                      </span>
                      <span className={styles.modelType}>
                        {m.type} · {m.size} · <span style={{ opacity: 0.7 }}>{t(m.noteKey)}</span>
                      </span>
                    </div>
                    {!m.downloadable && !localModel && (
                      <span className={styles.status}>{t('studio.pipeline_later')}</span>
                    )}
                    {m.downloadable && !localModel && (
                      <button type="button" className={styles.downloadButton} onClick={() => { void handleDownload(m); }}>
                        {t('studio.download')}
                      </button>
                    )}
                    {isDownloading && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', minWidth: '120px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--color-accent)' }}>
                          {downloadProgress[m.id] != null ? `${downloadProgress[m.id]}%` : '…'}
                        </span>
                        <div style={{ width: '120px', height: '4px', background: 'var(--color-bg-elevated)', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{
                            width: `${downloadProgress[m.id] ?? 0}%`,
                            height: '100%',
                            background: 'var(--color-accent)',
                            borderRadius: '2px',
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
                          type="button"
                          className={styles.downloadButton}
                          style={{ background: 'var(--color-error, #e53e3e)' }}
                          onClick={() => { void handleRetry(m); }}
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
        </>
      )}
    </div>
  );
}
