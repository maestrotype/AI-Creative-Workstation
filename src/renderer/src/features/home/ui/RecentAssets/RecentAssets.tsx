/**
 * RecentAssets — the "Recent" grid section of the Home page.
 *
 * Presentational: renders whatever status/assets/onRetry props it receives.
 * Handles four states: idle/loading (skeleton), error, empty, and populated.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Asset } from '../../../../core/types';
import { SparklesIcon } from '../../../../shared/ui/icons';
import { AssetCard } from '../AssetCard/AssetCard';
import styles from './RecentAssets.module.css';

const PREVIEW_COUNT = 6;

export interface RecentAssetsProps {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly assets: readonly Asset[];
  readonly expanded?: boolean;
  readonly onToggleExpanded?: () => void;
  readonly libraryHref?: string;
  readonly hrefFor?: (asset: Asset) => string;
  readonly onOpen?: (asset: Asset) => void;
  readonly onDownload?: (asset: Asset) => void;
  readonly onDelete?: (asset: Asset) => void;
  readonly onUse?: (asset: Asset) => void;
  readonly useLabelFor?: (asset: Asset) => string | undefined;
  readonly onRetry?: () => void;
  readonly note?: string | null;
  readonly noteHref?: string | null;
  readonly noteHrefLabel?: string;
}

/* ─── Constants ─────────────────────────────────────────────────────── */

const SKELETON_COUNT = 6;

/* ─── Component ─────────────────────────────────────────────────────── */

export function RecentAssets({
  status,
  assets,
  expanded = false,
  onToggleExpanded,
  libraryHref = '/assets?tab=media',
  hrefFor,
  onOpen,
  onDownload,
  onDelete,
  onUse,
  useLabelFor,
  onRetry,
  note,
  noteHref,
  noteHrefLabel,
}: RecentAssetsProps): ReactNode {
  const { t } = useTranslation();

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
          <p className={styles.stateHeading}>{t('home.something_went_wrong')}</p>
          <p className={`${styles.stateText} ${styles.errorText}`}>
            {t('home.could_not_load_assets')}
          </p>
          {onRetry ? (
            <button
              type="button"
              className={styles.retryButton}
              onClick={onRetry}
            >
              {t('home.try_again')}
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
          <p className={styles.stateHeading}>{t('home.no_assets_yet')}</p>
          <p className={styles.stateText}>
            {t('home.no_assets_desc')}
          </p>
        </div>
      </section>
    );
  }

  /* Populated grid */
  const shown = expanded ? assets : assets.slice(0, PREVIEW_COUNT);
  const hidden = Math.max(0, assets.length - PREVIEW_COUNT);

  return (
    <section className={styles.section} aria-label="Recent creations">
      <header className={styles.header}>
        <h2 className={styles.title}>{t('home.recent_assets')}</h2>
        <span className={styles.count}>{assets.length}</span>
        <div className={styles.headerActions}>
          {hidden > 0 && onToggleExpanded ? (
            <button type="button" className={styles.textBtn} onClick={onToggleExpanded}>
              {expanded ? t('home.show_less') : t('home.show_all', { count: assets.length })}
            </button>
          ) : null}
          <Link className={styles.textBtn} to={libraryHref}>
            {t('home.view_library')}
          </Link>
        </div>
      </header>
      <p className={styles.lead}>{t('home.recent_assets_lead')}</p>
      {note ? (
        <p className={styles.note}>
          {note}
          {noteHref ? (
            <>
              {' '}
              <Link to={noteHref}>{noteHrefLabel || t('home.open_this_film')}</Link>
            </>
          ) : null}
        </p>
      ) : null}

      <ul className={styles.grid}>
        {shown.map((asset) => (
          <li key={asset.id} className={styles.gridItem}>
            <AssetCard
              asset={asset}
              href={hrefFor?.(asset)}
              onOpen={onOpen}
              onDownload={onDownload}
              onDelete={onDelete}
              onUse={onUse}
              useLabel={useLabelFor?.(asset)}
            />
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
