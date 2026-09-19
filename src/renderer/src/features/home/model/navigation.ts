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
  { id: 'home',     label: 'Home',      group: 'projects', Icon: HomeIcon },
  { id: 'projects', label: 'Проекты',   group: 'projects', Icon: FolderIcon },
  { id: 'video',    label: 'Студия',    group: 'studio',   Icon: FilmIcon },
  { id: 'create',   label: 'Создать',   group: 'lab',      Icon: SparklesIcon },
  { id: 'threed',   label: '3D',        group: 'lab',      Icon: CubeIcon },
  { id: 'assets',   label: 'Ассеты',   group: 'lab',      Icon: LayersIcon },
  { id: 'studio',   label: 'Модели',   group: 'system',   Icon: SlidersIcon },
  { id: 'settings', label: 'Настройки', group: 'system',   Icon: SettingsIcon },
] satisfies NavigationEntry[];

/** Type guard to validate a NavId at runtime. */
export function isValidNavId(id: string): id is NavId {
  return NAVIGATION_ITEMS.some((item) => item.id === id);
}
