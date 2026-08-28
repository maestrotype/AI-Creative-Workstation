/**
 * AssetCard — single recent-work tile (presentational).
 *
 * Receives a domain Asset and renders its thumbnail (or placeholder icon),
 * name, kind label, and relative timestamp. No business logic.
 */
import type { ComponentType, ReactNode } from 'react';

import type { Asset, AssetKind } from '../../../../core/types';
import { formatRelativeTime } from '../../../../core/utils/time';
import type { IconProps } from '../../../../shared/ui/icons';
import { FolderIcon, ImageIcon, UserIcon } from '../../../../shared/ui/icons';
import styles from './AssetCard.module.css';

/* ─── Mappings ──────────────────────────────────────────────────────── */

const KIND_ICONS: Record<AssetKind, ComponentType<IconProps>> = {
  character: UserIcon,
  image: ImageIcon,
  project: FolderIcon,
};

const KIND_LABELS: Record<AssetKind, string> = {
  character: 'Character',
  image: 'Image',
  project: 'Project',
};

/* ─── Props ─────────────────────────────────────────────────────────── */

export interface AssetCardProps {
  readonly asset: Asset;
}

/* ─── Component ─────────────────────────────────────────────────────── */

export function AssetCard({ asset }: AssetCardProps): ReactNode {
  const KindIcon = KIND_ICONS[asset.kind];

  return (
    <article className={styles.card}>
      {asset.thumbnailUrl ? (
        <img
          className={styles.thumbnail}
          src={asset.thumbnailUrl}
          alt=""
          loading="lazy"
        />
      ) : (
        <div className={styles.placeholder} aria-hidden="true">
          <KindIcon size={28} />
        </div>
      )}

      <div className={styles.meta}>
        <h3 className={styles.name} title={asset.name}>
          {asset.name}
        </h3>
        <p className={styles.details}>
          <span className={styles.kindLabel}>{KIND_LABELS[asset.kind]}</span>
          <span className={styles.separator} aria-hidden="true">·</span>
          <time dateTime={asset.updatedAt}>
            {formatRelativeTime(asset.updatedAt)}
          </time>
        </p>
      </div>
    </article>
  );
}
