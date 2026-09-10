/**
 * AI Creative Workstation — domain types (single source of truth).
 *
 * These types define the data contracts for the entire application.
 * UI layers import from here; they never redeclare their own copies.
 * This is the "core" layer in FSD terminology.
 */

/* ─── Asset types ───────────────────────────────────────────────────── */

/** The kinds of creative entities the app surfaces in the UI. */
export type AssetKind = 'character' | 'image' | 'video' | 'project';

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
  /** Preview image. For clips this is a mid-frame; the file itself is `id` / thumbnail of the mp4. */
  readonly posterUrl?: string | null;
  readonly updatedAt: string;
  readonly prompt?: string | null;
  readonly capability?: string | null;
  readonly providerId?: string | null;
  readonly promptConsumed?: boolean | null;
  readonly videoStatus?: string | null;
  readonly quality?: GenerationResult['quality'] | null;
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
  readonly kind?: 'image' | 'video';
  readonly capability?: string;
  readonly providerId?: string;
  readonly videoStatus?: string;
  readonly promptConsumed?: boolean;
  readonly quality?: {
    duration_sec?: number;
    fps?: number;
    frame_count?: number;
    motion_score?: number | null;
    motion_mae?: number;
    identity_mae?: number | null;
    identity_warning?: boolean;
    low_motion?: boolean;
    prompt_wan?: string;
    prompt_intent?: string;
    prompt_english?: string;
  };
}

/* ─── Navigation types ──────────────────────────────────────────────── */

/** Identifiers for primary sidebar navigation items. */
export type NavId = 'home' | 'create' | 'threed' | 'video' | 'projects' | 'assets' | 'studio' | 'settings';

/** A primary navigation entry (pure data — no UI concerns). */
export interface NavItem {
  readonly id: NavId;
  readonly label: string;
}
