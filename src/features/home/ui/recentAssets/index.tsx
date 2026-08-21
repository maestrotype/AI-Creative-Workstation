/**
 * RecentAssets — the "Recent" grid section of the Home page.
 * Presentational (Rule 3): renders whatever status/assets props it is given,
 * including skeleton loading, empty and error states.
 */
import type { ReactNode } from 'react';

import type { Asset } from '../../../../core/types';
import { SparklesIcon } from '../../../../shared/ui/icons';
import { AssetCard } from '../assetCard';
import styles from './recentAssets.module.css';

export interface RecentAssetsProps {
  /** Load state for the asset list (drives skeleton vs. content). */
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Assets to render, newest first (ignored unless status === 'ready'). */
  assets: readonly Asset[];
  /** Optional retry action shown in the error state. */
  onRetry?: () => void;
}

const SKELETON_COUNT = 6;

export function RecentAssets({
  status,
  assets,
  onRetry,
}: RecentAssetsProps): ReactNode {
  if (status === 'idle' || status === 'loading') {
    return (
      <section className={styles.section} aria-busy="true" aria-label="Loading recent creations">
        <SkeletonGrid count={SKELETON_COUNT} />
      </section>
    );
  }

  if (status === 'error') {
    return (
      <section className={styles.section} aria-label="Recent creations unavailable">
        <div className={styles.statePanel}>
          <p className={`${styles.stateText} ${styles.errorText}`}>
            Could not load your recent creations.
          </p>
          {onRetry ? (
            <button type="button" className={styles.retryButton} onClick={onRetry}>
              Try again
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  if (assets.length === 0) {
    return (
      <section className={styles.section} aria-label="No recent creations yet">
        <div className={styles.statePanel}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <SparklesIcon size={24} />
          </span>
          <p className={styles.stateText}>Nothing here yet.</p>
          <p className={`${styles.stateText} ${styles.mutedText}`}>
            Describe what you want to create and it will show up here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.section} aria-label="Recent creations">
      <header className={styles.header}>
        <h2 className={styles.title}>Recent</h2>
        <span className={styles.count}>{assets.length}</span>
      </header>
      <ul className={styles.grid}>
        {assets.map((asset) => (
          <li key={asset.id} className={styles.gridItem}>
            <AssetCard asset={asset} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SkeletonGrid({ count }: { count: number }): ReactNode {
  return (
    <div className={styles.skeletonGrid} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={styles.skeletonCard}>
          <span className={styles.skeletonThumb} />
          <span className={styles.skeletonMeta} />
        </div>
      ))}
    </div>
  );
}