import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { studioHref } from '../../studio/model/studioReturn';
import { useDirector } from './DirectorBoard';
import { LlmEngineNotice } from './LlmEngineNotice';
import { VoiceSampleSetup } from './VoiceSampleSetup';
import { formatTimecode } from '../model/videoAnalysis';
import styles from './VideoPage.module.css';

function scriptCoverageSec(script: NonNullable<ReturnType<typeof useDirector>['voiceover']['script']>): number {
  if (!script.segments.length) return 0;
  return Math.max(...script.segments.map((seg) => seg.end_sec));
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function targetWords(startSec: number, endSec: number): number {
  const windowSec = Math.max(0.4, endSec - startSec);
  return Math.max(10, Math.round(windowSec * 130 / 60 * 0.72 * 0.85));
}

export function VoiceoverScriptEditor(): ReactNode {
  const d = useDirector();
  const script = d.voiceover.script;
  const analysis = d.voiceover.analysis;
  const busy = d.scriptBusy || d.voiceoverApplyBusy;
  const voiced = d.voiceover.status === 'voiced';

  const coverageSec = script ? scriptCoverageSec(script) : 0;
  const videoSec = analysis?.duration_sec ?? 0;

  return (
    <div className={styles.voScriptBlock}>
      <h4 className={styles.voSubtitle}>{d.t('video.vo_script_title')}</h4>
      <LlmEngineNotice />
      <label className={styles.voPromptLabel}>
        <span>{d.t('video.vo_script_prompt')}</span>
        <textarea
          className={styles.voPromptInput}
          rows={3}
          value={d.voiceover.scriptPrompt}
          onChange={(e) => d.setScriptPrompt(e.target.value)}
          placeholder={d.t('video.vo_script_prompt_placeholder')}
          disabled={busy}
        />
      </label>
      <div className={styles.toolRow}>
        <button
          type="button"
          className={styles.toolPrimary}
          onClick={d.generateScript}
          disabled={busy || !d.voiceover.analysis}
        >
          {d.scriptBusy ? d.t('video.vo_script_generating') : d.t('video.vo_script_generate')}
        </button>
      </div>
      {d.scriptError ? <p className={styles.error}>{d.scriptError}</p> : null}
      {script ? (
        <>
          <p className={styles.voScriptStatus}>
            {d.t('video.vo_script_saved', { count: script.segments.length })}
            {analysis && script.segments.length !== analysis.scenes.length ? (
              <>
                {' · '}
                <span className={styles.voScriptWarn}>
                  {d.t('video.vo_script_scene_warn', {
                    segments: script.segments.length,
                    scenes: analysis.scenes.length,
                  })}
                </span>
              </>
            ) : null}
            {' · '}
            {script.meta.provider === 'ollama'
              ? d.t('video.vo_script_provider_ollama')
              : d.t('video.vo_script_provider_fallback')}
            {videoSec > 0 ? (
              <>
                {' · '}
                {d.t('video.vo_script_coverage', {
                  covered: formatTimecode(coverageSec),
                  total: formatTimecode(videoSec),
                })}
              </>
            ) : null}
          </p>
          {script.meta.provider === 'fallback' ? (
            <p className={styles.voScriptNotice}>
              {d.t('video.vo_script_fallback_note')}{' '}
              <Link className={styles.voStudioLink} to={studioHref('llm', '/video')}>{d.t('video.vo_script_open_studio')}</Link>
            </p>
          ) : null}
          <p className={styles.hintTight}>{d.t('video.vo_script_edit_hint')}</p>
          <div className={styles.voScriptCards}>
            {script.segments.map((seg, index) => {
              const words = wordCount(seg.text);
              const target = targetWords(seg.start_sec, seg.end_sec);
              const thin = words < Math.round(target * 0.6);
              return (
                <article key={`${seg.start_sec}-${index}`} className={styles.voScriptCard}>
                  <header className={styles.voScriptCardHead}>
                    <span className={styles.voScriptTime}>
                      {formatTimecode(seg.start_sec)} – {formatTimecode(seg.end_sec)}
                    </span>
                    <span className={styles.voScriptRole}>{seg.role}</span>
                    <span className={styles.voScriptWords} data-thin={thin || undefined}>
                      {words} / ~{target}
                    </span>
                  </header>
                  <textarea
                    className={styles.voScriptText}
                    rows={Math.min(8, Math.max(4, Math.ceil(seg.text.length / 42)))}
                    value={seg.text}
                    onChange={(e) => d.updateScriptSegment(index, { text: e.target.value })}
                    disabled={busy}
                  />
                  {seg.audio_path ? (
                    <button
                      type="button"
                      className={styles.toolBtn}
                      onClick={() => d.regenerateVoiceSegment(index)}
                      disabled={busy || !d.ttsReady}
                    >
                      Заново озвучить
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
          <div className={styles.voNextStep}>
            <div className={styles.toolRow}>
              <button type="button" className={styles.toolBtn} onClick={d.createCaptionsFromScript} disabled={busy}>
                Add captions to timeline
              </button>
              <button type="button" className={styles.toolBtn} onClick={d.exportSubtitles} disabled={busy}>
                Export SRT
              </button>
            </div>
            <VoiceSampleSetup />
            {(() => {
              const hasValidSample = Boolean(d.voiceHasSample && (d.voiceSampleSec ?? 0) >= 0.5);
              const canApply = !busy && d.ttsReady && hasValidSample;
              return (
                <>
                  <button
                    type="button"
                    className={styles.toolPrimary}
                    onClick={d.applyScriptVoiceover}
                    disabled={!canApply}
                  >
                    {d.voiceoverApplyBusy
                      ? d.t('video.vo_voice_applying', {
                          current: d.voiceoverApplyProgress.current,
                          total: d.voiceoverApplyProgress.total,
                        })
                      : voiced
                        ? d.t('video.vo_voice_apply_again')
                        : d.t('video.vo_voice_apply')}
                  </button>
                  {d.voiceoverApplyBusy ? (
                    <p className={styles.hintTight}>{d.voiceoverApplyProgress.detail}</p>
                  ) : null}
                  {d.voiceoverApplyError ? <p className={styles.error}>{d.voiceoverApplyError}</p> : null}
                  {!hasValidSample ? (
                    <p className={styles.hintTight}>{d.t('video.vo_sample_need_record')}</p>
                  ) : voiced ? (
                    <p className={styles.voScriptStatus}>{d.t('video.vo_after_voice_hint')}</p>
                  ) : (
                    <p className={styles.hintTight}>{d.t('video.vo_voice_apply_hint')}</p>
                  )}
                </>
              );
            })()}
          </div>
        </>
      ) : (
        <p className={styles.hintTight}>{d.t('video.vo_script_empty_hint')}</p>
      )}
    </div>
  );
}
