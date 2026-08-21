/**
 * SideNavigation — primary navigation rail (presentational).
 * Dumb component (Rule 3): items and active id arrive via props.
 */
import type { ReactNode } from 'react';

import type { NavItemId } from '../../../../core/types';
import type { NavigationEntry } from '../../model/navigation';
import { cx } from '../../../../shared/lib/cx';
import { SparklesIcon, UserIcon } from '../../../../shared/ui/icons';
import styles from './sideNavigation.module.css';

export interface SideNavigationProps {
  /** Ordered navigation entries (label + icon) from the feature model. */
  items: readonly NavigationEntry[];
  activeId: NavItemId;
  /** Called with the id of the item the user picked. */
  onSelect: (id: NavItemId) => void;
}

export function SideNavigation({ items, activeId, onSelect }: SideNavigationProps): ReactNode {
  return (
    <nav className={styles.nav} aria-label="Primary">
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true">
          <SparklesIcon size={15} />
        </span>
        <span className={styles.brandName}>Canvas</span>
      </div>

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

      <div className={styles.footer}>
        <span className={styles.avatar} aria-hidden="true">
          <UserIcon size={15} />
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