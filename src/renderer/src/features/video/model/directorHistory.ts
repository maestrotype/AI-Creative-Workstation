import type { Callout } from './callout';
import type { BinItem, TimelineClip, TrackLayout } from './directorTimeline';

/** Snapshot of editable film timeline state for undo/redo. */
export interface DirectorHistorySnap {
  clips: TimelineClip[];
  bins: BinItem[];
  callouts: Callout[];
  productStillPath: string | null;
  assemblyRationale: string | null;
  trackLayout: TrackLayout;
  selectedClip: string | null;
  selectedBin: string | null;
  selectedCallout: string | null;
}

const LIMIT = 40;

function cloneSnap(snap: DirectorHistorySnap): DirectorHistorySnap {
  return {
    clips: snap.clips.map((c) => ({ ...c })),
    bins: snap.bins.map((b) => ({ ...b })),
    callouts: snap.callouts.map((c) => ({ ...c })),
    productStillPath: snap.productStillPath,
    assemblyRationale: snap.assemblyRationale,
    trackLayout: { ...snap.trackLayout },
    selectedClip: snap.selectedClip,
    selectedBin: snap.selectedBin,
    selectedCallout: snap.selectedCallout,
  };
}

export function createDirectorHistory(limit = LIMIT) {
  const past: DirectorHistorySnap[] = [];
  const future: DirectorHistorySnap[] = [];

  return {
    push(snap: DirectorHistorySnap) {
      past.push(cloneSnap(snap));
      if (past.length > limit) past.shift();
      future.length = 0;
    },
    undo(current: DirectorHistorySnap): DirectorHistorySnap | null {
      if (past.length === 0) return null;
      future.push(cloneSnap(current));
      return past.pop() ?? null;
    },
    redo(current: DirectorHistorySnap): DirectorHistorySnap | null {
      if (future.length === 0) return null;
      past.push(cloneSnap(current));
      return future.pop() ?? null;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    clear() {
      past.length = 0;
      future.length = 0;
    },
  };
}

export type DirectorHistory = ReturnType<typeof createDirectorHistory>;
