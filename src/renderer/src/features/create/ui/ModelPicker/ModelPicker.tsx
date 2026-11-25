import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useTranslation } from 'react-i18next';
import {
  VIDEO_PROVIDERS,
  sortProviders,
  formatEstimatedTime,
  formatPrice,
  qualityStars,
  type ModelSortKey,
  type VideoProviderSpec,
} from '../../model/videoCapability';
import styles from './ModelPicker.module.css';

/* ─── Types ─────────────────────────────────────────────────────────── */

interface ModelPickerProps {
  /** Currently selected model id. */
  activeModelId: string;
  /** IDs of models that are ready (installed or API key present). */
  readyModelIds: readonly string[];
  /** Callback when user picks a model. */
  onSelect: (modelId: string) => void;
  /** Filter by capability — only show matching providers. null = show all. */
  capabilityFilter?: 'IMAGE_TO_VIDEO' | 'IMAGE_ANIMATION' | 'TEXT_TO_VIDEO' | null;
}

interface ModelPickerTriggerProps {
  activeModelId: string;
  readyModelIds: readonly string[];
  onOpen: () => void;
}

/* ─── Badge label map ───────────────────────────────────────────────── */

const BADGE_LABELS: Record<string, string> = {
  popular: 'Popular',
  new: 'New',
  free: 'Free',
  fast: 'Fast',
};

const SORT_LABELS: Record<ModelSortKey, string> = {
  default: 'По умолчанию',
  speed: 'Скорость',
  price: 'Цена',
  quality: 'Качество',
};

const RUNTIME_ICON: Record<string, string> = {
  local: '⚡',
  cloud: '☁️',
};

/* ─── Trigger (inline button that opens the picker) ─────────────────── */

export function ModelPickerTrigger({ activeModelId, readyModelIds, onOpen }: ModelPickerTriggerProps): ReactNode {
  const { t } = useTranslation();
  const spec = VIDEO_PROVIDERS.find((p) => p.id === activeModelId);
  const isReady = readyModelIds.includes(activeModelId);

  if (!spec) {
    return (
      <button type="button" className={styles.trigger} onClick={onOpen}>
        <span className={styles.triggerIcon}>🎬</span>
        <span className={styles.triggerBody}>
          <span className={styles.triggerName}>{t('create.model')}</span>
          <span className={styles.triggerDetail}>{t('create.no_model_installed')}</span>
        </span>
        <span className={styles.triggerChevron}>▾</span>
      </button>
    );
  }

  return (
    <button type="button" className={styles.trigger} onClick={onOpen}>
      <span className={styles.triggerIcon}>{RUNTIME_ICON[spec.runtime] ?? '🎬'}</span>
      <span className={styles.triggerBody}>
        <span className={styles.triggerName}>{spec.name}</span>
        <span className={styles.triggerDetail}>
          {spec.resolution} · {spec.minDurationSec}–{spec.maxDurationSec}с
          {spec.runtime === 'local' ? ' · локально' : ''}
          {!isReady ? ' · не установлена' : ''}
        </span>
      </span>
      <span className={styles.triggerChevron}>▾</span>
    </button>
  );
}

/* ─── Modal picker ──────────────────────────────────────────────────── */

export function ModelPickerModal({
  activeModelId,
  readyModelIds,
  onSelect,
  capabilityFilter = null,
}: ModelPickerProps & { onClose: () => void }): ReactNode {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<ModelSortKey>('default');
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    let list = [...VIDEO_PROVIDERS];
    if (capabilityFilter) {
      list = list.filter((p) => p.capability === capabilityFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          p.resolution.toLowerCase().includes(q),
      );
    }
    return sortProviders(list, sortKey);
  }, [search, sortKey, capabilityFilter]);

  const localModels = useMemo(() => filtered.filter((p) => p.runtime === 'local'), [filtered]);
  const cloudModels = useMemo(() => filtered.filter((p) => p.runtime === 'cloud'), [filtered]);

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
    },
    [onSelect],
  );

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSelect(activeModelId); // close without change
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeModelId, onSelect]);

  return (
    <div className={styles.panel}>
      {/* Search */}
      <div className={styles.header}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Поиск моделей…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      {/* Sort tabs */}
      <div className={styles.sortRow}>
        {(Object.keys(SORT_LABELS) as ModelSortKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className={styles.sortBtn}
            data-active={sortKey === key}
            onClick={() => setSortKey(key)}
          >
            {SORT_LABELS[key]}
          </button>
        ))}
      </div>

      {/* List */}
      <div className={styles.list} ref={listRef}>
        {filtered.length === 0 ? (
          <div className={styles.emptyState}>Нет подходящих моделей</div>
        ) : (
          <>
            {localModels.length > 0 && (
              <>
                <div className={styles.sectionLabel}>
                  <span className={styles.sectionIcon}>⚡</span>
                  Локальные (бесплатно)
                </div>
                {localModels.map((spec) => (
                  <ModelCard
                    key={spec.id}
                    spec={spec}
                    isSelected={activeModelId === spec.id}
                    isReady={readyModelIds.includes(spec.id)}
                    onSelect={handleSelect}
                  />
                ))}
              </>
            )}
            {cloudModels.length > 0 && (
              <>
                <div className={styles.sectionLabel}>
                  <span className={styles.sectionIcon}>☁️</span>
                  Облачные (API ключ)
                </div>
                {cloudModels.map((spec) => (
                  <ModelCard
                    key={spec.id}
                    spec={spec}
                    isSelected={activeModelId === spec.id}
                    isReady={readyModelIds.includes(spec.id)}
                    onSelect={handleSelect}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Individual model card ─────────────────────────────────────────── */

interface ModelCardProps {
  spec: VideoProviderSpec;
  isSelected: boolean;
  isReady: boolean;
  onSelect: (id: string) => void;
}

function ModelCard({ spec, isSelected, isReady, onSelect }: ModelCardProps): ReactNode {
  return (
    <button
      type="button"
      className={styles.card}
      data-selected={isSelected}
      data-disabled={!isReady}
      onClick={() => {
        if (isReady) onSelect(spec.id);
      }}
      title={!isReady ? 'Модель не установлена или нет API ключа' : undefined}
    >
      <span className={styles.cardIcon}>{RUNTIME_ICON[spec.runtime] ?? '🎬'}</span>

      <span className={styles.cardBody}>
        <span className={styles.cardTitle}>
          {spec.name}
          {spec.badge ? (
            <span className={styles.badge} data-badge={spec.badge}>
              {BADGE_LABELS[spec.badge] ?? spec.badge}
            </span>
          ) : null}
        </span>
        <span className={styles.cardMeta}>
          <span className={styles.cardMetaItem}>📐 {spec.resolution}</span>
          <span className={styles.cardMetaItem}>⏱ {spec.minDurationSec}–{spec.maxDurationSec}с</span>
          <span className={styles.cardMetaItem}>
            {spec.runtime === 'local' ? '🕐 ' : '⚡ '}
            {formatEstimatedTime(spec.estimatedGenSec)}
          </span>
          {spec.supportsAudio ? <span className={styles.cardMetaItem}>🔊 Аудио</span> : null}
          {spec.startEndMode ? <span className={styles.cardMetaItem}>🎞 Start+End</span> : null}
        </span>
        <span className={styles.cardMeta}>
          <span className={styles.qualityStars}>{qualityStars(spec.qualityRating)}</span>
          <span className={styles.cardMetaItem}>{formatPrice(spec.pricePerSec)}</span>
          {!isReady ? (
            <span className={styles.cardMetaItem} style={{ color: 'var(--color-accent)' }}>
              {spec.runtime === 'local' ? '↓ скачать' : '🔑 нет ключа'}
            </span>
          ) : null}
        </span>
      </span>

      <span className={styles.checkMark}>{isSelected ? '✓' : ''}</span>
    </button>
  );
}

/* ─── Full picker with overlay ──────────────────────────────────────── */

export function ModelPicker({
  activeModelId,
  readyModelIds,
  onSelect,
  capabilityFilter = null,
  open,
  onClose,
}: ModelPickerProps & { open: boolean; onClose: () => void }): ReactNode {
  if (!open) return null;

  const handleSelect = (id: string) => {
    onSelect(id);
    onClose();
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <ModelPickerModal
        activeModelId={activeModelId}
        readyModelIds={readyModelIds}
        onSelect={handleSelect}
        onClose={onClose}
        capabilityFilter={capabilityFilter}
      />
    </div>
  );
}
