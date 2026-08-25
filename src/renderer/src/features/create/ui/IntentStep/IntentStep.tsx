import type { ReactNode } from 'react';

import { useTranslation } from 'react-i18next';
import { IntentInput } from '../../../../shared/ui/IntentInput/IntentInput';
import type { GenerationFormat, GenerationStyle } from '../../api/generationApi';
import { useCreateStore } from '../../store/createStore';
import styles from './IntentStep.module.css';

const FORMATS: GenerationFormat[] = ['square', 'portrait', 'wide'];
const STYLES: GenerationStyle[] = ['subtle', 'cinematic', 'bold'];

export function IntentStep(): ReactNode {
  const { t } = useTranslation();
  const prompt = useCreateStore((s) => s.prompt);
  const format = useCreateStore((s) => s.format);
  const style = useCreateStore((s) => s.style);
  const setPrompt = useCreateStore((s) => s.setPrompt);
  const setFormat = useCreateStore((s) => s.setFormat);
  const setStyle = useCreateStore((s) => s.setStyle);
  const startGeneration = useCreateStore((s) => s.startGeneration);

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>{t('create.what_to_create')}</h2>
      
      <IntentInput
        value={prompt}
        onChange={setPrompt}
        onSubmit={startGeneration}
        placeholder={t('create.intent_placeholder')}
        onAttach={() => {}}
      />

      <div className={styles.options}>
        <div className={styles.field}>
          <span className={styles.label}>{t('create.format')}</span>
          <div className={styles.radioGroup}>
            {FORMATS.map((f) => (
              <label
                key={f}
                className={styles.radioLabel}
                data-checked={format === f}
              >
                <input
                  type="radio"
                  name="format"
                  value={f}
                  checked={format === f}
                  onChange={() => setFormat(f)}
                  className={styles.radioInput}
                />
                {t(`create.formats.${f}`)}
              </label>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>{t('create.style_intensity')}</span>
          <div className={styles.radioGroup}>
            {STYLES.map((s) => (
              <label
                key={s}
                className={styles.radioLabel}
                data-checked={style === s}
              >
                <input
                  type="radio"
                  name="style"
                  value={s}
                  checked={style === s}
                  onChange={() => setStyle(s)}
                  className={styles.radioInput}
                />
                {t(`create.styles.${s}`)}
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
            {t('create.btn_create')}
          </button>
        </div>
      </div>
    </div>
  );
}
