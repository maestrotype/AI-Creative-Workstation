import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './VideoPage.module.css';

interface VideoPreviewPaneProps {
  filePath: string | null;
  savedTo: string | null;
  allowSave?: boolean;
  onSaveAs: () => void;
  onDiscard: () => void;
}

function videoMime(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  return 'video/mp4';
}

export function VideoPreviewPane({
  filePath,
  savedTo,
  allowSave = true,
  onSaveAs,
  onDiscard,
}: VideoPreviewPaneProps): ReactNode {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath || !window.api?.readVideoDraft) {
      setSrc(null);
      setLoadError(null);
      return;
    }

    let objectUrl: string | null = null;
    let cancelled = false;
    setLoadError(null);
    setSrc(null);

    void window.api.readVideoDraft(filePath)
      .then((buffer) => {
        if (cancelled) return;
        const blob = new Blob([buffer], { type: videoMime(filePath) });
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [filePath]);

  return (
    <section className={`${styles.card} ${styles.previewCard}`}>
      <span className={styles.label}>{t('video.preview')}</span>
      {loadError ? <p className={styles.error}>{loadError}</p> : null}
      {src ? (
        <video
          key={src}
          className={styles.player}
          src={src}
          controls
          playsInline
          preload="auto"
        />
      ) : filePath ? (
        <div className={styles.playerEmpty}>
          <p>{t('video.preview_loading')}</p>
        </div>
      ) : (
        <div className={styles.playerEmpty}>
          <p>{t('video.preview_empty')}</p>
        </div>
      )}
      {filePath && allowSave ? (
        <>
          <p className={styles.output}>{t('video.draft_note')}</p>
          <div className={styles.previewActions}>
            <button type="button" className={styles.primary} onClick={onSaveAs} disabled={!src}>
              {t('video.save_as')}
            </button>
            <button type="button" className={styles.secondary} onClick={onDiscard}>
              {t('video.discard')}
            </button>
          </div>
          {savedTo ? (
            <p className={styles.output}>
              {t('video.saved_to')}{' '}
              <button type="button" className={styles.link} onClick={() => { void window.api.openPath(savedTo); }}>
                {savedTo}
              </button>
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
