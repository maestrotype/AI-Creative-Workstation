import { useEffect, useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DOCK_PANEL_IDS,
  DOCK_TITLE_KEYS,
  applyFreePanelPatch,
  clampHpx,
  clampSpan,
  clampSpanFloat,
  defaultDockState,
  fitTileSpan,
  loadDockState,
  packTileLayout,
  saveDockState,
  tileToFreeLayout,
  type DockPanelId,
  type DockRect,
  type DockState,
} from '../model/videoDockLayout';
import styles from './VideoDock.module.css';

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface Job {
  id: DockPanelId;
  kind: 'move' | Edge;
  sx: number;
  sy: number;
  orig: DockRect;
}

interface VideoDockProps {
  state: DockState;
  onState: (state: DockState) => void;
  panels: Record<DockPanelId, ReactNode>;
}

const GROUPS: { labelKey: string; ids: DockPanelId[]; actionKey?: string }[] = [
  { labelKey: 'video.menu_group_sources', ids: ['sources'], actionKey: 'video.menu_voiceover' },
  { labelKey: 'video.menu_group_edit', ids: ['timeline', 'preview'] },
  { labelKey: 'video.menu_group_generate', ids: ['storyboard', 'recording'] },
];

export function VideoMenuBar({
  state,
  onState,
  onOpenVoiceover,
}: {
  state: DockState;
  onState: (s: DockState) => void;
  onOpenVoiceover?: () => void;
}): ReactNode {
  const { t } = useTranslation();

  const toggle = (id: DockPanelId) => {
    const rect = state.panels[id];
    const visible = !rect.visible;
    const span = visible && state.mode === 'tile'
      ? fitTileSpan(state, id)
      : rect.span;
    onState({
      ...state,
      panels: {
        ...state.panels,
        [id]: { ...rect, visible, span, z: maxZ(state) + 1 },
      },
    });
  };

  return (
    <header className={styles.menuBar}>
      <div className={styles.menuTop}>
        <div className={styles.menuBrand}>
          <span className={styles.brand}>{t('video.title')}</span>
          <span className={styles.brandHint}>{t('video.menu_lead')}</span>
        </div>
        <div className={styles.menuTools}>
          <span className={styles.toolsLabel}>{t('video.menu_layout_label')}</span>
          <div className={styles.modeSwitch}>
            <button
              type="button"
              className={styles.modeBtn}
              data-on={state.mode === 'tile'}
              title={t('video.menu_layout_tile_hint')}
              onClick={() => onState(packTileLayout({ ...state, mode: 'tile' }))}
            >
              {t('video.menu_layout_tile')}
            </button>
            <button
              type="button"
              className={styles.modeBtn}
              data-on={state.mode === 'free'}
              title={t('video.menu_layout_free_hint')}
              onClick={() => onState(tileToFreeLayout(state))}
            >
              {t('video.menu_layout_free')}
            </button>
          </div>
          <button
            type="button"
            className={styles.resetBtn}
            onClick={() => {
              const base = packTileLayout({ ...defaultDockState(), mode: 'tile' });
              onState(state.mode === 'free' ? tileToFreeLayout(base) : { ...base, mode: state.mode });
            }}
          >
            {t('video.menu_reset')}
          </button>
        </div>
      </div>
      <div className={styles.menuGroups}>
        {GROUPS.map((group) => (
          <section key={group.labelKey} className={styles.menuGroup}>
            <span className={styles.groupLabel}>{t(group.labelKey)}</span>
            <div className={styles.chipRow}>
              {group.ids.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={styles.chip}
                  data-on={state.panels[id].visible}
                  onClick={() => toggle(id)}
                >
                  {t(DOCK_TITLE_KEYS[id])}
                </button>
              ))}
              {group.actionKey && onOpenVoiceover ? (
                <button
                  type="button"
                  className={styles.chipAction}
                  onClick={onOpenVoiceover}
                >
                  {t(group.actionKey)}
                </button>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </header>
  );
}

export function VideoDock({ state, onState, panels }: VideoDockProps): ReactNode {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLDivElement>(null);
  const freeSurfaceRef = useRef<HTMLDivElement>(null);
  const job = useRef<Job | null>(null);

  useEffect(() => {
    saveDockState(state);
  }, [state]);

  const patch = (id: DockPanelId, next: Partial<DockRect>) => {
    if (state.mode === 'free') {
      onState(applyFreePanelPatch(state, id, next));
      return;
    }
    onState({ ...state, panels: { ...state.panels, [id]: { ...state.panels[id], ...next } } });
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const j = job.current;
    const canvas = canvasRef.current;
    if (!j || !canvas) return;

    if (state.mode === 'tile') {
      if (j.kind === 'move') {
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-dock-id]') as HTMLElement | null;
        const overId = el?.dataset.dockId as DockPanelId | undefined;
        if (overId && overId !== j.id) {
          const a = state.panels[j.id].order;
          const b = state.panels[overId].order;
          onState({
            ...state,
            panels: {
              ...state.panels,
              [j.id]: { ...state.panels[j.id], order: b },
              [overId]: { ...state.panels[overId], order: a },
            },
          });
        }
        return;
      }
      const box = canvas.getBoundingClientRect();
      const dx = e.clientX - j.sx;
      const dy = e.clientY - j.sy;
      const colW = box.width / 12;
      const next: Partial<DockRect> = {};
      // Use float clamp during drag for smooth resize; snap to integer on pointerUp
      if (j.kind.includes('e')) next.span = clampSpanFloat(j.orig.span + dx / colW);
      if (j.kind.includes('s')) next.hpx = clampHpx(j.orig.hpx + dy);
      if (Object.keys(next).length) patch(j.id, next);
      return;
    }

    // Free mode: measure relative to freeSurface, not freeCanvas,
    // so scrolled canvas position doesn't offset coordinates.
    const surface = freeSurfaceRef.current ?? canvas;
    const box = surface.getBoundingClientRect();
    const surfaceW = box.width;
    const surfaceH = box.height;

    const dx = surfaceW > 0 ? ((e.clientX - j.sx) / surfaceW) * 100 : 0;
    const dy = surfaceH > 0 ? ((e.clientY - j.sy) / surfaceH) * 100 : 0;
    const o = j.orig;
    let next: DockRect = { ...o };
    if (j.kind === 'move') {
      next = { ...o, x: o.x + dx, y: o.y + dy };
    } else {
      if (j.kind.includes('e')) next = { ...next, w: o.w + dx };
      if (j.kind.includes('s')) next = { ...next, h: o.h + dy };
      if (j.kind.includes('w')) next = { ...next, x: o.x + dx, w: o.w - dx };
      if (j.kind.includes('n')) next = { ...next, y: o.y + dy, h: o.h - dy };
    }
    patch(j.id, next);
  };

  const onPointerUp = () => {
    const j = job.current;
    if (j && state.mode === 'tile' && typeof state.panels[j.id].span === 'number') {
      // Snap span to integer grid on release
      const snapped = clampSpan(state.panels[j.id].span);
      if (snapped !== state.panels[j.id].span) {
        onState({ ...state, panels: { ...state.panels, [j.id]: { ...state.panels[j.id], span: snapped } } });
      }
    }
    job.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  const startJob = (e: PointerEvent<HTMLElement>, id: DockPanelId, kind: Job['kind']) => {
    job.current = { id, kind, sx: e.clientX, sy: e.clientY, orig: { ...state.panels[id] } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // Lock cursor globally so it doesn't flicker when mouse drifts off the handle
    const cursorMap: Partial<Record<Job['kind'], string>> = {
      move: 'grabbing',
      n: 'ns-resize', s: 'ns-resize',
      e: 'ew-resize', w: 'ew-resize',
      ne: 'nesw-resize', sw: 'nesw-resize',
      nw: 'nwse-resize', se: 'nwse-resize',
    };
    document.body.style.cursor = cursorMap[kind] ?? 'default';
    document.body.style.userSelect = 'none';
  };

  const visible = DOCK_PANEL_IDS
    .filter((id) => state.panels[id].visible)
    .sort((a, b) => state.panels[a].order - state.panels[b].order);

  if (visible.length === 0) {
    return <div className={styles.emptyDock}>{t('video.menu_all_hidden')}</div>;
  }

  const tile = state.mode === 'tile';
  const edges: Edge[] = tile ? ['e', 's', 'se'] : ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  const freeH = state.freeCanvasHpx ?? 720;

  const panelNodes = visible.map((id) => {
    const rect = state.panels[id];
    const style = tile
      ? { gridColumn: `span ${Math.round(rect.span)}`, height: rect.hpx }
      : {
          left: `${rect.x}%`,
          top: `${rect.y}%`,
          width: `${rect.w}%`,
          height: `${rect.h}%`,
          zIndex: rect.z,
        };
    return (
      <article
        key={id}
        data-dock-id={id}
        className={`${styles.frame} ${tile ? styles.tileFrame : styles.freeFrame}`}
        style={style}
        onPointerDown={() => {
          if (!tile) patch(id, { z: maxZ(state) + 1 });
        }}
      >
        <div
          className={styles.title}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            startJob(e, id, 'move');
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <span>{t(DOCK_TITLE_KEYS[id])}</span>
          <button type="button" className={styles.close} onClick={() => patch(id, { visible: false })}>
            ×
          </button>
        </div>
        <div className={styles.body}>{panels[id]}</div>
        {edges.map((edge) => (
          <span
            key={edge}
            className={styles.handle}
            data-edge={edge}
            onPointerDown={(e) => {
              e.stopPropagation();
              startJob(e, id, edge);
            }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        ))}
      </article>
    );
  });

  return (
    <div className={styles.dockRoot}>
      <div className={tile ? styles.tileCanvas : styles.freeCanvas} ref={canvasRef}>
        {tile ? (
          panelNodes
        ) : (
          <div
            ref={freeSurfaceRef}
            className={styles.freeSurface}
            style={{ ['--free-surface-h' as string]: `${freeH}px` }}
          >
            {panelNodes}
          </div>
        )}
      </div>
    </div>
  );
}

function maxZ(state: DockState): number {
  return Math.max(...DOCK_PANEL_IDS.map((id) => state.panels[id].z), 1);
}

export function useDockLayout(): [DockState, (state: DockState) => void] {
  const [state, setState] = useState<DockState>(() => loadDockState());
  return [state, setState];
}
