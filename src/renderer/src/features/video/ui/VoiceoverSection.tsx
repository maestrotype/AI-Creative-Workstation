import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { useDirector } from './DirectorBoard';
import { formatTimecode } from '../model/videoAnalysis';
import styles from './VideoPage.module.css';

export function VoiceoverSection(): ReactNode {
  const d = useDirector();
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!d.voiceover.expanded) return;
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [d.voiceover.expanded]);

  if (!d.voiceover.expanded) return null;

  const source = d.voiceoverSource;
  const ctx = d.voiceover.analysis;
  const busy = d.voiceoverBusy;
  const canAnalyze = Boolean(source?.path) && !busy;

  return (
    <section ref={rootRef} className={styles.voSection} data-expanded={d.voiceover.expanded}>
      <div className={styles.voHead}>
        <h3 className={styles.voTitle}>{d.t('video.vo_title')}</h3>
        <button
          type="button"
          className={styles.voCollapse}
          onClick={() => d.setVoiceoverExpanded(false)}
          aria-label={d.t('video.vo_collapse')}
        >
          ×
        </button>
      </div>
      <p className={styles.hintTight}>{d.t('video.vo_lead_inline')}</p>

      {source ? (
        <div className={styles.voSource}>
          <span className={styles.voSourceLabel}>{d.t('video.vo_source')}</span>
          <strong>{source.name}</strong>
          <span className={styles.voSourceFrom}>{d.t(`video.vo_source_${source.from}`)}</span>
        </div>
      ) : (
        <p className={styles.hintTight}>{d.t('video.vo_no_video')}</p>
      )}

      <div className={styles.toolRow}>
        <button
          type="button"
          className={styles.toolPrimary}
          onClick={d.analyzeVoiceover}
          disabled={!canAnalyze}
        >
          {busy ? d.t('video.vo_analyzing') : d.t('video.vo_analyze')}
        </button>
        <button type="button" className={styles.toolBtn} onClick={d.pickVideo} disabled={busy}>
          {d.t('video.vo_pick_other')}
        </button>
      </div>

      {busy ? (
        <div className={styles.progressBox}>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{ width: `${Math.max(4, d.voiceoverProgress.percent)}%` }}
            />
          </div>
          <p className={styles.hintTight}>{d.voiceoverProgress.detail}</p>
        </div>
      ) : null}

      {d.voiceoverError ? <p className={styles.error}>{d.voiceoverError}</p> : null}

      {ctx ? (
        <div className={styles.analysisBox}>
          <p className={styles.output}>
            {d.t('video.vo_summary', {
              duration: formatTimecode(ctx.duration_sec),
              scenes: ctx.scenes.length,
              words: ctx.transcript.full_text.split(/\s+/).filter(Boolean).length,
            })}
          </p>
          {ctx.warnings?.includes('WHISPER_NOT_INSTALLED') ? (
            <p className={styles.hintTight}>{d.t('video.vo_whisper_missing')}</p>
          ) : null}
          <p className={styles.hintTight}>{d.t('video.vo_phase2_hint')}</p>
          <h4 className={styles.voSubtitle}>{d.t('video.vo_scenes')}</h4>
          <ul className={styles.scenes}>
            {ctx.scenes.map((scene) => (
              <li key={scene.index}>
                {formatTimecode(scene.start)} – {formatTimecode(scene.end)}
              </li>
            ))}
          </ul>
          {ctx.transcript.segments.length > 0 ? (
            <details className={styles.voDetails}>
              <summary>{d.t('video.vo_show_transcript')}</summary>
              <ul className={styles.transcriptList}>
                {ctx.transcript.segments.map((seg, i) => (
                  <li key={`${seg.start}-${i}`}>
                    <span className={styles.ts}>{formatTimecode(seg.start)}</span>
                    {seg.text}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
