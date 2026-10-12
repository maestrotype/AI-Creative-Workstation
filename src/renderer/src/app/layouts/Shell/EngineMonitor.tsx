import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { formatBytes } from '../../../shared/lib/formatBytes';
import { dismissNotice, type AppNotice } from '../../../shared/lib/notice';
import styles from './EngineMonitor.module.css';

type RuntimeStatus = Awaited<ReturnType<NonNullable<Window['api']>['getRuntimeStatus']>>;

function prettyModel(cacheKey: string): string {
  const raw = cacheKey.replaceAll('__', '/').split('/').slice(-1)[0] || cacheKey;
  if (/qwen2\.5:14b/i.test(raw)) return 'Qwen 2.5 14B';
  if (/qwen2\.5:7b/i.test(raw)) return 'Qwen 2.5 7B';
  if (/qwen2\.5vl/i.test(raw)) return 'Qwen 2.5 VL';
  return raw;
}

function uniqueModels(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const clean = name.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
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
  const [ollamaModel, setOllamaModel] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<AppNotice | null>(null);

  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      window.api?.getRuntimeStatus?.()
        .then((next) => { if (!cancelled) setStatus(next); })
        .catch(() => { /* keep last */ });
      window.api?.getOllamaEngineStatus?.()
        .then((next) => {
          if (cancelled) return;
          setOllamaModel(next.server_running && next.model ? next.model : '');
        })
        .catch(() => { if (!cancelled) setOllamaModel(''); });
    };
    pull();
    const timer = window.setInterval(pull, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onNotice = (event: Event) => {
      const detail = (event as CustomEvent<AppNotice>).detail;
      if (!detail?.message) return;
      setNotice((current) => (current?.message === detail.message ? current : detail));
    };
    window.addEventListener('acw-notice', onNotice);
    return () => window.removeEventListener('acw-notice', onNotice);
  }, []);

  const closeNotice = () => {
    if (notice) dismissNotice(notice.message);
    setNotice(null);
  };

  const dialog = notice ? (
    <div className={styles.backdrop} role="presentation" onClick={closeNotice}>
      <div
        className={styles.modal}
        role="alertdialog"
        aria-modal="true"
        data-tone={notice.tone}
        onClick={(event) => event.stopPropagation()}
      >
        <p>{notice.message}</p>
        <button type="button" onClick={closeNotice}>{t('monitor.notice_close')}</button>
      </div>
    </div>
  ) : null;

  if (!status) return dialog;

  const ramAvailable = status.ram_available ?? status.ram_free;
  const ramUsed = status.ram_used ?? Math.max(0, status.ram_total - ramAvailable);
  const usedPct = status.ram_total > 0 ? Math.round((ramUsed / status.ram_total) * 100) : 0;
  const pythonRss = status.memory.sidecar_rss_bytes;
  const working = status.job.active || status.job.stage === 'releasing';
  const activeModels = uniqueModels([
    status.job.active ? status.job.model_id : '',
    ollamaModel,
    ...status.loaded,
  ].map(prettyModel));
  const chipExtra = activeModels.length
    ? ` · ${activeModels.slice(0, 2).join(' · ')}`
    : working
      ? (status.job.detail ? ` · ${status.job.detail}` : '')
      : pythonRss > 0
        ? ` · ${formatBytes(pythonRss)}`
        : '';

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
    <>
      {dialog}
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
          {chipExtra}
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
              used: formatBytes(ramUsed),
              total: formatBytes(status.ram_total),
              pct: usedPct,
            })}
          </p>
          <p className={styles.ram}>{t('monitor.ram_hint')}</p>
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
          {status.video_backend ? (
            <p className={styles.ram}>
              {t('monitor.video_model')}
              {': '}
              {t(`monitor.video_state_${status.video_backend.state}`)}
              {status.video_backend.approx_bytes
                ? ` · ~${formatBytes(status.video_backend.approx_bytes)}`
                : ''}
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
    </>
  );
}
