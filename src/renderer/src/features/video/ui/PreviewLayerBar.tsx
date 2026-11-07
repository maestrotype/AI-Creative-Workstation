import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { clipAtTime } from '../model/directorTimeline';
import { useDirector } from './DirectorBoard';
import styles from './PreviewLayerBar.module.css';

/** What the preview is showing right now, and how to make a layer fill the frame. */
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
  const product = d.productStillPath;

  const v1Label = v1
    ? (d.bins.find((b) => b.id === v1.binId)?.name || v1.label || 'V1')
    : null;
  const v2Label = v2
    ? (d.bins.find((b) => b.id === v2.binId)?.name || v2.label || 'V2')
    : null;

  return (
    <div className={styles.bar} role="group" aria-label={t('video.preview_layers_aria')}>
      <p className={styles.lead}>
        {focusOverlay
          ? t('video.preview_focus_overlay', { track: focusOverlay.toUpperCase() })
          : v1 && v2
            ? t('video.preview_both')
            : v1
              ? t('video.preview_v1_only')
              : v2
                ? t('video.preview_v2_only')
                : t('video.preview_empty_layers')}
      </p>
      <div className={styles.actions}>
        {v1 ? (
          <button
            type="button"
            className={styles.chip}
            data-on={!focusOverlay || undefined}
            title={v1Label || undefined}
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
              title={v2Label || undefined}
              onClick={() => onFocusOverlay(focusOverlay === 'v2' ? null : 'v2')}
            >
              {focusOverlay === 'v2' ? t('video.preview_v2_full_on') : t('video.preview_v2_full')}
            </button>
            {v2.id ? (
              <button
                type="button"
                className={styles.chip}
                onClick={() => d.moveClipToTrack(v2.id, 'v1')}
                title={t('video.preview_promote_hint')}
              >
                {t('video.preview_promote')}
              </button>
            ) : null}
          </>
        ) : null}
        {product && !v1 && !v2 ? (
          <span className={styles.hint}>{t('video.preview_product_only')}</span>
        ) : null}
      </div>
      {v2 && !focusOverlay ? (
        <p className={styles.hint}>{t('video.preview_pip_hint')}</p>
      ) : null}
    </div>
  );
}
