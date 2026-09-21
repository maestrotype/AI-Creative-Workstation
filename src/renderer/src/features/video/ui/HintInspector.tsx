import type { ReactNode } from 'react';

import {
  hintDuration,
  hintTypeLabel,
  type Callout,
  type HintAnimIn,
  type HintSize,
  type HintType,
} from '../model/callout';
import { formatClock } from '../model/directorTimeline';
import { toAssetUrl } from '../model/directorMedia';
import { useDirector } from './DirectorBoard';
import s from './HintInspector.module.css';

const TYPES: HintType[] = ['minimal', 'accent', 'card', 'sticker', 'pointer'];
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
      size: hint.size,
      animationIn: hint.animationIn,
      animationOut: hint.animationOut,
      anchor: hint.anchor,
      stickerUrl: hint.stickerUrl,
      stickerScale: hint.stickerScale,
      color: hint.color,
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
        <label className={s.label}>Title (optional)</label>
        <input
          className={s.input}
          value={hint.title || ''}
          onChange={(e) => patch({ title: e.target.value || undefined })}
          placeholder="Only for Card"
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
              onClick={() => patch({
                type,
                arrowStyle: type === 'pointer' ? 'straight' : 'none',
                pulse: type === 'pointer',
              })}
            >
              {hintTypeLabel(type)}
            </button>
          ))}
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
        <p className={s.hint}>Drag the overlay on preview, or edit X/Y here.</p>
      </div>

      {hint.type === 'sticker' ? (
        <div className={s.block}>
          <div className={s.label}>Sticker</div>
          <button
            type="button"
            className={s.btnWide}
            onClick={() => {
              void (async () => {
                const path = await window.api?.pickImage?.();
                if (!path) return;
                patch({ stickerUrl: toAssetUrl(path), type: 'sticker' });
              })();
            }}
          >
            {hint.stickerUrl ? 'Change sticker image' : 'Add sticker image'}
          </button>
        </div>
      ) : null}

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
