/**
 * AI Creative Workstation — domain types (single source of truth).
 *
 * These types define the data contracts for the entire application.
 * UI layers import from here; they never redeclare their own copies.
 * This is the "core" layer in FSD terminology.
 */

/* ─── Asset types ───────────────────────────────────────────────────── */

/** The kinds of creative entities the app surfaces in the UI. */
export type AssetKind = 'character' | 'image' | 'project';

/**
 * A creative asset as represented in the application.
 * Immutable by convention — all fields are readonly.
 */
export interface Asset {
  /** Stable unique identifier (UUID in production). */
  readonly id: string;
  /** Human-readable display name. */
  readonly name: string;
  /** Entity kind — determines iconography and metadata rendering. */
  readonly kind: AssetKind;
  /** Thumbnail source (local path or data URI). `null` → placeholder icon. */
  readonly thumbnailUrl: string | null;
  /** ISO-8601 timestamp of the last modification. */
  readonly updatedAt: string;
}

/* ─── Generation types ──────────────────────────────────────────────── */

/** The result of a single generation run. */
export interface GenerationResult {
  /** Stable unique identifier. */
  readonly id: string;
  /** The prompt used for this generation. */
  readonly prompt: string;
  /** Thumbnail source. `null` in mock/MVP — shows gradient placeholder. */
  readonly thumbnailUrl: string | null;
  /** ISO-8601 creation timestamp. */
  readonly createdAt: string;
}

/* ─── Navigation types ──────────────────────────────────────────────── */

/** Identifiers for primary sidebar navigation items. */
export type NavId = 'home' | 'create' | 'video' | 'projects' | 'assets' | 'studio' | 'settings';

/** A primary navigation entry (pure data — no UI concerns). */
export interface NavItem {
  readonly id: NavId;
  readonly label: string;
}
