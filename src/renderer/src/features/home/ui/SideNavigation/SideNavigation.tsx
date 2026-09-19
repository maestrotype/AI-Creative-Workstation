/**
 * SideNavigation — primary navigation rail (presentational).
 *
 * Dumb component: items and active ID arrive via props.
 * No business logic, no store access, no inline styles.
 */
import type { ReactNode } from 'react';

import { useTranslation } from 'react-i18next';
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
  readonly engineStatus?: 'stopped' | 'starting' | 'ready' | 'error';
  /** Optional active project name to show in the sidebar context badge. */
  readonly activeProjectName?: string | null;
}

/* ─── Component ─────────────────────────────────────────────────────── */

export function SideNavigation({
  items,
  activeId,
  onSelect,
  engineStatus = 'stopped',
  activeProjectName,
}: SideNavigationProps): ReactNode {
  const { t } = useTranslation();

  const statusLabel =
    engineStatus === 'ready'
      ? t('nav.engine_ready')
      : engineStatus === 'starting'
        ? t('nav.engine_starting')
        : engineStatus === 'error'
          ? t('nav.engine_error')
          : t('nav.engine_offline');

  // Build grouped list with dividers between sections
  const navNodes: ReactNode[] = [];
  let lastGroup: string | undefined = undefined;

  for (const entry of items) {
    const { id, Icon, group } = entry;
    const isActive = activeId === id;

    // Insert group divider + header when group changes
    if (group && group !== lastGroup) {
      if (lastGroup !== undefined) {
        navNodes.push(<hr key={`divider-${group}`} className={styles.groupDivider} />);
      }
      const groupLabel = t(`nav.group_${group}`, '');
      if (groupLabel) {
        navNodes.push(
          <li key={`header-${group}`} className={styles.groupLabel} aria-hidden="true">
            {groupLabel}
          </li>,
        );
      }
      lastGroup = group;
    }

    navNodes.push(
      <li key={id}>
        <button
          type="button"
          className={cx(styles.item, isActive && styles.itemActive)}
          aria-current={isActive ? 'page' : undefined}
          onClick={() => onSelect(id)}
        >
          <Icon size={18} />
          <span className={styles.itemLabel}>{t(`nav.${id}`)}</span>
        </button>
      </li>,
    );
  }

  return (
    <nav className={styles.nav} aria-label="Primary navigation">
      {/* Brand */}
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true">
          <SparklesIcon size={15} />
        </span>
        <span className={styles.brandName}>AI Creative Workstation</span>
      </div>

      {/* Active project context badge */}
      {activeProjectName ? (
        <div className={styles.projectBadge}>
          <span className={styles.projectBadgeLabel}>{t('nav.active_project')}</span>
          <span className={styles.projectBadgeName}>{activeProjectName}</span>
        </div>
      ) : null}

      {/* Navigation items */}
      <ul className={styles.list}>
        {navNodes}
      </ul>

      {/* Footer — workspace status */}
      <div className={styles.footer}>
        <span className={styles.avatar} aria-hidden="true">
          <UserIcon size={14} />
        </span>
        <span className={styles.accountMeta}>
          <span className={styles.accountName}>{t('nav.local_workspace')}</span>
          <span className={styles.accountStatus}>
            <span
              className={cx(
                styles.statusDot,
                engineStatus === 'ready' && styles.statusDotReady,
                engineStatus === 'starting' && styles.statusDotStarting,
                (engineStatus === 'error' || engineStatus === 'stopped') && styles.statusDotDown,
              )}
              aria-hidden="true"
            />
            {statusLabel}
          </span>
        </span>
      </div>
    </nav>
  );
}
