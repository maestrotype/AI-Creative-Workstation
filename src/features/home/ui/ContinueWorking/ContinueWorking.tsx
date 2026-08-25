/**
 * ContinueWorking — the recent projects grid section.
 *
 * Presentational: renders whatever status/assets/onRetry props it receives.
 * Displays the 3 most recently active projects.
 */
import type { ReactNode } from 'react';

import type { Asset } from '../../../../core/types';
import { FolderIcon } from '../../../../shared/ui/icons';
import { AssetCard } from '../AssetCard/AssetCard';
import styles from './ContinueWorking.module.css';

/* ─── Props ─────────────────────────────────────────────────────────── */

export interface ContinueWorkingProps {
  /** Loading state — drives skeleton vs. content rendering. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  /** Projects to render, newest first. */
  readonly projects: readonly Asset[];
  /** Retry action for the error state. */
  readonly onRetry?: () => void;
}

/* ─── Constants ─────────────────────────────────────────────────────── */

const SKELETON_COUNT = 3;

/* ─── Component ─────────────────────────────────────────────────────── */

export function ContinueWorking({
  status,
  projects,
  onRetry,
}: ContinueWorkingProps): ReactNode {
  /* Loading / idle → skeleton */
  if (status === 'idle' || status === 'loading') {
    return (
      <section
        className={styles.section}
        aria-busy="true"
        aria-label="Loading recent projects"
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Continue Working</h2>
        </header>
        <SkeletonGrid count={SKELETON_COUNT} />
      </section>
    );
  }

  /* Error state */
  if (status === 'error') {
    return (
      <section
        className={styles.section}
        aria-label="Recent projects unavailable"
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Continue Working</h2>
        </header>
        <div className={styles.statePanel}>
          <p className={styles.stateHeading}>Something went wrong</p>
          <p className={`${styles.stateText} ${styles.errorText}`}>
            Could not load your recent projects.
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

  /* Empty state — no projects yet */
  if (projects.length === 0) {
    return (
      <section
        className={styles.section}
        aria-label="No recent projects yet"
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Continue Working</h2>
        </header>
        <div className={styles.statePanel}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <FolderIcon size={24} />
          </span>
          <p className={styles.stateHeading}>No projects yet</p>
          <p className={styles.stateText}>
            Projects you create or work on will appear here.
          </p>
        </div>
      </section>
    );
  }

  /* Populated grid */
  return (
    <section className={styles.section} aria-label="Recent projects">
      <header className={styles.header}>
        <h2 className={styles.title}>Continue Working</h2>
        <span className={styles.count}>{projects.length}</span>
      </header>

      <ul className={styles.grid}>
        {projects.map((project) => (
          <li key={project.id} className={styles.gridItem}>
            <AssetCard asset={project} />
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
