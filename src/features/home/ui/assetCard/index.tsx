/**
 * AssetCard — single recent-work tile (presentational).
 */
import type { ComponentType, ReactNode } from 'react';

import type { Asset, AssetType } from '../../../../core/types';
import { formatRelativeTime } from '../../../../core/utils/time';
import { FolderIcon, ImageIcon, UserIcon } from '../../../../shared/ui/icons';
import styles from './assetCard.module.css';

const TYPE_ICONS: Record<AssetType, ComponentType<{ size?: number }>> = {
  character: UserIcon,
  image: ImageIcon,
  project: FolderIcon,
};

const TYPE_LABELS: Record<AssetType, string> = {
  character: 'Character',
  image: 'Image',
  project: 'Project',
};

export interface AssetCardProps {
  asset: Asset;
}

export function AssetCard({ asset }: AssetCardProps): ReactNode {
  const TypeIcon = TYPE_ICONS[asset.type];

  return (
    <article className={styles.card}>
      {asset.thumbnailUrl ? (
        // Decorative preview — the name below carries the meaning.
        <img className={styles.thumb} src={asset.thumbnailUrl} alt="" loading="lazy" />
      ) : (
        <div className={styles.placeholder}>
          <TypeIcon size={26} />
        </div>
      )}

      <div className={styles.meta}>
        <h3 className={styles.name} title={asset.name}>
          {asset.name}
        </h3>
        <p className={styles.details}>
          <span className={styles.type}>{TYPE_LABELS[asset.type]}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={asset.updatedAt}>{formatRelativeTime(asset.updatedAt)}</time>
        </p>
      </div>
    </article>
  );
}