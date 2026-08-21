/**
 * IntentInput — the shared "describe your idea" command bar.
 *
 * Architecture: Presentational & controlled.
 * - All state lives in props (value, onChange, onSubmit).
 * - No inline styles; every visual value comes from design tokens.
 * - Fully accessible: labeled textarea, keyboard submit, disabled states.
 */
import { useId } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { ArrowUpIcon, PaperclipIcon } from '../icons';
import styles from './IntentInput.module.css';

/* ─── Props interface ───────────────────────────────────────────────── */

export interface IntentInputProps {
  /** Current intent text (controlled). */
  readonly value: string;
  /** Called with the new draft on every keystroke. */
  readonly onChange: (value: string) => void;
  /** Called when the user submits (Enter or button click). */
  readonly onSubmit: () => void;
  /** Placeholder shown while the textarea is empty. */
  readonly placeholder?: string;
  /** Disables the entire control (e.g. during creation). */
  readonly isDisabled?: boolean;
  /** Optional "attach photo" handler. Button hidden when omitted. */
  readonly onAttach?: () => void;
}

/* ─── Component ─────────────────────────────────────────────────────── */

export function IntentInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'Describe what you want to create…',
  isDisabled = false,
  onAttach,
}: IntentInputProps): ReactNode {
  const inputId = useId();
  const canSubmit = value.trim().length > 0 && !isDisabled;

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter submits; Shift+Enter inserts a newline.
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    if (canSubmit) onSubmit();
  }

  return (
    <div className={styles.wrapper}>
      <form
        className={styles.field}
        aria-busy={isDisabled || undefined}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSubmit();
        }}
      >
        <label htmlFor={inputId} className={styles.srOnly}>
          Creative intent
        </label>

        <textarea
          id={inputId}
          name="intent"
          rows={2}
          value={value}
          placeholder={placeholder}
          disabled={isDisabled}
          className={styles.textarea}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div className={styles.actions}>
          {onAttach ? (
            <button
              type="button"
              className={styles.attachButton}
              onClick={onAttach}
              aria-label="Attach reference photo"
            >
              <PaperclipIcon size={17} />
            </button>
          ) : null}

          <span className={styles.hint} aria-hidden="true">
            Enter ↵ to send · Shift+Enter for new line
          </span>

          <button
            type="submit"
            className={styles.submitButton}
            disabled={!canSubmit}
            aria-label="Create"
          >
            <ArrowUpIcon size={17} />
          </button>
        </div>
      </form>
    </div>
  );
}
