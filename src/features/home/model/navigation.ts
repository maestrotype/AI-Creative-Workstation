/**
 * Home feature — navigation model.
 * Data layer: maps core `NavItem` records to presentational entries with icons,
 * keeping UI concerns out of the core domain types (Rule 6).
 */
import type { ComponentType } from 'react';

import type { NavItem as CoreNavItem, NavItemId } from '../../../core/types';
import {
  FolderIcon,
  HomeIcon,
  LayersIcon,
  SettingsIcon,
  SlidersIcon,
  SparklesIcon,
} from '../../../shared/ui/icons';

export interface NavigationEntry extends CoreNavItem {
  /** Presentational icon for this entry (no business logic). */
  readonly Icon: ComponentType<{ size?: number; className?: string }>;
}

/** Primary navigation order per docs/ux/INFORMATION_ARCHITECTURE.md. */
export const NAVIGATION_ITEMS = [
  { id: 'home', label: 'Home', Icon: HomeIcon },
  { id: 'create', label: 'Create', Icon: SparklesIcon },
  { id: 'projects', label: 'Projects', Icon: FolderIcon },
  { id: 'assets', label: 'Assets', Icon: LayersIcon },
  { id: 'studio', label: 'Studio', Icon: SlidersIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
] satisfies readonly NavigationEntry[];

/** Type guard to validate a `NavItemId` at runtime (e.g. from URL or storage). */
export function isValidNavId(id: string): id is NavItemId {
  return NAVIGATION_ITEMS.some((item) => item.id === id);
}
