import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { formatBytes } from '../../../shared/lib/formatBytes';
import styles from './EngineMonitor.module.css';

type RuntimeStatus = Awaited<ReturnType<NonNullable<Window['api']>['getRuntimeStatus']>>;

function prettyModel(cacheKey: string): string {
  return cacheKey.replaceAll('__', '/').split('/').slice(-1)[0] || cacheKey;
}

function jobLabel(status: RuntimeStatus, t: (k: string, o?: Record<string, string | number>) => string): string {
  const job = status.job;
  if (job.active) {
    if (job.kind === 'video') return t('monitor.job_video');
    if (job.kind === 'image') return t('monitor.job_image');
    if (job.kind === 'script') return t('monitor.job_script');
    return t('monitor.job_busy');
  }
  if (job.stage === 'releasing') return t('monitor.releasing');
  if (job.stage === 'released' && status.loaded.length === 0) return t('monitor.released');
  if (status.loaded.length) return t('monitor.loaded_n', { count: status.loaded.length });
  return t('monitor.idle');
}

export function EngineMonitor(): ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      window.api?.getRuntimeStatus?.()
        .then((next) => { if (!cancelled) setStatus(next); })
        .catch(() => { /* keep last */ });
    };
    pull();
    const timer = window.setInterval(pull, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!status) return null;

  const used = Math.max(0, status.ram_total - status.ram_free);
  const usedPct = status.ram_total > 0 ? Math.round((used / status.ram_total) * 100) : 0;
  const working = status.job.active || status.job.stage === 'releasing';
  const chipPct = status.job.active ? status.job.percent : usedPct;

  const unloadOne = async (key: string) => {
    if (!window.api?.unloadModel) return;
    setBusyAction(key);
    try {
      await window.api.unloadModel(key.includes('/') ? key : key.replaceAll('__', '/'));
      const next = await window.api.getRuntimeStatus();
      setStatus(next);
    } finally {
      setBusyAction(null);
    }
  };

  const unloadAll = async () => {
    if (!window.api?.unloadAllModels) return;
    setBusyAction('all');
    try {
      await window.api.unloadAllModels();
      const next = await window.api.getRuntimeStatus();
      setStatus(next);
    } finally {
      setBusyAction(null);
    }
  };

  const cancel = async () => {
    if (!window.api?.cancelRuntimeJob) return;
    setBusyAction('cancel');
    try {
      await window.api.cancelRuntimeJob();
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className={styles.dock}>
      <button
        type="button"
        className={styles.chip}
        data-active={working ? 'true' : 'false'}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={styles.dot} data-on={working ? 'true' : 'false'} />
        <span className={styles.chipText}>
          {jobLabel(status, t as (k: string, o?: Record<string, string | number>) => string)}
          {status.job.active ? ` · ${chipPct}%` : ` · ${usedPct}%`}
        </span>
      </button>
      {open ? (
        <div className={styles.panel} role="dialog" aria-label={t('monitor.title')}>
          <header className={styles.head}>
            <strong>{t('monitor.title')}</strong>
            <Link className={styles.studio} to="/studio">{t('monitor.open_studio')}</Link>
          </header>
          {status.job.active ? (
            <div className={styles.job}>
              <p>
                {jobLabel(status, t as (k: string, o?: Record<string, string | number>) => string)}
                {status.job.model_id ? ` · ${prettyModel(status.job.model_id)}` : ''}
              </p>
              <p className={styles.meta}>
                {status.job.detail}
                {status.job.elapsed_sec ? ` · ${Math.round(status.job.elapsed_sec)}s` : ''}
              </p>
              <div className={styles.track}>
                <div className={styles.fill} style={{ width: `${Math.min(100, Math.max(4, status.job.percent))}%` }} />
              </div>
              <button type="button" className={styles.warnBtn} disabled={busyAction === 'cancel'} onClick={() => void cancel()}>
                {t('monitor.cancel')}
              </button>
            </div>
          ) : (
            <p className={styles.idle}>{status.job.error || t('monitor.no_job')}</p>
          )}
          <p className={styles.ram}>
            {t('monitor.ram', {
              used: formatBytes(used),
              total: formatBytes(status.ram_total),
              pct: usedPct,
            })}
          </p>
          {status.memory.sidecar_rss_bytes > 0 ? (
            <p className={styles.ram}>
              {t('monitor.python', { size: formatBytes(status.memory.sidecar_rss_bytes) })}
            </p>
          ) : null}
          {status.memory.mps_allocated_bytes > 0 ? (
            <p className={styles.ram}>
              {t('monitor.gpu', { size: formatBytes(status.memory.mps_allocated_bytes) })}
            </p>
          ) : null}
          <div className={styles.models}>
            <span>{t('monitor.in_ram')}</span>
            {status.loaded.length === 0 ? (
              <p className={styles.idle}>{t('monitor.none_loaded')}</p>
            ) : (
              <ul>
                {status.loaded.map((key) => (
                  <li key={key}>
                    <span>{prettyModel(key)}</span>
                    <button
                      type="button"
                      disabled={status.job.active || busyAction === key}
                      onClick={() => void unloadOne(key)}
                    >
                      {t('monitor.unload')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {status.loaded.length === 0 ? (
            <p className={styles.idle}>{t('monitor.nothing_to_unload')}</p>
          ) : (
            <button
              type="button"
              className={styles.clear}
              disabled={status.job.active || busyAction === 'all'}
              onClick={() => void unloadAll()}
            >
              {t('monitor.unload_all')}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
