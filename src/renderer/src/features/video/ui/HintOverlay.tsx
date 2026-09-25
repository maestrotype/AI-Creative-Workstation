import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, PointerEvent as ReactPointerEvent } from 'react';

import {
  hintAnimPhase,
  type Callout,
} from '../model/callout';
import s from './HintOverlay.module.css';

function labelPoint(hint: Callout): { x: number; y: number } {
  const dx = hint.boxX - hint.targetX;
  const dy = hint.boxY - hint.targetY;
  if (Math.hypot(dx, dy) >= 8) return { x: hint.boxX, y: hint.boxY };
  const x = hint.targetX > 58 ? hint.targetX - 26 : Math.min(74, hint.targetX + 18);
  const y = hint.targetY > 68 ? hint.targetY - 18 : Math.min(80, hint.targetY + 12);
  return {
    x: Math.max(4, Math.min(96, x)),
    y: Math.max(6, Math.min(92, y)),
  };
}

function showsArrow(hint: Callout): boolean {
  if (hint.type === 'sticker') return hint.arrowStyle !== 'none';
  if (hint.type === 'minimal') return hint.arrowStyle !== 'none';
  return true;
}

export function HintOverlay({
  hints,
  playhead,
  playing,
  selectedId,
  editable,
  onSelect,
  onMoveBox,
  onMoveTarget,
}: {
  hints: Callout[];
  playhead: number;
  playing: boolean;
  selectedId: string | null;
  editable: boolean;
  onSelect: (id: string) => void;
  onMoveBox: (id: string, x: number, y: number) => void;
  onMoveTarget: (id: string, x: number, y: number) => void;
}): ReactNode {
  const dragRef = useRef<{
    id: string;
    part: 'box' | 'target';
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const measure = () => {
      const own = root.getBoundingClientRect();
      const box = own.width > 8 && own.height > 8
        ? own
        : root.parentElement?.getBoundingClientRect();
      if (!box || box.width < 8 || box.height < 8) return;
      setSize({ w: box.width, h: box.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    if (root.parentElement) observer.observe(root.parentElement);
    return () => observer.disconnect();
  }, []);

  const onPointerDown = (
    e: ReactPointerEvent,
    hint: Callout,
    part: 'box' | 'target',
    origin: { x: number; y: number },
  ) => {
    if (!editable || hint.id !== selectedId) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      id: hint.id,
      part,
      startX: e.clientX,
      startY: e.clientY,
      origX: origin.x,
      origY: origin.y,
    };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    const root = rootRef.current;
    if (!drag || !root) return;
    const rect = root.getBoundingClientRect();
    const dx = ((e.clientX - drag.startX) / Math.max(1, rect.width)) * 100;
    const dy = ((e.clientY - drag.startY) / Math.max(1, rect.height)) * 100;
    const x = Math.max(2, Math.min(98, drag.origX + dx));
    const y = Math.max(2, Math.min(98, drag.origY + dy));
    const nextX = Math.round(x * 10) / 10;
    const nextY = Math.round(y * 10) / 10;
    if (drag.part === 'target') onMoveTarget(drag.id, nextX, nextY);
    else onMoveBox(drag.id, nextX, nextY);
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
      <svg className={s.leaders} viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden>
        <defs>
          <marker id="hint-arrow" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
            <path d="M0,0 L9,4.5 L0,9 Z" fill="#f2c14e" />
          </marker>
        </defs>
        {size.w > 8 && size.h > 8 ? hints.map((hint) => {
          if (!showsArrow(hint)) return null;
          const box = labelPoint(hint);
          const x1 = (box.x / 100) * size.w;
          const y1 = (box.y / 100) * size.h;
          const x2 = (hint.targetX / 100) * size.w;
          const y2 = (hint.targetY / 100) * size.h;
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.hypot(dx, dy) || 1;
          const startPad = Math.min(42, len * 0.42);
          const endPad = Math.min(10, len * 0.15);
          return (
            <line
              key={hint.id}
              x1={x1 + (dx / len) * startPad}
              y1={y1 + (dy / len) * startPad}
              x2={x2 - (dx / len) * endPad}
              y2={y2 - (dy / len) * endPad}
              className={s.leader}
              markerEnd="url(#hint-arrow)"
            />
          );
        }) : null}
      </svg>
      {hints.map((hint) => {
        const selected = selectedId === hint.id;
        const phase = playing ? hintAnimPhase(hint, playhead) : 'hold';
        if (playing && phase === 'idle') return null;
        const box = labelPoint(hint);
        const sizeClass = hint.size === 's' ? s.sizeS : hint.size === 'l' ? s.sizeL : s.sizeM;
        const typeClass = {
          minimal: s.typeMinimal,
          accent: s.typeAccent,
          card: s.typeCard,
          sticker: s.typeSticker,
          pointer: s.typePointer,
        }[hint.type];
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
          left: `${box.x}%`,
          top: `${box.y}%`,
          ...(hint.color ? { ['--hint-color' as string]: hint.color } : {}),
        };

        return (
          <div key={hint.id}>
            {showsArrow(hint) ? (
              <button
                type="button"
                className={s.pin}
                data-selected={selected}
                style={{ left: `${hint.targetX}%`, top: `${hint.targetY}%` }}
                title="Место, на которое указывает подсказка"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(hint.id);
                }}
                onPointerDown={(e) => onPointerDown(e, hint, 'target', { x: hint.targetX, y: hint.targetY })}
              />
            ) : null}
            <div
              className={`${s.hint} ${typeClass} ${sizeClass} ${animClass}`}
              data-selected={selected}
              data-phase={phase}
              data-anchor={hint.anchor}
              style={style}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(hint.id);
              }}
              onPointerDown={(e) => onPointerDown(e, hint, 'box', box)}
            >
              {hint.type === 'sticker' && hint.stickerUrl ? (
                <img
                  className={s.stickerImg}
                  src={hint.stickerUrl}
                  alt=""
                  style={{ transform: `scale(${hint.stickerScale ?? 1})` }}
                  draggable={false}
                />
              ) : null}
              {hint.type !== 'sticker' || !hint.stickerUrl ? (
                <div className={s.body}>
                  {hint.type === 'card' && hint.title ? (
                    <div className={s.title}>{hint.title}</div>
                  ) : null}
                  <div className={s.text}>{hint.text}</div>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
