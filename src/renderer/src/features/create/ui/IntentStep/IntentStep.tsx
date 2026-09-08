import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { useTranslation } from 'react-i18next';
import { WorkspaceFlow } from '../../../studio/ui/WorkspaceFlow';
import { IntentInput } from '../../../../shared/ui/IntentInput/IntentInput';
import type { CreateJob, GenerationFormat, GenerationStyle } from '../../api/generationApi';
import { useCreateStore } from '../../store/createStore';
import styles from './IntentStep.module.css';

const FORMATS: GenerationFormat[] = ['square', 'portrait', 'wide'];
const STYLES: GenerationStyle[] = ['subtle', 'cinematic', 'bold'];
const JOBS: CreateJob[] = ['title', 'frame', 'product'];

interface ReadyModel {
  id: string;
  name: string;
}

export function IntentStep(): ReactNode {
  const { t } = useTranslation();
  const prompt = useCreateStore((s) => s.prompt);
  const job = useCreateStore((s) => s.job);
  const format = useCreateStore((s) => s.format);
  const style = useCreateStore((s) => s.style);
  const setPrompt = useCreateStore((s) => s.setPrompt);
  const setJob = useCreateStore((s) => s.setJob);
  const setFormat = useCreateStore((s) => s.setFormat);
  const setStyle = useCreateStore((s) => s.setStyle);
  const referenceImages = useCreateStore((s) => s.referenceImages);
  const setReferenceImages = useCreateStore((s) => s.setReferenceImages);
  const startGeneration = useCreateStore((s) => s.startGeneration);
  const [readyModels, setReadyModels] = useState<ReadyModel[]>([]);
  const [activeModelId, setActiveModelId] = useState<string>('');

  const refreshModels = async () => {
    if (!window.api) return;
    const models = await window.api.getModels();
    const ready = models
      .filter((m: { status: string; type?: string }) => m.status === 'ready' && m.type === 'image')
      .map((m: { id: string; name: string }) => ({ id: m.id, name: m.name }));
    setReadyModels(ready);
    const active = await window.api.getActiveModel();
    const nextId = active && ready.some((m) => m.id === active) ? active : ready[0]?.id ?? '';
    setActiveModelId(nextId);
    if (nextId && nextId !== active) {
      await window.api.setActiveModel(nextId);
    }
  };

  useEffect(() => {
    void refreshModels();
    return window.api?.onModelsUpdated(() => { void refreshModels(); }) ?? (() => {});
  }, []);

  useEffect(() => {
    if (!useCreateStore.getState().prompt.trim()) {
      setPrompt(t(`create.placeholder_${useCreateStore.getState().job}`));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleJob = (next: CreateJob) => {
    if (next === job) return;
    const placeholders = JOBS.map((item) => t(`create.placeholder_${item}`));
    const current = prompt.trim();
    if (!current || placeholders.includes(current)) {
      setPrompt(t(`create.placeholder_${next}`));
    }
    setJob(next);
  };

  const handleModelChange = async (modelId: string) => {
    setActiveModelId(modelId);
    await window.api?.setActiveModel(modelId);
  };

  const canCreate = prompt.trim().length > 0 && Boolean(activeModelId);

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>{t('create.what_to_create')}</h2>
      <p className={styles.lead}>{t('create.photos_lead')}</p>
      <WorkspaceFlow kind="create" />

      <div className={styles.jobRow}>
        {JOBS.map((item) => (
          <button
            key={item}
            type="button"
            className={styles.jobBtn}
            data-checked={job === item}
            onClick={() => handleJob(item)}
          >
            {t(`create.job_${item}`)}
          </button>
        ))}
      </div>
      <p className={styles.jobLead}>
        {t(`create.job_lead_${job}`)}
        {referenceImages.length > 0 ? ` ${t('create.job_lead_ref')}` : ''}
        {referenceImages.some((ref) => ref.kind === 'video')
          ? ` ${t('create.job_lead_video_ref')}`
          : ''}
      </p>

      <IntentInput
        value={prompt}
        onChange={setPrompt}
        onSubmit={() => { if (canCreate) startGeneration(); }}
        placeholder={t(`create.placeholder_${job}`)}
        hint={t('create.intent_hint')}
        references={referenceImages}
        onReferencesChange={setReferenceImages}
      />

      <div className={styles.options}>
        <div className={styles.field}>
          <span className={styles.label}>{t('create.model')}</span>
          {readyModels.length === 0 ? (
            <p className={styles.hint}>{t('create.no_model_installed')}</p>
          ) : (
            <select
              className={styles.select}
              value={activeModelId}
              onChange={(e) => { void handleModelChange(e.target.value); }}
            >
              {readyModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}
        </div>

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
            disabled={!canCreate}
          >
            {t('create.btn_create')}
          </button>
        </div>
      </div>
    </div>
  );
}
