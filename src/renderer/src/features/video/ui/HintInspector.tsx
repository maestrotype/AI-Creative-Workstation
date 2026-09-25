import type { ReactNode } from 'react';

import {
  hintDuration,
  hintTypeLabel,
  type Callout,
  type HintAnimIn,
  type HintShape,
  type HintSize,
  type HintType,
} from '../model/callout';
import { formatClock } from '../model/directorTimeline';
import { useDirector } from './DirectorBoard';
import s from './HintInspector.module.css';

const TYPES: HintType[] = ['plain', 'dot', 'arrow'];
const SHAPES: HintShape[] = ['rect', 'oval'];
const SIZES: HintSize[] = ['s', 'm', 'l'];
const ANIMS: HintAnimIn[] = ['none', 'fade', 'slide-up', 'pop', 'typewriter'];

export function HintInspector({ hint }: { hint: Callout }): ReactNode {
  const d = useDirector();
  const dur = hintDuration(hint);

  const patch = (next: Partial<Callout>) => d.updateCallout(hint.id, next);

  const setDuration = (seconds: number) => {
    const next = Math.max(0.4, Math.round(seconds * 10) / 10);
    patch({ endSec: hint.startSec + next });
  };

  const duplicate = () => {
    d.addCallout({
      startSec: hint.endSec,
      endSec: hint.endSec + dur,
      targetX: Math.min(90, hint.targetX + 4),
      targetY: Math.min(90, hint.targetY + 4),
      text: hint.text,
      title: hint.title,
      type: hint.type,
      shape: hint.shape,
      boxX: Math.min(96, hint.boxX + 4),
      boxY: Math.min(96, hint.boxY + 4),
      boxW: hint.boxW,
      boxH: hint.boxH,
      size: hint.size,
      animationIn: hint.animationIn,
      animationOut: hint.animationOut,
      anchor: hint.anchor,
      stickerUrl: hint.stickerUrl,
      stickerScale: hint.stickerScale,
      color: hint.color,
      fill: hint.fill,
      textColor: hint.textColor,
      theme: hint.theme,
      arrowStyle: hint.arrowStyle,
      pulse: hint.pulse,
    });
  };

  return (
    <aside className={s.root}>
      <header className={s.head}>
        <h2 className={s.title}>Hint</h2>
        <button type="button" className={s.back} onClick={() => d.setSelectedCallout(null)}>
          ← Film
        </button>
      </header>

      <div className={s.block}>
        <label className={s.label}>Text</label>
        <textarea
          className={s.textarea}
          rows={3}
          value={hint.text}
          onChange={(e) => patch({ text: e.target.value })}
          placeholder="Hint text…"
        />
      </div>

      <div className={s.block}>
        <div className={s.label}>Type</div>
        <div className={s.chips}>
          {TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className={s.chip}
              data-on={hint.type === type}
              onClick={() => {
                const far = Math.hypot(hint.boxX - hint.targetX, hint.boxY - hint.targetY) >= 10;
                patch({
                  type,
                  arrowStyle: type === 'arrow' ? 'straight' : 'none',
                  pulse: type === 'dot',
                  ...(type === 'arrow' && !far ? {
                    targetX: Math.max(4, Math.min(96, hint.boxX - 22)),
                    targetY: Math.max(4, Math.min(96, hint.boxY - 16)),
                  } : {}),
                });
              }}
            >
              {hintTypeLabel(type)}
            </button>
          ))}
        </div>
      </div>

      <div className={s.block}>
        <label className={s.label}>Title (optional)</label>
        <input
          className={s.input}
          value={hint.title || ''}
          onChange={(e) => patch({ title: e.target.value || undefined })}
          placeholder="Optional subtitle"
        />
      </div>

      <div className={s.block}>
        <div className={s.label}>Look</div>
        <div className={s.chips}>
          {SHAPES.map((shape) => (
            <button
              key={shape}
              type="button"
              className={s.chip}
              data-on={hint.shape === shape}
              onClick={() => patch({ shape })}
            >
              {shape === 'rect' ? 'Rectangle' : 'Oval'}
            </button>
          ))}
        </div>
        <div className={s.lookRow}>
          <label className={s.swatch}>
            <span>Fill</span>
            <input
              className={s.color}
              type="color"
              aria-label="Background color"
              value={hint.fill && hint.fill !== 'transparent' ? hint.fill : '#0f172a'}
              onChange={(e) => patch({ fill: e.target.value })}
            />
          </label>
          <label className={s.swatch}>
            <span>Text</span>
            <input
              className={s.color}
              type="color"
              aria-label="Text color"
              value={hint.textColor && /^#[0-9a-fA-F]{6}$/.test(hint.textColor) ? hint.textColor : '#f8fafc'}
              onChange={(e) => patch({ textColor: e.target.value })}
            />
          </label>
          {hint.type !== 'plain' ? (
            <label className={s.swatch}>
              <span>Line</span>
              <input
                className={s.color}
                type="color"
                aria-label="Line color"
                value={hint.color && /^#[0-9a-fA-F]{6}$/.test(hint.color) ? hint.color : '#f2c14e'}
                onChange={(e) => patch({ color: e.target.value })}
              />
            </label>
          ) : null}
          <button
            type="button"
            className={s.chip}
            data-on={hint.fill === 'transparent'}
            onClick={() => patch({ fill: hint.fill === 'transparent' ? undefined : 'transparent' })}
          >
            Transparent
          </button>
        </div>
      </div>

      <div className={s.block}>
        <div className={s.label}>Size</div>
        <div className={s.chips}>
          {SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className={s.chip}
              data-on={hint.size === size}
              onClick={() => patch({ size })}
            >
              {size.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className={s.block}>
        <div className={s.label}>Animation in</div>
        <div className={s.chips}>
          {ANIMS.map((anim) => (
            <button
              key={anim}
              type="button"
              className={s.chip}
              data-on={hint.animationIn === anim}
              onClick={() => patch({ animationIn: anim })}
            >
              {anim}
            </button>
          ))}
        </div>
      </div>

      <div className={s.block}>
        <div className={s.label}>Timing</div>
        <div className={s.row}>
          <span className={s.key}>Range</span>
          <span className={s.val}>{formatClock(hint.startSec)} – {formatClock(hint.endSec)}</span>
        </div>
        <div className={s.durationRow}>
          <button type="button" className={s.btn} onClick={() => setDuration(dur - 0.5)} disabled={dur <= 0.4}>−</button>
          <input
            className={s.durInput}
            type="number"
            min={0.4}
            step={0.1}
            value={Math.round(dur * 10) / 10}
            onChange={(e) => setDuration(Number(e.target.value) || 0.4)}
          />
          <span className={s.unit}>s</span>
          <button type="button" className={s.btn} onClick={() => setDuration(dur + 0.5)}>+</button>
        </div>
      </div>

      <div className={s.block}>
        <div className={s.label}>Position</div>
        <div className={s.xyRow}>
          <label>
            X
            <input
              className={s.num}
              type="number"
              min={0}
              max={100}
              step={1}
              value={Math.round(hint.targetX)}
              onChange={(e) => patch({ targetX: Number(e.target.value) || 0 })}
            />
          </label>
          <label>
            Y
            <input
              className={s.num}
              type="number"
              min={0}
              max={100}
              step={1}
              value={Math.round(hint.targetY)}
              onChange={(e) => patch({ targetY: Number(e.target.value) || 0 })}
            />
          </label>
        </div>
        <p className={s.hint}>Drag the label to move the whole hint. Drag the dot or arrow tip to aim it. Corners resize it.</p>
      </div>

      <div className={s.actions}>
        <button type="button" className={s.btn} onClick={() => d.seekTo(hint.startSec)}>
          Go to hint
        </button>
        <button type="button" className={s.btn} onClick={duplicate}>
          Duplicate
        </button>
        <button type="button" className={s.btnDanger} onClick={() => d.removeCallout(hint.id)}>
          Delete
        </button>
      </div>
    </aside>
  );
}
