/**
 * SideNavigation — primary navigation rail (presentational).
 *
 * Dumb component: items and active ID arrive via props.
 * No business logic, no store access, no inline styles.
 */
import type { ReactNode } from 'react';

import type { NavId } from '../../../../core/types';
import { cx } from '../../../../shared/lib/cx';
import { SparklesIcon, UserIcon } from '../../../../shared/ui/icons';
import type { NavigationEntry } from '../../model/navigation';
import styles from './SideNavigation.module.css';

/* ─── Props ─────────────────────────────────────────────────────────── */

export interface SideNavigationProps {
  /** Ordered navigation entries from the feature model. */
  readonly items: readonly NavigationEntry[];
  /** Currently active navigation item. */
  readonly activeId: NavId;
  /** Called when the user selects a navigation item. */
  readonly onSelect: (id: NavId) => void;
}

/* ─── Component ─────────────────────────────────────────────────────── */

export function SideNavigation({
  items,
  activeId,
  onSelect,
}: SideNavigationProps): ReactNode {
  return (
    <nav className={styles.nav} aria-label="Primary navigation">
      {/* Brand */}
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true">
          <SparklesIcon size={15} />
        </span>
        <span className={styles.brandName}>Canvas</span>
      </div>

      {/* Navigation items */}
      <ul className={styles.list}>
        {items.map(({ id, label, Icon }) => {
          const isActive = activeId === id;
          return (
            <li key={id}>
              <button
                type="button"
                className={cx(styles.item, isActive && styles.itemActive)}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onSelect(id)}
              >
                <Icon size={18} />
                <span className={styles.itemLabel}>{label}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Footer — workspace status */}
      <div className={styles.footer}>
        <span className={styles.avatar} aria-hidden="true">
          <UserIcon size={14} />
        </span>
        <span className={styles.accountMeta}>
          <span className={styles.accountName}>Local workspace</span>
          <span className={styles.accountStatus}>
            <span className={styles.statusDot} aria-hidden="true" />
            Offline-ready
          </span>
        </span>
      </div>
    </nav>
  );
}
