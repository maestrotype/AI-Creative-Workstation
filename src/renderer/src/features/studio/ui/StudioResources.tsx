import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../../shared/lib/formatBytes';
import styles from './StudioResources.module.css';

export interface LoadedResident {
  key: string;
  label: string;
  kind: 'ollama' | 'sidecar' | 'job';
}

interface StudioResourcesProps {
  ramTotal: number;
  ramFree: number;
  diskTotal: number;
  diskFree: number;
  loaded?: LoadedResident[];
  unloadingKey?: string | null;
  onUnload?: (key: string) => void;
  onUnloadAll?: () => void;
  jobActive?: boolean;
}

function prettyResident(key: string): string {
  const raw = key.replace(/^ollama:/i, '').replaceAll('__', '/').split('/').slice(-1)[0] || key;
  if (/qwen2\.5:32b/i.test(raw)) return 'Qwen 2.5 32B';
  if (/qwen2\.5:14b/i.test(raw)) return 'Qwen 2.5 14B';
  if (/qwen2\.5:7b/i.test(raw)) return 'Qwen 2.5 7B';
  if (/qwen2\.5vl/i.test(raw)) return 'Qwen 2.5 VL';
  if (/wan.*ti2v|anes1032/i.test(raw)) return 'Wan 2.2 TI2V';
  if (/flux/i.test(raw)) return 'FLUX';
  return raw;
}

export function StudioResources({
  ramTotal,
  ramFree,
  diskTotal,
  diskFree,
  loaded = [],
  unloadingKey = null,
  onUnload,
  onUnloadAll,
  jobActive = false,
}: StudioResourcesProps): ReactNode {
  const { t } = useTranslation();
  const ramUsed = ramTotal - ramFree;
  const pressure = ramFree > 0 && ramFree < 4 * 1024 ** 3;
  const residents = loaded.map((item) => ({
    ...item,
    label: item.label || prettyResident(item.key),
  }));

  return (
    <div className={styles.wrap}>
      <div className={styles.bar} data-pressure={pressure || undefined}>
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

      <div className={styles.runtime}>
        <div className={styles.runtimeHead}>
          <strong>{t('studio.runtime_title')}</strong>
          {residents.length > 0 && onUnloadAll ? (
            <button
              type="button"
              className={styles.runtimeClear}
              disabled={Boolean(unloadingKey)}
              onClick={onUnloadAll}
              title={jobActive ? t('studio.runtime_unload_all_busy') : t('studio.runtime_unload_all')}
            >
              {jobActive ? t('studio.runtime_unload_ollama') : t('studio.runtime_unload_all')}
            </button>
          ) : null}
        </div>
        {pressure ? <p className={styles.pressure}>{t('studio.runtime_pressure')}</p> : null}
        <p className={styles.runtimeLead}>{t('studio.runtime_lead')}</p>
        {residents.length === 0 ? (
          <p className={styles.empty}>{t('studio.runtime_empty')}</p>
        ) : (
          <ul className={styles.residents}>
            {residents.map((item) => {
              const ollama = item.kind === 'ollama' || item.key.startsWith('ollama:');
              const canUnload = ollama || !jobActive;
              return (
                <li key={item.key}>
                  <span>
                    {item.label}
                    <em className={styles.kind}>
                      {ollama ? ' · Ollama' : item.kind === 'job' ? ` · ${t('studio.runtime_job')}` : ''}
                    </em>
                  </span>
                  {onUnload ? (
                    <button
                      type="button"
                      disabled={!canUnload || unloadingKey === item.key}
                      title={canUnload ? t('studio.unload_title') : t('studio.runtime_busy_hint')}
                      onClick={() => onUnload(item.key)}
                    >
                      {unloadingKey === item.key ? t('studio.unloading') : t('studio.unload')}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
