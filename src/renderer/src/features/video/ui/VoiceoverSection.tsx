import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useDirector } from './DirectorBoard';
import { VoiceoverSteps } from './VoiceoverSteps';
import { VoiceoverScriptEditor } from './VoiceoverScriptEditor';
import { formatTimecode } from '../model/videoAnalysis';
import styles from './VideoPage.module.css';

const SPEED_PRESETS = [1, 0.85, 0.75, 0.6] as const;

export function VoiceoverSection(): ReactNode {
  const d = useDirector();
  const rootRef = useRef<HTMLElement>(null);
  const [targetSec, setTargetSec] = useState<number | null>(null);

  useEffect(() => {
    if (!d.voiceover.expanded) return;
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [d.voiceover.expanded]);

  const source = d.voiceoverSource;
  const masterSec = Math.max(0.5, d.pictureMasterSec || source?.durationSec || 6);
  const currentSec = Math.max(0.5, source?.durationSec || masterSec);
  const durationPresets = useMemo(() => {
    const base = Math.round(masterSec * 10) / 10;
    const extras = [7, 8, 10, 12, 15]
      .map((sec) => Math.round(sec * 10) / 10)
      .filter((sec) => sec > base + 0.15);
    return Array.from(new Set([base, ...extras])).sort((a, b) => a - b);
  }, [masterSec]);
  const selectedTarget = targetSec ?? Math.max(currentSec, masterSec);
  const selectedSpeed = masterSec / Math.max(0.5, selectedTarget);

  if (!d.voiceover.expanded) return null;

  const ctx = d.voiceover.analysis;
  const busy = d.voiceoverBusy || d.scriptBusy || d.voiceoverApplyBusy;
  const film = source?.from === 'assembled_timeline';
  const canAnalyze = Boolean(source && (source.path || film)) && !d.voiceoverBusy;

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
      <VoiceoverSteps />

      {source ? (
        <div className={styles.voSource}>
          <span className={styles.voSourceLabel}>{d.t('video.vo_source')}</span>
          <strong>
            {film
              ? d.t('video.vo_source_film', { count: d.chapterCount })
              : source.name}
          </strong>
          <span className={styles.voSourceFrom}>{d.t(`video.vo_source_${source.from}`)}</span>
        </div>
      ) : (
        <p className={styles.hintTight}>{d.t('video.vo_no_video')}</p>
      )}

      <div className={styles.toolRow}>
        {source ? (
          <button
            type="button"
            className={styles.toolPrimary}
            onClick={d.replaceOwnNarration}
            disabled={!canAnalyze || d.scriptBusy || d.voiceoverApplyBusy}
          >
            {d.scriptBusy || d.voiceoverBusy || d.voiceoverApplyBusy
              ? d.t('video.vo_dub_busy')
              : d.t('video.vo_dub_mine')}
          </button>
        ) : (
          <button type="button" className={styles.toolPrimary} onClick={d.pickVideo} disabled={busy}>
            {d.t('video.vo_pick_ready')}
          </button>
        )}
      </div>
      <p className={styles.hintTight}>
        {d.voiceHasSample
          ? d.t('video.vo_dub_hint', { name: d.voiceSampleName || d.t('video.vo_dub_sample_fallback') })
          : (
            <>
              {d.t('video.vo_dub_need_sample')}
              {' '}
              <Link to="/assets?tab=voice">{d.t('video.dub_need_sample_link')}</Link>
            </>
          )}
      </p>

      {source ? (
        <div className={styles.voPaceBox}>
          <div className={styles.voHeardLabel}>{d.t('video.vo_pace_title')}</div>
          <p className={styles.hintTight}>{d.t('video.vo_pace_hint')}</p>
          <div className={styles.voPaceRow} role="group" aria-label={d.t('video.vo_pace_duration')}>
            <span className={styles.voPaceKey}>{d.t('video.vo_pace_duration')}</span>
            <div className={styles.voPaceChips}>
              {durationPresets.map((sec) => (
                <button
                  key={sec}
                  type="button"
                  className={styles.voPaceChip}
                  data-on={Math.abs(selectedTarget - sec) < 0.08 || undefined}
                  disabled={busy}
                  onClick={() => setTargetSec(sec)}
                >
                  {Number.isInteger(sec) ? `${sec}с` : `${sec.toFixed(1)}с`}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.voPaceRow} role="group" aria-label={d.t('video.vo_pace_speed')}>
            <span className={styles.voPaceKey}>{d.t('video.vo_pace_speed')}</span>
            <div className={styles.voPaceChips}>
              {SPEED_PRESETS.map((rate) => {
                const sec = Math.round((masterSec / rate) * 10) / 10;
                return (
                  <button
                    key={rate}
                    type="button"
                    className={styles.voPaceChip}
                    data-on={Math.abs(selectedSpeed - rate) < 0.03 || undefined}
                    disabled={busy}
                    onClick={() => setTargetSec(sec)}
                  >
                    {rate === 1 ? '1×' : `${rate}×`}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            className={styles.toolPrimary}
            disabled={busy || !d.voiceHasSample}
            onClick={() => d.stretchAndRespeak(selectedTarget)}
          >
            {busy
              ? d.t('video.vo_dub_busy')
              : d.t('video.vo_pace_apply', { sec: selectedTarget.toFixed(0) })}
          </button>
          <p className={styles.hintTight}>
            {d.t('video.vo_pace_summary', {
              from: masterSec.toFixed(1),
              to: selectedTarget.toFixed(1),
              speed: selectedSpeed.toFixed(2),
            })}
          </p>
        </div>
      ) : null}

      {source ? (
      <div className={styles.toolRow}>
        {ctx && !d.voiceoverBusy && !ctx.warnings?.includes('VISION_MODEL_MISSING') && !ctx.warnings?.includes('VISION_CAPTION_FAILED') ? (
          <span className={styles.voAnalyzeReady}>{d.t('video.vo_analyze_ready')}</span>
        ) : (
          <button
            type="button"
            className={styles.toolBtn}
            onClick={d.analyzeVoiceover}
            disabled={!canAnalyze}
          >
            {d.voiceoverBusy ? d.t('video.vo_analyzing') : d.t('video.vo_analyze')}
          </button>
        )}
        {ctx ? (
          <button
            type="button"
            className={styles.toolBtn}
            onClick={d.reanalyzeVoiceover}
            disabled={!canAnalyze}
          >
            {busy ? d.t('video.vo_analyzing') : d.t('video.vo_reanalyze')}
          </button>
        ) : null}
        <button type="button" className={styles.toolBtn} onClick={d.pickVideo} disabled={busy}>
          {d.t('video.vo_pick_other')}
        </button>
      </div>
      ) : null}

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

          {(ctx.transcript.full_text.trim() || ctx.transcript.segments.length > 0) ? (
            <div className={styles.voHeardBox}>
              <div className={styles.voHeardLabel}>{d.t('video.vo_heard_title')}</div>
              <p className={styles.voHeardText}>
                {ctx.transcript.full_text.trim()
                  || ctx.transcript.segments.map((seg) => seg.text).join(' ')}
              </p>
              {ctx.transcript.segments.length > 1 ? (
                <ul className={styles.transcriptList}>
                  {ctx.transcript.segments.map((seg, i) => (
                    <li key={`${seg.start}-${i}`}>
                      <span className={styles.ts}>{formatTimecode(seg.start)}</span>
                      {seg.text}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {d.voiceover.script?.segments.length ? (
            <div className={styles.voHeardBox}>
              <div className={styles.voHeardLabel}>{d.t('video.vo_heard_script_title')}</div>
              <ul className={styles.transcriptList}>
                {d.voiceover.script.segments.map((seg, i) => (
                  <li key={`script-${i}-${seg.start_sec}`}>
                    <span className={styles.ts}>{formatTimecode(seg.start_sec)}</span>
                    {(seg.text || seg.text_en || '').trim()}
                    {seg.speech_sec != null ? (
                      <span className={styles.ts}>
                        {` · ${seg.speech_sec.toFixed(1)}с`}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {d.narrationAlignNote ? (
            <p className={styles.nextHint} role="status">{d.narrationAlignNote}</p>
          ) : null}

          <div className={styles.toolRow}>
            <button
              type="button"
              className={styles.toolPrimary}
              onClick={d.splitByAnalysis}
              disabled={ctx.scenes.length < 2}
            >
              {d.t('video.vo_split_chapters')}
            </button>
            <button type="button" className={styles.toolBtn} onClick={d.saveTimelineAsTemplate}>
              {d.t('projects.save_template')}
            </button>
          </div>
          <p className={styles.hintTight}>{d.t('video.vo_split_hint')}</p>
          {d.templateNotice ? <p className={styles.nextHint}>{d.templateNotice}</p> : null}
          {!d.voiceoverBusy && (ctx.warnings?.includes('VISION_MODEL_MISSING') || ctx.warnings?.includes('VISION_CAPTION_FAILED')) ? (
            <p className={styles.error}>{d.t('video.pipe_vision_missing')}</p>
          ) : null}
          {ctx.warnings?.includes('WHISPER_NOT_INSTALLED') ? (
            <p className={styles.hintTight}>{d.t('video.vo_whisper_missing')}</p>
          ) : null}
          <details className={styles.voDetails}>
            <summary>{d.t('video.vo_scenes')}</summary>
            <ul className={styles.scenes}>
              {ctx.scenes.map((scene) => (
                <li key={scene.index}>
                  {formatTimecode(scene.start)} – {formatTimecode(scene.end)}
                </li>
              ))}
            </ul>
          </details>
          <VoiceoverScriptEditor />
        </div>
      ) : null}
    </section>
  );
}
