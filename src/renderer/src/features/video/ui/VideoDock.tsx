import { useEffect, useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DOCK_PANEL_IDS,
  DOCK_TITLE_KEYS,
  clampFree,
  clampHpx,
  clampSpan,
  defaultDockState,
  loadDockState,
  saveDockState,
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

const GROUPS: { labelKey: string; ids: DockPanelId[] }[] = [
  { labelKey: 'video.menu_group_edit', ids: ['timeline', 'preview'] },
  { labelKey: 'video.menu_group_sources', ids: ['sources', 'cut'] },
  { labelKey: 'video.menu_group_generate', ids: ['storyboard', 'recording'] },
];

export function VideoMenuBar({ state, onState }: { state: DockState; onState: (s: DockState) => void }): ReactNode {
  const { t } = useTranslation();

  const toggle = (id: DockPanelId) => {
    const rect = state.panels[id];
    onState({
      ...state,
      panels: { ...state.panels, [id]: { ...rect, visible: !rect.visible, z: maxZ(state) + 1 } },
    });
  };

  return (
    <header className={styles.menuBar}>
      <span className={styles.brand}>{t('video.title')}</span>
      {GROUPS.map((group) => (
        <div key={group.labelKey} className={styles.chipGroup}>
          <span className={styles.groupLabel}>{t(group.labelKey)}</span>
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
        </div>
      ))}
      <div className={styles.menuRight}>
        <div className={styles.modeSwitch}>
          <button
            type="button"
            className={styles.modeBtn}
            data-on={state.mode === 'tile'}
            title={t('video.menu_layout_tile_hint')}
            onClick={() => onState({ ...state, mode: 'tile' })}
          >
            {t('video.menu_layout_tile')}
          </button>
          <button
            type="button"
            className={styles.modeBtn}
            data-on={state.mode === 'free'}
            title={t('video.menu_layout_free_hint')}
            onClick={() => onState({ ...state, mode: 'free' })}
          >
            {t('video.menu_layout_free')}
          </button>
        </div>
        <button
          type="button"
          className={styles.chip}
          onClick={() => onState({ ...defaultDockState(), mode: state.mode })}
        >
          {t('video.menu_reset')}
        </button>
      </div>
    </header>
  );
}

export function VideoDock({ state, onState, panels }: VideoDockProps): ReactNode {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLDivElement>(null);
  const job = useRef<Job | null>(null);

  useEffect(() => {
    saveDockState(state);
  }, [state]);

  const patch = (id: DockPanelId, next: Partial<DockRect>) => {
    onState({ ...state, panels: { ...state.panels, [id]: { ...state.panels[id], ...next } } });
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const j = job.current;
    const canvas = canvasRef.current;
    if (!j || !canvas) return;
    const box = canvas.getBoundingClientRect();

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
      const dx = e.clientX - j.sx;
      const dy = e.clientY - j.sy;
      const colW = box.width / 12;
      const next: Partial<DockRect> = {};
      if (j.kind.includes('e')) next.span = clampSpan(j.orig.span + dx / colW);
      if (j.kind.includes('s')) next.hpx = clampHpx(j.orig.hpx + dy);
      if (Object.keys(next).length) patch(j.id, next);
      return;
    }

    const dx = ((e.clientX - j.sx) / box.width) * 100;
    const dy = ((e.clientY - j.sy) / box.height) * 100;
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
    patch(j.id, clampFree({ ...next, visible: true }));
  };

  const startJob = (e: PointerEvent<HTMLElement>, id: DockPanelId, kind: Job['kind']) => {
    job.current = { id, kind, sx: e.clientX, sy: e.clientY, orig: { ...state.panels[id] } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const visible = DOCK_PANEL_IDS
    .filter((id) => state.panels[id].visible)
    .sort((a, b) => state.panels[a].order - state.panels[b].order);

  if (visible.length === 0) {
    return <div className={styles.emptyDock}>{t('video.menu_all_hidden')}</div>;
  }

  const tile = state.mode === 'tile';
  const edges: Edge[] = tile ? ['e', 's', 'se'] : ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

  return (
    <div className={tile ? styles.tileCanvas : styles.freeCanvas} ref={canvasRef}>
      {visible.map((id) => {
        const rect = state.panels[id];
        const style = tile
          ? { gridColumn: `span ${rect.span}`, height: rect.hpx }
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
              onPointerUp={() => { job.current = null; }}
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
                onPointerUp={() => { job.current = null; }}
              />
            ))}
          </article>
        );
      })}
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
