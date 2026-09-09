/**
 * Inspiration — gallery of curated system capabilities.
 *
 * Presentational: renders a grid of InspirationItems.
 */
import type { ReactNode } from 'react';

import { useTranslation } from 'react-i18next';
import type { InspirationItem } from '../../api/assetApi';
import styles from './Inspiration.module.css';

import titlePreview from '../../../../assets/inspiration/title.png';
import framePreview from '../../../../assets/inspiration/frame.png';
import productPreview from '../../../../assets/inspiration/product.png';
import varyPreview from '../../../../assets/inspiration/vary.png';

export interface InspirationProps {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly items: readonly InspirationItem[];
  readonly onSelect: (item: InspirationItem) => void;
}

const SKELETON_COUNT = 4;

const PREVIEWS: Record<string, string> = {
  'insp-title': titlePreview,
  'insp-frame': framePreview,
  'insp-product': productPreview,
  'insp-vary': varyPreview,
};

export function Inspiration({
  status,
  items,
  onSelect,
}: InspirationProps): ReactNode {
  const { t } = useTranslation();

  if (status === 'idle' || status === 'loading') {
    return (
      <section className={styles.section} aria-label="Loading inspiration">
        <header className={styles.header}>
          <h2 className={styles.title}>{t('home.inspiration')}</h2>
        </header>
        <div className={styles.skeletonGrid} aria-hidden="true">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <div key={i} className={styles.skeletonCard}>
              <span className={styles.skeletonThumb} />
              <span className={styles.skeletonLine} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (status === 'error' || items.length === 0) {
    return null; // Hide the section if it fails or is empty
  }

  return (
    <section className={styles.section} aria-label="Inspiration gallery">
      <header className={styles.header}>
        <h2 className={styles.title}>{t('home.inspiration')}</h2>
      </header>

      <ul className={styles.grid}>
        {items.map((item) => {
          const preview = item.thumbnailUrl ?? PREVIEWS[item.id];
          return (
            <li key={item.id}>
              <button
                type="button"
                className={styles.gridItem}
                onClick={() => onSelect(item)}
                aria-label={item.prompt}
              >
                {preview ? (
                  <div className={styles.media}>
                    <img
                      src={preview}
                      alt=""
                      className={styles.thumbnail}
                      loading="lazy"
                    />
                    <span className={styles.job}>{t(`create.job_${item.job}`)}</span>
                  </div>
                ) : (
                  <div className={styles.placeholder}>
                    <span className={styles.job}>{t(`create.job_${item.job}`)}</span>
                  </div>
                )}
                <p className={styles.caption}>{item.prompt}</p>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
