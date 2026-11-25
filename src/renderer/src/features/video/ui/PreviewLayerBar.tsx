import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { clipAtTime } from '../model/directorTimeline';
import { useDirector } from './DirectorBoard';
import styles from './PreviewLayerBar.module.css';

/** Compact layer switch under the player — not competing with markup tools. */
export function PreviewLayerBar({
  focusOverlay,
  onFocusOverlay,
}: {
  focusOverlay: string | null;
  onFocusOverlay: (track: string | null) => void;
}): ReactNode {
  const { t } = useTranslation();
  const d = useDirector();
  const v1 = clipAtTime(d.clips, 'v1', d.playhead);
  const v2 = clipAtTime(d.clips, 'v2', d.playhead);
  if (!v1 && !v2) return null;

  const v1Label = v1
    ? (d.bins.find((b) => b.id === v1.binId)?.name || v1.label || 'V1')
    : null;
  const v2Label = v2
    ? (d.bins.find((b) => b.id === v2.binId)?.name || v2.label || 'V2')
    : null;

  return (
    <div className={styles.bar} role="group" aria-label={t('video.preview_layers_aria')}>
      <span className={styles.label}>{t('video.preview_layers_label')}</span>
      {v1 ? (
        <button
          type="button"
          className={styles.chip}
          data-on={!focusOverlay || undefined}
          title={v1Label || t('video.preview_v1_only')}
          onClick={() => onFocusOverlay(null)}
        >
          {t('video.preview_show_v1')}
        </button>
      ) : null}
      {v2 ? (
        <>
          <button
            type="button"
            className={styles.chip}
            data-on={focusOverlay === 'v2' || undefined}
            title={v2Label || t('video.preview_pip_hint')}
            onClick={() => onFocusOverlay(focusOverlay === 'v2' ? null : 'v2')}
          >
            {focusOverlay === 'v2' ? t('video.preview_v2_full_on') : t('video.preview_v2_full')}
          </button>
          {v2.id ? (
            <button
              type="button"
              className={styles.chipQuiet}
              onClick={() => d.moveClipToTrack(v2.id, 'v1')}
              title={t('video.preview_promote_hint')}
            >
              {t('video.preview_promote')}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
