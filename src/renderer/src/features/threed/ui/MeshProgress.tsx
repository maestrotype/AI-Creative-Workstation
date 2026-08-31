import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './MeshProgress.module.css';

const TRIPOSR_STAGES = [
  'queued',
  'free_vram',
  'preprocess',
  'import',
  'load_weights',
  'infer',
  'extract',
  'export',
  'done',
] as const;

const HUNYUAN_STAGES = [
  'queued',
  'free_vram',
  'preprocess',
  'load_weights',
  'infer',
  'export',
  'done',
] as const;

export type MeshEngineKind = 'hunyuan' | 'triposr';

export interface MeshProgressState {
  stage: string;
  percent: number;
  detail?: string;
  device?: string;
  engine?: string;
  weights_cached?: boolean;
}

interface MeshProgressProps {
  kind: 'still' | 'mesh';
  elapsedSec: number;
  stillPercent?: number;
  mesh?: MeshProgressState | null;
  engine?: MeshEngineKind;
}

export function MeshProgress({ kind, elapsedSec, stillPercent, mesh, engine }: MeshProgressProps): ReactNode {
  const { t } = useTranslation();
  const percent = kind === 'still' ? (stillPercent ?? 8) : (mesh?.percent ?? 5);
  const resolvedEngine: MeshEngineKind =
    mesh?.engine === 'hunyuan' || mesh?.engine === 'triposr'
      ? mesh.engine
      : (engine ?? 'triposr');
  const stages = resolvedEngine === 'hunyuan' ? HUNYUAN_STAGES : TRIPOSR_STAGES;
  const stageKey =
    kind === 'still'
      ? 'still'
      : mesh?.stage && (stages as readonly string[]).includes(mesh.stage)
        ? mesh.stage
        : 'queued';
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const ss = String(elapsedSec % 60).padStart(2, '0');
  const loadKey = resolvedEngine === 'hunyuan' ? 'stage_load_weights_hunyuan' : 'stage_load_weights';
  const loadHintKey = resolvedEngine === 'hunyuan' ? 'stage_load_weights_hint_hunyuan' : 'stage_load_weights_hint';

  const stageLabel = (s: string) => {
    if (s === 'load_weights') return t(`threed.${loadKey}`);
    return t(`threed.stage_${s}`);
  };

  return (
    <div className={styles.box}>
      <div className={styles.head}>
        <strong>{kind === 'still' ? t('threed.stage_still') : stageLabel(stageKey)}</strong>
        <span>{mm}:{ss}</span>
      </div>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${Math.max(percent, 3)}%` }} />
      </div>
      <p className={styles.meta}>
        {percent}%
        {kind === 'mesh' ? ` · ${resolvedEngine === 'hunyuan' ? 'Hunyuan3D 2 mini' : 'TripoSR'}` : ''}
        {kind === 'mesh' && mesh?.device ? ` · ${mesh.device}` : ''}
        {kind === 'mesh' && mesh?.detail ? ` · ${mesh.detail}` : ''}
        {kind === 'mesh' && mesh?.stage === 'load_weights' && !mesh.weights_cached
          ? ` · ${t(`threed.${loadHintKey}`)}`
          : ''}
      </p>
      {kind === 'mesh' ? (
        <ol className={styles.steps}>
          {stages.filter((s) => s !== 'done').map((s) => {
            const idx = stages.indexOf(s);
            const cur = stages.indexOf(stageKey as typeof stages[number]);
            const done = cur > idx || stageKey === 'done';
            const active = stageKey === s;
            return (
              <li key={s} data-done={done} data-active={active}>
                {stageLabel(s)}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={styles.hint}>{t('threed.generating_still_hint')}</p>
      )}
    </div>
  );
}
