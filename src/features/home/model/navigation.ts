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
const NAVIGATION_MODEL = new Map<NavItemId, NavigationEntry>([
  ['home', { id: 'home', label: 'Home', Icon: HomeIcon }],
  ['create', { id: 'create', label: 'Create', Icon: SparklesIcon }],
  ['projects', { id: 'projects', label: 'Projects', Icon: FolderIcon }],
  ['assets', { id: 'assets', label: 'Assets', Icon: LayersIcon }],
  ['studio', { id: 'studio', label: 'Studio', Icon: SlidersIcon }],
  ['settings', { id: 'settings', label: 'Settings', Icon: SettingsIcon }],
]);

export const NAVIGATION_ITEMS: readonly NavigationEntry[] = [
  ...NAVIGATION_MODEL.values(),
];
