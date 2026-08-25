/**
 * Inspiration — gallery of curated system capabilities.
 *
 * Presentational: renders a grid of InspirationItems.
 */
import type { ReactNode } from 'react';

import type { InspirationItem } from '../../api/assetApi';
import { ImageIcon } from '../../../../shared/ui/icons';
import styles from './Inspiration.module.css';

export interface InspirationProps {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly items: readonly InspirationItem[];
  readonly onSelect: (prompt: string) => void;
}

const SKELETON_COUNT = 4;

export function Inspiration({
  status,
  items,
  onSelect,
}: InspirationProps): ReactNode {
  if (status === 'idle' || status === 'loading') {
    return (
      <section className={styles.section} aria-label="Loading inspiration">
        <header className={styles.header}>
          <h2 className={styles.title}>Inspiration</h2>
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
        <h2 className={styles.title}>Inspiration</h2>
      </header>

      <ul className={styles.grid}>
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={styles.gridItem}
              onClick={() => onSelect(item.prompt)}
              aria-label={`Use prompt: ${item.prompt}`}
            >
              {item.thumbnailUrl ? (
                <img
                  src={item.thumbnailUrl}
                  alt=""
                  className={styles.thumbnail}
                  loading="lazy"
                />
              ) : (
                <div className={styles.placeholder} aria-hidden="true">
                  <ImageIcon size={32} />
                </div>
              )}
              <p className={styles.caption}>{item.prompt}</p>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
