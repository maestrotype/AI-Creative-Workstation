export type EditorMediaKind = 'video' | 'image' | 'audio';

export interface EditorMediaVersion {
  id: string;
  path: string;
  durationSec: number;
  createdAt: number;
  derivedFromVersionId?: string | null;
  generationJobId?: string | null;
}

export interface EditorMediaAsset {
  id: string;
  kind: EditorMediaKind;
  name: string;
  currentVersionId: string;
  versions: EditorMediaVersion[];
  createdAt: number;
}

export type GenerationJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface EditorGenerationJob {
  id: string;
  operation: string;
  status: GenerationJobStatus;
  inputMediaIds: string[];
  outputMediaIds: string[];
  modelId?: string | null;
  prompt?: string;
  progress?: number;
  error?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface LegacyTimelineBin {
  id: string;
  kind: EditorMediaKind;
  path: string;
  name: string;
  durationSec: number;
}

export function isLegacyTimelineBin(value: unknown): value is LegacyTimelineBin {
  if (!value || typeof value !== 'object') return false;
  const bin = value as Partial<LegacyTimelineBin>;
  return typeof bin.id === 'string'
    && (bin.kind === 'video' || bin.kind === 'image' || bin.kind === 'audio')
    && typeof bin.path === 'string'
    && typeof bin.name === 'string'
    && typeof bin.durationSec === 'number';
}

export function legacyBinsOf(bins: unknown): LegacyTimelineBin[] {
  return Array.isArray(bins) ? bins.filter(isLegacyTimelineBin) : [];
}

function safeId(value: string): string {
  const id = value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return id || 'media';
}

/**
 * Non-destructive bridge from the current timeline bin model.
 *
 * Timeline bins remain valid while the editor migrates to project media ids.
 * Paths are deduplicated because several clip instances may use one source.
 */
export function mediaLibraryFromLegacyBins(
  bins: LegacyTimelineBin[],
  createdAt: number,
): EditorMediaAsset[] {
  const byPath = new Map<string, EditorMediaAsset>();
  for (const bin of bins) {
    const path = bin.path.trim();
    if (!path || byPath.has(path)) continue;
    const stem = safeId(bin.id);
    const versionId = `version-${stem}`;
    byPath.set(path, {
      id: `media-${stem}`,
      kind: bin.kind,
      name: bin.name.trim() || path.split(/[\\/]/).at(-1) || 'Media',
      currentVersionId: versionId,
      versions: [{
        id: versionId,
        path,
        durationSec: Math.max(0, Number(bin.durationSec) || 0),
        createdAt,
      }],
      createdAt,
    });
  }
  return [...byPath.values()];
}

/**
 * Keep existing versions and add any timeline bin that is not in the library yet.
 * Load/save use this so opening a project does not drop AI alternatives.
 */
export function mergeMediaFromBins(
  existing: EditorMediaAsset[] | undefined,
  bins: LegacyTimelineBin[],
  createdAt: number,
): EditorMediaAsset[] {
  const library = [...(existing ?? [])];
  const knownPaths = new Set(
    library.flatMap((asset) => asset.versions.map((version) => version.path.trim()).filter(Boolean)),
  );
  for (const asset of mediaLibraryFromLegacyBins(bins, createdAt)) {
    const path = asset.versions[0]?.path.trim();
    if (!path || knownPaths.has(path)) continue;
    library.push(asset);
    knownPaths.add(path);
  }
  return library;
}

/** Add an AI/imported alternative without overwriting the current file. */
export function appendMediaVersion(
  asset: EditorMediaAsset,
  version: EditorMediaVersion,
  makeCurrent = false,
): EditorMediaAsset {
  if (asset.versions.some((item) => item.id === version.id)) return asset;
  return {
    ...asset,
    currentVersionId: makeCurrent ? version.id : asset.currentVersionId,
    versions: [...asset.versions, version],
  };
}

export function frameToSeconds(frame: number, fps: number): number {
  return Math.max(0, Math.round(frame)) / Math.max(1, fps);
}

export function secondsToFrame(seconds: number, fps: number): number {
  return Math.max(0, Math.round(Math.max(0, seconds) * Math.max(1, fps)));
}
