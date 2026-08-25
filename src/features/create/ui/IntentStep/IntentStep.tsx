import type { ReactNode } from 'react';

import { IntentInput } from '../../../../shared/ui/IntentInput/IntentInput';
import type { GenerationFormat, GenerationStyle } from '../../api/generationApi';
import { useCreateStore } from '../../store/createStore';
import styles from './IntentStep.module.css';

const FORMATS: { value: GenerationFormat; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'wide', label: 'Wide' },
];

const STYLES: { value: GenerationStyle; label: string }[] = [
  { value: 'subtle', label: 'Subtle' },
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'bold', label: 'Bold' },
];

export function IntentStep(): ReactNode {
  const prompt = useCreateStore((s) => s.prompt);
  const format = useCreateStore((s) => s.format);
  const style = useCreateStore((s) => s.style);
  const setPrompt = useCreateStore((s) => s.setPrompt);
  const setFormat = useCreateStore((s) => s.setFormat);
  const setStyle = useCreateStore((s) => s.setStyle);
  const startGeneration = useCreateStore((s) => s.startGeneration);

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>What do you want to create?</h2>
      
      <IntentInput
        value={prompt}
        onChange={setPrompt}
        onSubmit={startGeneration}
        placeholder="Describe your vision..."
        onAttach={() => {}}
      />

      <div className={styles.options}>
        <div className={styles.field}>
          <span className={styles.label}>Format</span>
          <div className={styles.radioGroup}>
            {FORMATS.map((f) => (
              <label
                key={f.value}
                className={styles.radioLabel}
                data-checked={format === f.value}
              >
                <input
                  type="radio"
                  name="format"
                  value={f.value}
                  checked={format === f.value}
                  onChange={() => setFormat(f.value)}
                  className={styles.radioInput}
                />
                {f.label}
              </label>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Style Intensity</span>
          <div className={styles.radioGroup}>
            {STYLES.map((s) => (
              <label
                key={s.value}
                className={styles.radioLabel}
                data-checked={style === s.value}
              >
                <input
                  type="radio"
                  name="style"
                  value={s.value}
                  checked={style === s.value}
                  onChange={() => setStyle(s.value)}
                  className={styles.radioInput}
                />
                {s.label}
              </label>
            ))}
          </div>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.createButton}
            onClick={startGeneration}
            disabled={prompt.trim().length === 0}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
