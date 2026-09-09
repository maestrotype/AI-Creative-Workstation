import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { useTranslation } from 'react-i18next';
import { WorkspaceFlow } from '../../../studio/ui/WorkspaceFlow';
import { IntentInput } from '../../../../shared/ui/IntentInput/IntentInput';
import type { CreateJob, GenerationFormat, GenerationStyle } from '../../api/generationApi';
import { useCreateStore, type CreateMedium } from '../../store/createStore';
import { isAiVideoProvider, isAnimationProvider } from '../../model/videoCapability';
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
  const medium = useCreateStore((s) => s.medium);
  const job = useCreateStore((s) => s.job);
  const format = useCreateStore((s) => s.format);
  const style = useCreateStore((s) => s.style);
  const setPrompt = useCreateStore((s) => s.setPrompt);
  const setMedium = useCreateStore((s) => s.setMedium);
  const setJob = useCreateStore((s) => s.setJob);
  const setFormat = useCreateStore((s) => s.setFormat);
  const setStyle = useCreateStore((s) => s.setStyle);
  const referenceImages = useCreateStore((s) => s.referenceImages);
  const setReferenceImages = useCreateStore((s) => s.setReferenceImages);
  const startGeneration = useCreateStore((s) => s.startGeneration);
  const [readyModels, setReadyModels] = useState<ReadyModel[]>([]);
  const [activeModelId, setActiveModelId] = useState<string>('');
  const [engineStatus, setEngineStatus] = useState<'ready' | 'starting' | 'error' | 'stopped'>('starting');
  const [engineRestarting, setEngineRestarting] = useState(false);

  const refreshEngine = async () => {
    if (!window.api?.getEngineStatus) {
      setEngineStatus('stopped');
      return;
    }
    try {
      const next = await window.api.getEngineStatus();
      const status = next.status;
      if (status === 'ready' || status === 'starting' || status === 'error' || status === 'stopped') {
        setEngineStatus(status);
      }
    } catch {
      setEngineStatus('error');
    }
  };

  const restartEngine = async () => {
    if (!window.api?.restartEngine) return;
    setEngineRestarting(true);
    setEngineStatus('starting');
    try {
      const out = await window.api.restartEngine();
      setEngineStatus(out.ok ? 'ready' : 'error');
    } catch {
      setEngineStatus('error');
    } finally {
      setEngineRestarting(false);
    }
  };

  const refreshModels = async () => {
    if (!window.api) return;
    const models = await window.api.getModels();
    const type = medium === 'image' ? 'image' : 'video';
    const ready = models
      .filter((m: { status: string; type?: string; id: string; name: string }) => m.status === 'ready' && m.type === type)
      .filter((m: { id: string }) => {
        if (medium === 'video') return isAiVideoProvider(m.id);
        if (medium === 'animate') return isAnimationProvider(m.id);
        return true;
      })
      .map((m: { id: string; name: string }) => ({ id: m.id, name: m.name }));
    setReadyModels(ready);
    const active = medium === 'image'
      ? await window.api.getActiveModel()
      : await window.api.getActiveVideoModel();
    const nextId = (active && ready.some((m) => m.id === active) ? active : ready[0]?.id) ?? '';
    setActiveModelId(nextId);
    if (nextId && nextId !== active && medium === 'image') {
      await window.api.setActiveModel(nextId);
    }
  };

  useEffect(() => {
    void refreshModels();
    void refreshEngine();
    const unsubModels = window.api?.onModelsUpdated(() => { void refreshModels(); }) ?? (() => {});
    const unsubEngine = window.api?.onEngineStatus((data) => {
      const status = data.status;
      if (status === 'ready' || status === 'starting' || status === 'error' || status === 'stopped') {
        setEngineStatus(status);
      }
    }) ?? (() => {});
    const timer = window.setInterval(() => { void refreshEngine(); }, 4000);
    return () => {
      unsubModels();
      unsubEngine();
      window.clearInterval(timer);
    };
  }, [medium]);

  useEffect(() => {
    if (!useCreateStore.getState().prompt.trim()) {
      setPrompt(t(`create.placeholder_${useCreateStore.getState().job}`));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMedium = (next: CreateMedium) => {
    if (next === medium) return;
    const placeholders = [
      ...JOBS.map((item) => t(`create.placeholder_${item}`)),
      t('create.placeholder_video'),
      t('create.placeholder_animate'),
    ];
    const current = prompt.trim();
    if (!current || placeholders.includes(current)) {
      setPrompt(
        next === 'video'
          ? t('create.placeholder_video')
          : next === 'animate'
            ? t('create.placeholder_animate')
            : t(`create.placeholder_${job}`),
      );
    }
    setMedium(next);
  };

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
    if (medium !== 'image') await window.api?.setActiveVideoModel(modelId);
    else await window.api?.setActiveModel(modelId);
  };

  const hasStill = referenceImages.some((ref) => ref.kind !== 'video' && (ref.sourcePath || ref.dataUrl));
  const needsStill = medium !== 'image';
  const engineReady = engineStatus === 'ready';
  const canCreate = prompt.trim().length > 0 && Boolean(activeModelId) && (!needsStill || hasStill) && engineReady;
  const titleKey = medium === 'video'
    ? 'create.what_to_create_video'
    : medium === 'animate'
      ? 'create.what_to_create_animate'
      : 'create.what_to_create';
  const leadKey = medium === 'video'
    ? 'create.video_lead'
    : medium === 'animate'
      ? 'create.animate_lead'
      : 'create.photos_lead';

  return (
    <div className={styles.container}>
      {!engineReady ? (
        <div className={styles.engineBanner} role="status">
          <p>{t(engineStatus === 'starting' ? 'create.engine_starting' : 'create.engine_down')}</p>
          <button
            type="button"
            className={styles.engineRestart}
            disabled={engineRestarting || engineStatus === 'starting'}
            onClick={() => { void restartEngine(); }}
          >
            {t('create.engine_restart')}
          </button>
        </div>
      ) : null}
      <h2 className={styles.title}>{t(titleKey)}</h2>
      <p className={styles.lead}>{t(leadKey)}</p>
      <WorkspaceFlow kind="create" />

      <div className={styles.jobRow}>
        <button
          type="button"
          className={styles.jobBtn}
          data-checked={medium === 'image'}
          onClick={() => handleMedium('image')}
        >
          {t('create.medium_image')}
        </button>
        <button
          type="button"
          className={styles.jobBtn}
          data-checked={medium === 'video'}
          onClick={() => handleMedium('video')}
        >
          {t('create.medium_video')}
        </button>
        <button
          type="button"
          className={styles.jobBtn}
          data-checked={medium === 'animate'}
          onClick={() => handleMedium('animate')}
        >
          {t('create.medium_animate')}
        </button>
      </div>

      {medium === 'image' ? (
        <>
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
        </>
      ) : (
        <p className={styles.jobLead}>
          {t(medium === 'animate' ? 'create.job_lead_animate' : 'create.job_lead_clip')}
          {needsStill && !hasStill ? ` ${t('create.video_need_still')}` : ''}
        </p>
      )}

      <IntentInput
        value={prompt}
        onChange={setPrompt}
        onSubmit={() => { if (canCreate) startGeneration(undefined, activeModelId || undefined); }}
        placeholder={t(
          medium === 'video'
            ? 'create.placeholder_video'
            : medium === 'animate'
              ? 'create.placeholder_animate'
              : `create.placeholder_${job}`,
        )}
        hint={t(
          medium === 'video'
            ? 'create.video_hint'
            : medium === 'animate'
              ? 'create.animate_hint'
              : 'create.intent_hint',
        )}
        references={referenceImages}
        onReferencesChange={setReferenceImages}
      />

      <div className={styles.options}>
        <div className={styles.field}>
          <span className={styles.label}>{t('create.model')}</span>
          {readyModels.length === 0 ? (
            <p className={styles.hint}>
              {t(
                medium === 'video'
                  ? 'create.no_ai_video_provider'
                  : medium === 'animate'
                    ? 'create.no_animation_model'
                    : 'create.no_model_installed',
              )}
            </p>
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
        {medium !== 'image' ? (
          <p className={styles.hint}>
            {t(medium === 'video' ? 'create.cap_ai_video' : 'create.cap_animation')}
          </p>
        ) : null}

        {medium !== 'animate' ? (
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
        ) : null}

        {medium === 'image' ? (
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
        ) : null}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.createButton}
            onClick={() => { startGeneration(undefined, activeModelId || undefined); }}
            disabled={!canCreate}
          >
            {t(
              medium === 'video'
                ? 'create.btn_create_clip'
                : medium === 'animate'
                  ? 'create.btn_animate'
                  : 'create.btn_create',
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
