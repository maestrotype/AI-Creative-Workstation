import type { ReactNode } from 'react';

import { useDirector } from './DirectorBoard';
import styles from './VideoPage.module.css';

type StepState = 'done' | 'current' | 'upcoming';

function stepState(done: boolean, current: boolean): StepState {
  if (done) return 'done';
  if (current) return 'current';
  return 'upcoming';
}

export function VoiceoverSteps(): ReactNode {
  const d = useDirector();
  const hasAnalysis = Boolean(d.voiceover.analysis);
  const hasScript = Boolean(d.voiceover.script?.segments.length);
  const hasVoice = d.voiceover.status === 'voiced';
  const step1 = stepState(hasAnalysis, !hasAnalysis);
  const step2 = stepState(hasScript, hasAnalysis && !hasScript);
  const step3 = stepState(hasVoice, hasScript && !hasVoice);

  const steps: Array<{ key: string; state: StepState; hint: string }> = [
    {
      key: 'video.vo_step_analyze',
      state: step1,
      hint: d.t('video.vo_step_analyze_hint'),
    },
    {
      key: 'video.vo_step_script',
      state: step2,
      hint: d.t('video.vo_step_script_hint'),
    },
    {
      key: 'video.vo_step_voice',
      state: step3,
      hint: d.t('video.vo_step_voice_hint'),
    },
  ];

  return (
    <ol className={styles.voSteps}>
      {steps.map((step, index) => (
        <li key={step.key} className={styles.voStep} data-state={step.state}>
          <span className={styles.voStepNum}>{index + 1}</span>
          <div className={styles.voStepBody}>
            <span className={styles.voStepLabel}>{d.t(step.key)}</span>
            {step.state === 'current' ? (
              <span className={styles.voStepHint}>{step.hint}</span>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
