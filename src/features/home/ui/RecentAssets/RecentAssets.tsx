/**
 * RecentAssets — the "Recent" grid section of the Home page.
 *
 * Presentational: renders whatever status/assets/onRetry props it receives.
 * Handles four states: idle/loading (skeleton), error, empty, and populated.
 */
import type { ReactNode } from 'react';

import type { Asset } from '../../../../core/types';
import { SparklesIcon } from '../../../../shared/ui/icons';
import { AssetCard } from '../AssetCard/AssetCard';
import styles from './RecentAssets.module.css';

/* ─── Props ─────────────────────────────────────────────────────────── */

export interface RecentAssetsProps {
  /** Loading state — drives skeleton vs. content rendering. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  /** Assets to render, newest first. Ignored unless status is 'ready'. */
  readonly assets: readonly Asset[];
  /** Retry action for the error state. */
  readonly onRetry?: () => void;
}

/* ─── Constants ─────────────────────────────────────────────────────── */

const SKELETON_COUNT = 6;

/* ─── Component ─────────────────────────────────────────────────────── */

export function RecentAssets({
  status,
  assets,
  onRetry,
}: RecentAssetsProps): ReactNode {
  /* Loading / idle → skeleton */
  if (status === 'idle' || status === 'loading') {
    return (
      <section
        className={styles.section}
        aria-busy="true"
        aria-label="Loading recent creations"
      >
        <SkeletonGrid count={SKELETON_COUNT} />
      </section>
    );
  }

  /* Error state */
  if (status === 'error') {
    return (
      <section
        className={styles.section}
        aria-label="Recent creations unavailable"
      >
        <div className={styles.statePanel}>
          <p className={styles.stateHeading}>Something went wrong</p>
          <p className={`${styles.stateText} ${styles.errorText}`}>
            Could not load your recent creations.
          </p>
          {onRetry ? (
            <button
              type="button"
              className={styles.retryButton}
              onClick={onRetry}
            >
              Try again
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  /* Empty state — no assets yet */
  if (assets.length === 0) {
    return (
      <section
        className={styles.section}
        aria-label="No recent creations yet"
      >
        <div className={styles.statePanel}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <SparklesIcon size={24} />
          </span>
          <p className={styles.stateHeading}>Nothing here yet</p>
          <p className={styles.stateText}>
            Describe what you want to create above and your work will appear here.
          </p>
        </div>
      </section>
    );
  }

  /* Populated grid */
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

/* ─── Internal: Skeleton grid ───────────────────────────────────────── */

function SkeletonGrid({ count }: { count: number }): ReactNode {
  return (
    <div className={styles.skeletonGrid} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.skeletonCard}>
          <span className={styles.skeletonThumb} />
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonLineSm} />
        </div>
      ))}
    </div>
  );
}
