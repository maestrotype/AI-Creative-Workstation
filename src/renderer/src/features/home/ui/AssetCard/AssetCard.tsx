/**
 * AssetCard — single recent-work tile (presentational).
 *
 * Receives a domain Asset and renders its thumbnail (or placeholder icon),
 * name, kind label, and relative timestamp. No business logic.
 */
import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import type { Asset, AssetKind } from '../../../../core/types';
import { formatRelativeTime } from '../../../../core/utils/time';
import type { IconProps } from '../../../../shared/ui/icons';
import { DownloadIcon, FolderIcon, ImageIcon, TrashIcon, UserIcon } from '../../../../shared/ui/icons';
import styles from './AssetCard.module.css';

const KIND_ICONS: Record<AssetKind, ComponentType<IconProps>> = {
  character: UserIcon,
  image: ImageIcon,
  project: FolderIcon,
};

function isVideoThumb(url: string | null): boolean {
  if (!url) return false;
  try {
    return /\.(mp4|mov|m4v|webm|mkv)(\?|$)/i.test(decodeURIComponent(url));
  } catch {
    return /\.(mp4|mov|m4v|webm|mkv)(\?|$)/i.test(url);
  }
}

export interface AssetCardProps {
  readonly asset: Asset;
  readonly href?: string;
  readonly onDownload?: (asset: Asset) => void;
  readonly onDelete?: (asset: Asset) => void;
  readonly onOpen?: (asset: Asset) => void;
}

export function AssetCard({ asset, href, onDownload, onDelete, onOpen }: AssetCardProps): ReactNode {
  const { t } = useTranslation();
  const KindIcon = KIND_ICONS[asset.kind];
  const kindLabel = t(`home.kind_${asset.kind}`);

  const media = (
    <div className={styles.media}>
      {asset.thumbnailUrl ? (
        isVideoThumb(asset.thumbnailUrl) ? (
          <video
            className={styles.thumbnail}
            src={asset.thumbnailUrl}
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          <img
            className={styles.thumbnail}
            src={asset.thumbnailUrl}
            alt=""
            loading="lazy"
          />
        )
      ) : (
        <div className={styles.placeholder} aria-hidden="true">
          <KindIcon size={28} />
        </div>
      )}
      {onDelete && asset.thumbnailUrl ? (
        <button
          type="button"
          className={styles.remove}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDelete(asset);
          }}
          aria-label={t('home.delete')}
        >
          <TrashIcon size={16} />
        </button>
      ) : null}
      {onDownload && asset.thumbnailUrl ? (
        <button
          type="button"
          className={styles.download}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDownload(asset);
          }}
          aria-label={t('home.download')}
        >
          <DownloadIcon size={16} />
        </button>
      ) : null}
    </div>
  );

  const body = (
    <>
      {media}
      <div className={styles.meta}>
        <h3 className={styles.name} title={asset.name}>
          {asset.name}
        </h3>
        <p className={styles.details}>
          <span className={styles.kindLabel}>{kindLabel}</span>
          <span className={styles.separator} aria-hidden="true">·</span>
          <time dateTime={asset.updatedAt}>
            {formatRelativeTime(asset.updatedAt)}
          </time>
        </p>
      </div>
    </>
  );

  if (href) {
    return (
      <Link to={href} className={styles.card}>
        {body}
      </Link>
    );
  }

  if (onOpen) {
    return (
      <article
        className={styles.card}
        role="button"
        tabIndex={0}
        onClick={() => onOpen(asset)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen(asset);
          }
        }}
      >
        {body}
      </article>
    );
  }

  return <article className={styles.card}>{body}</article>;
}
