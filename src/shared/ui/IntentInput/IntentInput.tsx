/**
 * IntentInput — the shared "describe your idea" command bar.
 * Presentational & dumb (Rule 3): all state lives in props; no inline styles,
 * every visual value comes from design tokens (Rule 2).
 */
import { useId } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { ArrowUpIcon, PaperclipIcon } from '../icons';
import styles from './IntentInput.module.css';

export interface IntentInputProps {
  /** Current intent text (controlled). */
  value: string;
  /** Called with the new draft on every change. */
  onChange: (value: string) => void;
  /** Called when the user submits (Enter or button). */
  onSubmit: () => void;
  /** Placeholder hint shown while empty. */
  placeholder?: string;
  /** Disables the whole control (e.g. during a run). */
  isDisabled?: boolean;
  /** Optional attach entry point; rendered inert when omitted. */
  onAttach?: () => void;
}

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
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    if (canSubmit) onSubmit();
  }

  return (
    <form
      className={styles.field}
      aria-busy={isDisabled || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      <label htmlFor={inputId} className={styles.srOnly}>
        Create intent
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
          <button type="button" className={styles.attachButton} onClick={onAttach}>
            <span className={styles.srOnly}>Attach reference</span>
            <PaperclipIcon size={17} />
          </button>
        ) : null}

        <p className={styles.hint} aria-hidden="true">
          Enter ↵ · Shift+Enter for a new line
        </p>

        <button type="submit" className={styles.submitButton} disabled={!canSubmit} title="Create (Enter)">
          <span className={styles.srOnly}>Send intent</span>
          <ArrowUpIcon size={17} />
        </button>
      </div>
    </form>
  );
}
