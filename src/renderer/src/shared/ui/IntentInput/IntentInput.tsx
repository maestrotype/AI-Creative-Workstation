/**
 * IntentInput — the shared "describe your idea" command bar.
 *
 * Attach a reference photo via paperclip, drag-and-drop, or paste (Ctrl/Cmd+V).
 */
import { useId, useRef, useState } from 'react';
import type { ClipboardEvent, DragEvent, KeyboardEvent, ReactNode } from 'react';

import { ArrowUpIcon, PaperclipIcon, XIcon } from '../icons';
import styles from './IntentInput.module.css';

export interface ReferenceImage {
  dataUrl: string;
  name: string;
}

export interface IntentInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly placeholder?: string;
  readonly isDisabled?: boolean;
  readonly reference?: ReferenceImage | null;
  readonly onReferenceChange?: (image: ReferenceImage | null) => void;
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']);
const MAX_EDGE = 1280;

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_TYPES.has(file.type);
}

function filesFromList(list: FileList | File[] | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter(isImageFile);
}

function filesFromClipboard(event: ClipboardEvent): File[] {
  const dt = event.clipboardData;
  if (!dt) return [];
  const fromFiles = filesFromList(dt.files);
  if (fromFiles.length > 0) return fromFiles;
  const fromItems: File[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file && isImageFile(file)) fromItems.push(file);
    }
  }
  return fromItems;
}

async function fileToReference(file: File): Promise<ReferenceImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Could not read image');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.88),
    name: file.name || 'pasted-image.jpg',
  };
}

export function IntentInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'Describe what you want to create…',
  isDisabled = false,
  reference = null,
  onReferenceChange,
}: IntentInputProps): ReactNode {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const canSubmit = value.trim().length > 0 && !isDisabled;

  async function ingestFiles(files: File[]): Promise<void> {
    if (!onReferenceChange || files.length === 0 || isDisabled) return;
    try {
      onReferenceChange(await fileToReference(files[0]));
    } catch (err) {
      console.error('Could not attach image', err);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    if (canSubmit) onSubmit();
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>): void {
    const images = filesFromClipboard(event);
    if (images.length === 0) return;
    event.preventDefault();
    void ingestFiles(images);
  }

  function handleDrop(event: DragEvent<HTMLFormElement>): void {
    event.preventDefault();
    setIsDragOver(false);
    void ingestFiles(filesFromList(event.dataTransfer.files));
  }

  return (
    <div className={styles.wrapper} onPaste={handlePaste}>
      <form
        className={`${styles.field} ${isDragOver ? styles.fieldDrop : ''}`}
        aria-busy={isDisabled || undefined}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSubmit();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!isDisabled) setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        <label htmlFor={inputId} className={styles.srOnly}>
          Creative intent
        </label>

        {reference ? (
          <div className={styles.previewRow}>
            <img src={reference.dataUrl} alt="" className={styles.previewThumb} />
            <span className={styles.previewName}>{reference.name}</span>
            <button
              type="button"
              className={styles.previewRemove}
              onClick={() => onReferenceChange?.(null)}
              aria-label="Remove attached photo"
            >
              <XIcon size={14} />
            </button>
          </div>
        ) : null}

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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className={styles.srOnly}
            tabIndex={-1}
            onChange={(event) => {
              void ingestFiles(filesFromList(event.target.files));
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className={styles.attachButton}
            onClick={() => fileInputRef.current?.click()}
            disabled={isDisabled}
            aria-label="Attach reference photo"
            title="Attach photo or paste with Ctrl/Cmd+V"
          >
            <PaperclipIcon size={17} />
          </button>

          <span className={styles.hint} aria-hidden="true">
            Enter ↵ to send · Shift+Enter for new line · Ctrl/⌘+V photo
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
