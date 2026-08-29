import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './MeshProgress.module.css';

export const MESH_STAGES = [
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

export interface MeshProgressState {
  stage: string;
  percent: number;
  detail?: string;
  device?: string;
  weights_cached?: boolean;
}

interface MeshProgressProps {
  kind: 'still' | 'mesh';
  elapsedSec: number;
  stillPercent?: number;
  mesh?: MeshProgressState | null;
}

export function MeshProgress({ kind, elapsedSec, stillPercent, mesh }: MeshProgressProps): ReactNode {
  const { t } = useTranslation();
  const percent = kind === 'still' ? (stillPercent ?? 8) : (mesh?.percent ?? 5);
  const stageKey = kind === 'still' ? 'still' : (mesh?.stage && MESH_STAGES.includes(mesh.stage as typeof MESH_STAGES[number]) ? mesh.stage : 'queued');
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const ss = String(elapsedSec % 60).padStart(2, '0');

  return (
    <div className={styles.box}>
      <div className={styles.head}>
        <strong>{t(`threed.stage_${stageKey}`)}</strong>
        <span>{mm}:{ss}</span>
      </div>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${Math.max(percent, 3)}%` }} />
      </div>
      <p className={styles.meta}>
        {percent}%
        {kind === 'mesh' && mesh?.device ? ` · ${mesh.device}` : ''}
        {kind === 'mesh' && mesh?.detail ? ` · ${mesh.detail}` : ''}
        {kind === 'mesh' && mesh?.stage === 'load_weights' && !mesh.weights_cached
          ? ` · ${t('threed.stage_load_weights_hint')}`
          : ''}
      </p>
      {kind === 'mesh' ? (
        <ol className={styles.steps}>
          {MESH_STAGES.filter((s) => s !== 'done').map((s) => {
            const idx = MESH_STAGES.indexOf(s);
            const cur = MESH_STAGES.indexOf(stageKey as typeof MESH_STAGES[number]);
            const done = cur > idx || stageKey === 'done';
            const active = stageKey === s;
            return (
              <li key={s} data-done={done} data-active={active}>
                {t(`threed.stage_${s}`)}
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
