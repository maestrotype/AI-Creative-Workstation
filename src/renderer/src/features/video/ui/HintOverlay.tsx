import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, PointerEvent as ReactPointerEvent } from 'react';

import {
  hintAnimPhase,
  type Callout,
} from '../model/callout';
import s from './HintOverlay.module.css';

type Handle = 'nw' | 'ne' | 'sw' | 'se';

type Drag =
  | {
    kind: 'move';
    id: string;
    startX: number;
    startY: number;
    boxX: number;
    boxY: number;
    targetX: number;
    targetY: number;
  }
  | {
    kind: 'target';
    id: string;
    startX: number;
    startY: number;
    targetX: number;
    targetY: number;
  }
  | {
    kind: 'resize';
    id: string;
    handle: Handle;
    startX: number;
    startY: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
  };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function arrowGeometry(
  hint: Callout,
  w: number,
  h: number,
): { x1: number; y1: number; x2: number; y2: number; head: string } | null {
  if (hint.type !== 'arrow' || w < 8 || h < 8) return null;
  const cx = (hint.boxX / 100) * w;
  const cy = (hint.boxY / 100) * h;
  const tx = (hint.targetX / 100) * w;
  const ty = (hint.targetY / 100) * h;
  const dx = tx - cx;
  const dy = ty - cy;
  const len = Math.hypot(dx, dy);
  if (len < 10) return null;
  const ux = dx / len;
  const uy = dy / len;
  const hw = Math.max(18, ((hint.boxW ?? 16) / 100) * w / 2);
  const hh = Math.max(12, ((hint.boxH ?? 8) / 100) * h / 2);
  const edge = hint.shape === 'oval'
    ? 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2 || 1)
    : 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  const scale = Math.min(edge, 0.94);
  const head = 13;
  const wing = 5;
  const px = -uy;
  const py = ux;
  const baseX = tx - ux * head;
  const baseY = ty - uy * head;
  return {
    x1: cx + dx * scale + ux * 2,
    y1: cy + dy * scale + uy * 2,
    x2: tx - ux * (head - 2),
    y2: ty - uy * (head - 2),
    head: `${tx},${ty} ${baseX + px * wing},${baseY + py * wing} ${baseX - px * wing},${baseY - py * wing}`,
  };
}

export function HintOverlay({
  hints,
  playhead,
  playing,
  selectedId,
  editable,
  onSelect,
  onChange,
  onGestureStart,
}: {
  hints: Callout[];
  playhead: number;
  playing: boolean;
  selectedId: string | null;
  editable: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<Callout>) => void;
  onGestureStart: (id: string) => void;
}): ReactNode {
  const dragRef = useRef<Drag | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const boxRefs = useRef(new Map<string, HTMLDivElement>());
  const [frame, setFrame] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const measure = () => {
      const box = root.getBoundingClientRect();
      if (box.width > 8 && box.height > 8) setFrame({ w: box.width, h: box.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const begin = (e: ReactPointerEvent, drag: Drag, hintId: string) => {
    if (!editable) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(hintId);
    onGestureStart(hintId);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = drag;
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    const root = rootRef.current;
    if (!drag || !root) return;
    const rect = root.getBoundingClientRect();
    const dx = ((e.clientX - drag.startX) / Math.max(1, rect.width)) * 100;
    const dy = ((e.clientY - drag.startY) / Math.max(1, rect.height)) * 100;
    if (drag.kind === 'target') {
      onChange(drag.id, {
        targetX: Math.round(clamp(drag.targetX + dx, 1, 99) * 10) / 10,
        targetY: Math.round(clamp(drag.targetY + dy, 1, 99) * 10) / 10,
      });
      return;
    }
    if (drag.kind === 'move') {
      onChange(drag.id, {
        boxX: Math.round(clamp(drag.boxX + dx, 2, 98) * 10) / 10,
        boxY: Math.round(clamp(drag.boxY + dy, 2, 98) * 10) / 10,
        targetX: Math.round(clamp(drag.targetX + dx, 1, 99) * 10) / 10,
        targetY: Math.round(clamp(drag.targetY + dy, 1, 99) * 10) / 10,
      });
      return;
    }
    let left = drag.left;
    let top = drag.top;
    let right = drag.right;
    let bottom = drag.bottom;
    if (drag.handle.includes('e')) right = drag.right + dx;
    if (drag.handle.includes('w')) left = drag.left + dx;
    if (drag.handle.includes('s')) bottom = drag.bottom + dy;
    if (drag.handle.includes('n')) top = drag.top + dy;
    if (right - left < 10) {
      if (drag.handle.includes('w')) left = right - 10;
      else right = left + 10;
    }
    if (bottom - top < 6) {
      if (drag.handle.includes('n')) top = bottom - 6;
      else bottom = top + 6;
    }
    left = clamp(left, 0, 90);
    top = clamp(top, 0, 90);
    right = clamp(right, left + 10, 100);
    bottom = clamp(bottom, top + 6, 100);
    const boxW = right - left;
    const boxH = bottom - top;
    onChange(drag.id, {
      boxX: Math.round((left + boxW / 2) * 10) / 10,
      boxY: Math.round((top + boxH / 2) * 10) / 10,
      boxW: Math.round(boxW * 10) / 10,
      boxH: Math.round(boxH * 10) / 10,
    });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  if (hints.length === 0) return null;

  return (
    <div
      ref={rootRef}
      className={s.root}
      data-editable={editable || undefined}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {frame.w > 8 ? (
        <svg className={s.leaders} viewBox={`0 0 ${frame.w} ${frame.h}`} aria-hidden>
          {hints.map((hint) => {
            const line = arrowGeometry(hint, frame.w, frame.h);
            if (!line) return null;
            const lineColor = hint.color || '#f2c14e';
            return (
              <g key={hint.id} className={s.arrow}>
                <line
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke={lineColor}
                  strokeWidth={1.75}
                  strokeLinecap="round"
                />
                <polygon points={line.head} fill={lineColor} />
              </g>
            );
          })}
        </svg>
      ) : null}
      {hints.map((hint) => {
        const selected = selectedId === hint.id;
        const phase = playing ? hintAnimPhase(hint, playhead) : 'hold';
        if (playing && phase === 'idle') return null;
        const sizeClass = hint.size === 's' ? s.sizeS : hint.size === 'l' ? s.sizeL : s.sizeM;
        const animClass = playing
          ? (phase === 'in'
            ? ({
              none: '',
              fade: s.animFadeIn,
              'slide-up': s.animSlideUp,
              pop: s.animPop,
              typewriter: s.animTypewriter,
            }[hint.animationIn] || '')
            : phase === 'out'
              ? (hint.animationOut === 'fade' ? s.animFadeOut : '')
              : '')
          : '';
        const style: CSSProperties = {
          left: `${hint.boxX}%`,
          top: `${hint.boxY}%`,
          ...(hint.boxW ? { width: `${hint.boxW}%` } : {}),
          ...(hint.boxH ? { height: `${hint.boxH}%` } : {}),
          ['--hint-line' as string]: hint.color || '#f2c14e',
          ['--hint-ink' as string]: hint.textColor || '#f8fafc',
          ...(hint.fill && hint.fill !== 'transparent' ? { ['--hint-fill' as string]: hint.fill } : {}),
        };
        const showMark = hint.type === 'dot' || hint.type === 'arrow';

        return (
          <div key={hint.id}>
            {showMark ? (
              <button
                type="button"
                className={hint.type === 'arrow' ? s.tip : s.dot}
                data-selected={selected}
                data-pulse={hint.type === 'dot' || undefined}
                style={{
                  left: `${hint.targetX}%`,
                  top: `${hint.targetY}%`,
                  ...(hint.type === 'dot' ? { background: hint.color || '#f2c14e' } : {}),
                }}
                title={hint.type === 'arrow' ? 'Куда указывает стрелка' : 'Точка на кадре'}
                onPointerDown={(e) => begin(e, {
                  kind: 'target',
                  id: hint.id,
                  startX: e.clientX,
                  startY: e.clientY,
                  targetX: hint.targetX,
                  targetY: hint.targetY,
                }, hint.id)}
              />
            ) : null}
            <div
              ref={(node) => {
                if (node) boxRefs.current.set(hint.id, node);
                else boxRefs.current.delete(hint.id);
              }}
              className={`${s.hint} ${s[hint.type === 'plain' ? 'typePlain' : hint.type === 'dot' ? 'typeDot' : 'typeArrow']} ${sizeClass} ${animClass}`}
              data-selected={selected}
              data-phase={phase}
              data-shape={hint.shape}
              data-fill={hint.fill === 'transparent' ? 'transparent' : undefined}
              data-sized={hint.boxW || hint.boxH ? 'true' : undefined}
              style={style}
              onPointerDown={(e) => begin(e, {
                kind: 'move',
                id: hint.id,
                startX: e.clientX,
                startY: e.clientY,
                boxX: hint.boxX,
                boxY: hint.boxY,
                targetX: hint.targetX,
                targetY: hint.targetY,
              }, hint.id)}
            >
              <div className={s.body}>
                {hint.title ? <div className={s.title}>{hint.title}</div> : null}
                <div className={s.text}>{hint.text}</div>
              </div>
              {editable && selected ? (['nw', 'ne', 'sw', 'se'] as Handle[]).map((handle) => (
                <span
                  key={handle}
                  className={`${s.handle} ${s[`handle_${handle}`]}`}
                  onPointerDown={(e) => {
                    const el = boxRefs.current.get(hint.id);
                    const root = rootRef.current;
                    if (!el || !root) return;
                    const frame = root.getBoundingClientRect();
                    const b = el.getBoundingClientRect();
                    begin(e, {
                      kind: 'resize',
                      id: hint.id,
                      handle,
                      startX: e.clientX,
                      startY: e.clientY,
                      left: ((b.left - frame.left) / frame.width) * 100,
                      top: ((b.top - frame.top) / frame.height) * 100,
                      right: ((b.right - frame.left) / frame.width) * 100,
                      bottom: ((b.bottom - frame.top) / frame.height) * 100,
                    }, hint.id);
                  }}
                />
              )) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
