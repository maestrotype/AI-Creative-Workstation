import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { formatBytes } from '../../../shared/lib/formatBytes';
import styles from './StudioPage.module.css';
import { CATALOG_ENGINES, ENGINE_FAMILIES, type EngineFamily } from '../model/engineCatalog';
import { DownloadProgress, type DownloadProgressState } from './DownloadProgress';
import { StudioResources } from './StudioResources';

interface Model {
  id: string;
  name: string;
  type: string;
  status: string;
  errorMessage?: string | null;
}

interface StudioResourcesState {
  ramTotal: number;
  ramFree: number;
  diskTotal: number;
  diskFree: number;
}

function isFamily(value: string | null): value is EngineFamily {
  return ENGINE_FAMILIES.includes(value as EngineFamily);
}

function catalogSize(modelId: string): string | null {
  return CATALOG_ENGINES.find((m) => m.id === modelId)?.size ?? null;
}

export function StudioPage(): ReactNode {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const family: EngineFamily = isFamily(searchParams.get('family')) ? searchParams.get('family') as EngineFamily : 'image';
  const [models, setModels] = useState<Model[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgressState>>({});
  const [diskUsage, setDiskUsage] = useState<Record<string, number>>({});
  const [resources, setResources] = useState<StudioResourcesState | null>(null);
  const [loadedCacheKeys, setLoadedCacheKeys] = useState<string[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [active3dModelId, setActive3dModelId] = useState<string | null>(null);
  const [unloadingId, setUnloadingId] = useState<string | null>(null);
  const [unloadError, setUnloadError] = useState<string | null>(null);
  const [voiceHas, setVoiceHas] = useState(false);
  const [ttsReady, setTtsReady] = useState(false);
  const [voiceEngine, setVoiceEngine] = useState({
    packages_ready: false,
    weights_ready: false,
    installing: false,
    stage: 'idle',
    percent: 0,
    detail: '',
    cache_path: '',
  });
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [ollamaEngine, setOllamaEngine] = useState({
    binary_found: false,
    server_running: false,
    model_ready: false,
    installing: false,
    stage: 'idle',
    percent: 0,
    detail: '',
    model: 'qwen2.5:7b',
    started_by_app: false,
  });
  const [ollamaBusy, setOllamaBusy] = useState(false);

  const toCacheKey = (modelId: string) => modelId.replaceAll('/', '__');
  const familyModels = models.filter((m) => m.type === family);
  const catalog = CATALOG_ENGINES.filter((m) => m.type === family);

  const refreshResources = useCallback(async () => {
    if (!window.api?.getStudioResources || !window.api?.getModelDiskUsage) return;
    const [res, usage] = await Promise.all([
      window.api.getStudioResources(),
      window.api.getModelDiskUsage(),
    ]);
    setResources({
      ramTotal: res.ram_total,
      ramFree: res.ram_free,
      diskTotal: res.disk_total,
      diskFree: res.disk_free,
    });
    setDiskUsage(usage);
  }, []);

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
      try {
        setActive3dModelId(await window.api.getActive3dModel());
      } catch {
        setActive3dModelId(null);
      }
      void refreshResources();
    }
  };

  const refreshVoice = useCallback(async () => {
    try {
      const profile = await window.api?.getVoiceProfile?.();
      if (profile) {
        setVoiceHas(profile.has_sample);
        setTtsReady(profile.tts_ready);
      }
    } catch {
      /* optional */
    }
    try {
      const status = await window.api?.getVoiceEngineStatus?.();
      if (status) setVoiceEngine(status);
    } catch {
      /* optional */
    }
  }, []);

  const refreshOllama = useCallback(async () => {
    try {
      const status = await window.api?.getOllamaEngineStatus?.();
      if (status) setOllamaEngine(status);
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    void loadModels();
    void refreshResources();
    void refreshVoice();
    void refreshOllama();

    const cleanupModels = window.api?.onModelsUpdated(() => { void loadModels(); }) ?? (() => {});
    const cleanupProgress = window.api?.onDownloadProgress(({ modelId, percent, downloadedBytes, totalBytes }) => {
      setDownloadProgress((prev) => ({
        ...prev,
        [modelId]: { percent, downloadedBytes, totalBytes },
      }));
      void refreshResources();
    }) ?? (() => {});
    const cleanupVoice = window.api?.onVoiceEngineUpdated?.((status) => {
      setVoiceEngine(status);
      setTtsReady(status.packages_ready && status.weights_ready);
    }) ?? (() => {});
    const cleanupOllama = window.api?.onOllamaEngineUpdated?.((status) => {
      setOllamaEngine(status);
    }) ?? (() => {});

    const timer = window.setInterval(() => { void refreshResources(); }, 8000);
    const loadedTimer = window.setInterval(() => {
      void window.api?.getLoadedModels?.().then(setLoadedCacheKeys).catch(() => {});
    }, 5000);
    const ollamaTimer = window.setInterval(() => { void refreshOllama(); }, 6000);

    return () => {
      cleanupModels();
      cleanupProgress();
      cleanupVoice();
      cleanupOllama();
      window.clearInterval(timer);
      window.clearInterval(loadedTimer);
      window.clearInterval(ollamaTimer);
    };
  }, [refreshResources, refreshVoice, refreshOllama]);

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

  const handleVoiceDownload = async () => {
    if (!window.api?.installVoiceEngine) return;
    setVoiceBusy(true);
    setUnloadError(null);
    try {
      await window.api.installVoiceEngine();
      await refreshVoice();
    } catch (err: unknown) {
      setUnloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setVoiceBusy(false);
    }
  };

  const handleVoiceDelete = async () => {
    if (!window.api?.deleteVoiceEngine) return;
    if (!window.confirm(t('studio.voice_delete_confirm'))) return;
    setVoiceBusy(true);
    setUnloadError(null);
    try {
      await window.api.deleteVoiceEngine();
      await refreshVoice();
    } catch (err: unknown) {
      setUnloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setVoiceBusy(false);
    }
  };

  const handleOllamaDownload = async () => {
    if (!window.api?.installOllamaEngine) return;
    setOllamaBusy(true);
    setUnloadError(null);
    try {
      await window.api.installOllamaEngine();
      await refreshOllama();
    } catch (err: unknown) {
      setUnloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setOllamaBusy(false);
    }
  };

  const handleOllamaStart = async () => {
    if (!window.api?.startOllamaServe) return;
    setOllamaBusy(true);
    setUnloadError(null);
    try {
      await window.api.startOllamaServe();
      await refreshOllama();
    } catch (err: unknown) {
      setUnloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setOllamaBusy(false);
    }
  };

  const handleOllamaDelete = async () => {
    if (!window.api?.deleteOllamaModel) return;
    if (!window.confirm(t('studio.llm_delete_confirm'))) return;
    setOllamaBusy(true);
    setUnloadError(null);
    try {
      await window.api.deleteOllamaModel();
      await refreshOllama();
    } catch (err: unknown) {
      setUnloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setOllamaBusy(false);
    }
  };

  const handleUse = async (modelId: string) => {
    if (!window.api) return;
    if (family === 'image') await window.api.setActiveModel(modelId);
    if (family === '3d') await window.api.setActive3dModel(modelId);
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
    await loadModels();
  };

  const renderDiskLabel = (modelId: string, status: string) => {
    const bytes = diskUsage[modelId] ?? 0;
    if (bytes > 0) return t('studio.on_disk', { size: formatBytes(bytes) });
    if (status === 'downloading') return catalogSize(modelId) ?? t('studio.downloading_size_unknown');
    return catalogSize(modelId);
  };

  const renderModelActions = (m: Model) => {
    const inRam = loadedCacheKeys.includes(toCacheKey(m.id));
    const isDownloading = m.status === 'downloading';

    if (isDownloading) {
      return (
        <DownloadProgress progress={downloadProgress[m.id]} />
      );
    }

    return (
      <div className={styles.modelActions}>
        <span className={styles.status} style={{
          color: m.status === 'error' ? '#e53e3e' : m.status === 'ready' ? '#48bb78' : undefined,
        }}>
          {m.status === 'ready' ? '✓ ready' : m.status === 'error' ? '✗ error' : m.status}
        </span>
        {m.status === 'ready' && family === 'image' && activeModelId === m.id && (
          <span className={styles.status}>{t('studio.using')}</span>
        )}
        {m.status === 'ready' && family === '3d' && active3dModelId === m.id && (
          <span className={styles.status}>{t('studio.using')}</span>
        )}
        {m.status === 'ready' && inRam && (
          <span className={styles.status}>{t('studio.in_ram')}</span>
        )}
        {m.status === 'ready' && !inRam && (
          <span className={styles.statusMuted} title={t('studio.not_in_ram_hint')}>{t('studio.not_in_ram')}</span>
        )}
        {m.status === 'error' && m.errorMessage && (
          <span className={styles.errorSnippet} title={m.errorMessage ?? undefined}>
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
        {m.status === 'ready' && family === '3d' && active3dModelId !== m.id && (
          <button
            type="button"
            className={styles.textButton}
            onClick={() => handleUse(m.id)}
            title={t('studio.use_title')}
          >
            {t('studio.use')}
          </button>
        )}
        {m.status === 'ready' && inRam && (
          <button
            type="button"
            className={styles.textButton}
            onClick={() => { void handleUnload(m.id); }}
            disabled={unloadingId === m.id}
            title={t('studio.unload_title')}
          >
            {unloadingId === m.id ? t('studio.unloading') : t('studio.unload')}
          </button>
        )}
        <button
          type="button"
          className={styles.textButtonDanger}
          onClick={() => { void handleDelete(m.id); }}
          disabled={isDownloading}
          title={t('studio.delete_title')}
        >
          {t('studio.delete_disk')}
        </button>
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('studio.title')}</h1>
      </header>

      <p className={styles.lead}>{t('studio.lead')}</p>

      {resources ? (
        <StudioResources
          ramTotal={resources.ramTotal}
          ramFree={resources.ramFree}
          diskTotal={resources.diskTotal}
          diskFree={resources.diskFree}
        />
      ) : null}

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
        <>
          <div className={styles.modelCard}>
            <div className={styles.modelInfo}>
              <span className={styles.modelName}>Coqui XTTS v2</span>
              <span className={styles.modelType}>
                {t('studio.voice_xtts_size')}
                {' · '}
                {voiceEngine.packages_ready ? t('studio.voice_packages_on') : t('studio.voice_packages_off')}
                {' · '}
                {voiceEngine.weights_ready ? t('studio.voice_weights_on') : t('studio.voice_weights_off')}
              </span>
              <span className={styles.modelType}>
                {voiceHas ? t('studio.voice_sample_on') : t('studio.voice_sample_off')}
                {' · '}
                {ttsReady ? t('studio.tts_on') : t('studio.tts_off')}
              </span>
            </div>
            <div className={styles.voiceActions}>
              {!voiceEngine.packages_ready || !voiceEngine.weights_ready ? (
                <button
                  type="button"
                  className={styles.downloadButton}
                  disabled={voiceBusy || voiceEngine.installing}
                  onClick={() => { void handleVoiceDownload(); }}
                >
                  {voiceEngine.installing ? t('studio.voice_downloading') : t('studio.download')}
                </button>
              ) : (
                <span className={styles.status}>✓ {t('studio.installed')}</span>
              )}
              {(voiceEngine.packages_ready || voiceEngine.weights_ready) && !voiceEngine.installing ? (
                <button
                  type="button"
                  className={styles.textButton}
                  disabled={voiceBusy}
                  onClick={() => { void handleVoiceDelete(); }}
                >
                  {t('studio.voice_delete')}
                </button>
              ) : null}
            </div>
          </div>
          {voiceEngine.installing || voiceBusy ? (
            <DownloadProgress progress={{
              percent: voiceEngine.percent,
              downloadedBytes: 0,
              totalBytes: 0,
            }} />
          ) : null}
          {voiceEngine.detail && (voiceEngine.installing || voiceBusy) ? (
            <p className={styles.hint}>{voiceEngine.detail}</p>
          ) : null}
          <p className={styles.hint}>{t('studio.voice_xtts_hint')}</p>
          <p className={styles.hint}>{t('studio.voice_xtts_license')}</p>
          <Link className={styles.textButton} to="/assets">{t('studio.voice_record_in_assets')}</Link>
        </>
      ) : family === 'llm' ? (
        <>
          <div className={styles.modelCard}>
            <div className={styles.modelInfo}>
              <span className={styles.modelName}>Qwen 2.5 7B</span>
              <span className={styles.modelType}>
                {t('studio.llm_qwen_size')}
                {' · '}
                {ollamaEngine.binary_found ? t('studio.llm_binary_on') : t('studio.llm_binary_off')}
                {' · '}
                {ollamaEngine.server_running ? t('studio.llm_server_on') : t('studio.llm_server_off')}
                {' · '}
                {ollamaEngine.model_ready ? t('studio.llm_model_on') : t('studio.llm_model_off')}
              </span>
            </div>
            <div className={styles.voiceActions}>
              {!ollamaEngine.model_ready ? (
                <button
                  type="button"
                  className={styles.downloadButton}
                  disabled={ollamaBusy || ollamaEngine.installing}
                  onClick={() => { void handleOllamaDownload(); }}
                >
                  {ollamaEngine.installing ? t('studio.llm_downloading') : t('studio.download')}
                </button>
              ) : (
                <span className={styles.status}>✓ {t('studio.installed')}</span>
              )}
              {ollamaEngine.binary_found && !ollamaEngine.server_running && !ollamaEngine.installing ? (
                <button
                  type="button"
                  className={styles.textButton}
                  disabled={ollamaBusy}
                  onClick={() => { void handleOllamaStart(); }}
                >
                  {t('studio.llm_start_server')}
                </button>
              ) : null}
              {ollamaEngine.model_ready && !ollamaEngine.installing ? (
                <button
                  type="button"
                  className={styles.textButton}
                  disabled={ollamaBusy}
                  onClick={() => { void handleOllamaDelete(); }}
                >
                  {t('studio.llm_delete')}
                </button>
              ) : null}
            </div>
          </div>
          {ollamaEngine.installing || ollamaBusy ? (
            <DownloadProgress progress={{
              percent: ollamaEngine.percent,
              downloadedBytes: 0,
              totalBytes: 0,
            }} />
          ) : null}
          {ollamaEngine.detail && (ollamaEngine.installing || ollamaBusy) ? (
            <p className={styles.hint}>{ollamaEngine.detail}</p>
          ) : null}
          <p className={styles.hint}>{t('studio.llm_qwen_hint')}</p>
          <Link className={styles.textButton} to="/video">{t('studio.llm_use_in_video')}</Link>
        </>
      ) : (
        <>
          <div>
            <h3>{t('studio.my_models')}</h3>
            {familyModels.length === 0 ? (
              <p className={styles.hint}>{t('studio.no_models_family')}</p>
            ) : (
              <ul className={styles.modelList}>
                {familyModels.map((m) => {
                  const diskLabel = renderDiskLabel(m.id, m.status);
                  return (
                  <li key={m.id} className={styles.modelCard}>
                    <div className={styles.modelInfo}>
                      <span className={styles.modelName}>{m.name}</span>
                      <span className={styles.modelType}>
                        {m.type}
                        {diskLabel ? ` · ${diskLabel}` : ''}
                      </span>
                    </div>
                    {renderModelActions(m)}
                  </li>
                  );
                })}
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
                      <DownloadProgress progress={downloadProgress[m.id]} />
                    )}
                    {isReady && <span className={styles.status}>✓ {t('studio.installed')}</span>}
                    {isError && (
                      <div className={styles.errorActions}>
                        {localModel?.errorMessage && (
                          <span className={styles.errorSnippet}>
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
