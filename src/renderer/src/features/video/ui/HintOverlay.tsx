import { useRef } from 'react';
import type { CSSProperties, ReactNode, PointerEvent as ReactPointerEvent } from 'react';

import {
  hintAnimPhase,
  hintDuration,
  type Callout,
} from '../model/callout';
import s from './HintOverlay.module.css';

export function HintOverlay({
  hints,
  playhead,
  playing,
  selectedId,
  editable,
  onSelect,
  onMove,
}: {
  hints: Callout[];
  playhead: number;
  playing: boolean;
  selectedId: string | null;
  /** Allow drag-reposition of the selected hint. */
  editable: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
}): ReactNode {
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const onPointerDown = (e: ReactPointerEvent, hint: Callout) => {
    if (!editable || hint.id !== selectedId) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      id: hint.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: hint.targetX,
      origY: hint.targetY,
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
    onMove(drag.id, Math.round(x * 10) / 10, Math.round(y * 10) / 10);
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
      {hints.map((hint) => {
        const selected = selectedId === hint.id;
        const phase = playing ? hintAnimPhase(hint, playhead) : 'hold';
        if (playing && phase === 'idle') return null;

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
          left: `${hint.targetX}%`,
          top: `${hint.targetY}%`,
          ...(hint.color ? { ['--hint-color' as string]: hint.color } : {}),
        };

        return (
          <div
            key={hint.id}
            className={`${s.hint} ${typeClass} ${sizeClass} ${animClass}`}
            data-selected={selected}
            data-phase={phase}
            data-anchor={hint.anchor}
            style={style}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(hint.id);
            }}
            onPointerDown={(e) => onPointerDown(e, hint)}
          >
            {hint.type === 'pointer' ? <span className={s.pointerDot} /> : null}
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
                {editable && selected ? (
                  <span className={s.dragHint}>{Math.round(hintDuration(hint) * 10) / 10}s · drag</span>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
