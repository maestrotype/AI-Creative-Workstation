import { useTranslation } from 'react-i18next';

import {
  defaultMotionPlan,
  MAX_SEGMENTS,
  motionPlanSeconds,
  randomSeed,
  SEGMENT_SECONDS,
  type MotionPlan,
  type MotionSegment,
} from '../model/motionPlan';
import styles from './MotionPlanEditor.module.css';

interface Props {
  plan: MotionPlan | undefined;
  chapterSec: number;
  busy: boolean;
  running: boolean;
  onChange: (plan: MotionPlan | undefined) => void;
  onRun: (plan: MotionPlan) => void;
}

/** Segment plan for one long AI shot: a chain of Wan segments joined on their last frame. */
export function MotionPlanEditor({ plan, chapterSec, busy, running, onChange, onRun }: Props) {
  const { t } = useTranslation();

  if (!plan) {
    return (
      <button type="button" className={styles.open} disabled={busy} onClick={() => onChange(defaultMotionPlan(chapterSec))}>
        {t('projects.plan_open')}
      </button>
    );
  }

  const total = motionPlanSeconds(plan);
  const patchSegment = (index: number, partial: Partial<MotionSegment>) => onChange({
    ...plan,
    segments: plan.segments.map((segment, i) => (i === index ? { ...segment, ...partial } : segment)),
  });
  const removeSegment = (index: number) => onChange({
    ...plan,
    segments: plan.segments.filter((_segment, i) => i !== index),
  });

  return (
    <section className={styles.plan}>
      <header className={styles.head}>
        <strong>{t('projects.plan_title')}</strong>
        <span className={styles.total}>
          {t('projects.plan_total', { count: plan.segments.length, sec: total, chapter: chapterSec })}
        </span>
        <button type="button" className={styles.close} disabled={busy} onClick={() => onChange(undefined)}>
          {t('projects.plan_close')}
        </button>
      </header>
      <p className={styles.hint}>{t('projects.plan_hint')}</p>

      <ol className={styles.chain} aria-label={t('projects.plan_title')}>
        {plan.segments.map((segment, index) => (
          <li key={index} className={styles.node} style={{ flexGrow: segment.seconds }}>
            <span className={styles.nodeHead}>
              {t('projects.plan_segment', { n: index + 1 })}
              <small>{index === 0 ? t('projects.plan_from_still') : t('projects.plan_from_last')}</small>
            </span>
            <textarea
              rows={3}
              value={segment.prompt}
              disabled={busy}
              placeholder={t('projects.plan_prompt_ph')}
              onChange={(e) => patchSegment(index, { prompt: e.target.value })}
            />
            <span className={styles.nodeRow}>
              <select
                value={segment.seconds}
                disabled={busy}
                onChange={(e) => patchSegment(index, { seconds: Number(e.target.value) })}
              >
                {SEGMENT_SECONDS.map((sec) => (
                  <option key={sec} value={sec}>{t('projects.plan_seconds', { sec })}</option>
                ))}
              </select>
              {plan.segments.length > 1 ? (
                <button type="button" className={styles.remove} disabled={busy} onClick={() => removeSegment(index)}>
                  {t('projects.remove')}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ol>

      <div className={styles.foot}>
        <button
          type="button"
          className={styles.add}
          disabled={busy || plan.segments.length >= MAX_SEGMENTS}
          onClick={() => onChange({ ...plan, segments: [...plan.segments, { prompt: '', seconds: 5 }] })}
        >
          {t('projects.plan_add')}
        </button>
        <label className={styles.seed}>
          <span>seed</span>
          <input
            type="number"
            min={0}
            value={plan.seed}
            disabled={busy}
            onChange={(e) => onChange({ ...plan, seed: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
          />
          <button type="button" disabled={busy} onClick={() => onChange({ ...plan, seed: randomSeed() })}>
            {t('projects.plan_new_seed')}
          </button>
        </label>
        <button type="button" className={styles.run} disabled={busy} onClick={() => onRun(plan)}>
          {running ? t('projects.generating') : t('projects.plan_run', { sec: total })}
        </button>
      </div>
    </section>
  );
}
