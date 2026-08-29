/**
 * Home feature — navigation model.
 *
 * Maps core NavItem data to presentational entries with icon components.
 * This keeps UI concerns (icons) out of the core domain types.
 */
import type { ComponentType } from 'react';

import type { NavId, NavItem } from '../../../core/types';
import type { IconProps } from '../../../shared/ui/icons';
import {
  CubeIcon,
  FilmIcon,
  FolderIcon,
  HomeIcon,
  LayersIcon,
  SettingsIcon,
  SlidersIcon,
  SparklesIcon,
} from '../../../shared/ui/icons';

/* ─── Types ─────────────────────────────────────────────────────────── */

export interface NavigationEntry extends NavItem {
  /** Presentational icon for this navigation entry. */
  readonly Icon: ComponentType<IconProps>;
}

/* ─── Data ──────────────────────────────────────────────────────────── */

/** Primary navigation order — matches the product information architecture. */
export const NAVIGATION_ITEMS: readonly NavigationEntry[] = [
  { id: 'home',     label: 'Home',     Icon: HomeIcon },
  { id: 'create',   label: 'Create',   Icon: SparklesIcon },
  { id: 'threed',   label: '3D',       Icon: CubeIcon },
  { id: 'video',    label: 'Video',    Icon: FilmIcon },
  { id: 'projects', label: 'Projects', Icon: FolderIcon },
  { id: 'assets',   label: 'Assets',   Icon: LayersIcon },
  { id: 'studio',   label: 'Studio',   Icon: SlidersIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
] satisfies NavigationEntry[];

/** Type guard to validate a NavId at runtime. */
export function isValidNavId(id: string): id is NavId {
  return NAVIGATION_ITEMS.some((item) => item.id === id);
}
