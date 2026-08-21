/**
 * Domain types — the single source of truth for Canvas data models (Rule 6).
 * Mirrors docs/architecture/DOMAIN_MODEL.md; UI layers must import from here,
 * never redeclare their own copies.
 */

/** Kinds of creative entities surfaced in the UI. */
export type AssetType = 'character' | 'image' | 'project';

/** A creative asset (character, generated image or project) as shown in the UI. */
export interface Asset {
  /** Stable unique identifier (UUID in production). */
  readonly id: string;
  /** Human-readable display name. */
  readonly name: string;
  /** Entity kind — drives iconography and metadata in the UI. */
  readonly type: AssetType;
  /** Thumbnail source (local path / data URI). `null` → generated placeholder. */
  readonly thumbnailUrl: string | null;
  /** ISO-8601 timestamp of the last modification. */
  readonly updatedAt: string;
}

/** Identifiers for primary navigation items (left sidebar). */
export type NavItemId = 'home' | 'create' | 'projects' | 'assets' | 'studio' | 'settings';

/** A primary navigation entry. */
export interface NavItem {
  readonly id: NavItemId;
  readonly label: string;
}
