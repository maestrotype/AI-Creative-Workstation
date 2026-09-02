import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useDirector } from './DirectorBoard';
import { VoiceSampleSetup } from './VoiceSampleSetup';
import { formatTimecode } from '../model/videoAnalysis';
import styles from './VideoPage.module.css';

function scriptCoverageSec(script: NonNullable<ReturnType<typeof useDirector>['voiceover']['script']>): number {
  if (!script.segments.length) return 0;
  return Math.max(...script.segments.map((seg) => seg.end_sec));
}

export function VoiceoverScriptEditor(): ReactNode {
  const d = useDirector();
  const script = d.voiceover.script;
  const analysis = d.voiceover.analysis;
  const busy = d.scriptBusy || d.voiceoverApplyBusy;
  const [ollamaReady, setOllamaReady] = useState<boolean | null>(null);
  const voiced = d.voiceover.status === 'voiced';

  useEffect(() => {
    void window.api?.getOllamaEngineStatus?.().then((status) => {
      setOllamaReady(Boolean(status?.model_ready && status?.server_running));
    }).catch(() => setOllamaReady(null));
    const cleanup = window.api?.onOllamaEngineUpdated?.((status) => {
      setOllamaReady(Boolean(status.model_ready && status.server_running));
    });
    return () => { cleanup?.(); };
  }, []);

  const coverageSec = script ? scriptCoverageSec(script) : 0;
  const videoSec = analysis?.duration_sec ?? 0;

  return (
    <div className={styles.voScriptBlock}>
      <h4 className={styles.voSubtitle}>{d.t('video.vo_script_title')}</h4>
      {ollamaReady === false ? (
        <p className={styles.voScriptNotice}>
          {d.t('video.vo_script_fallback_note')}{' '}
          <Link className={styles.voStudioLink} to="/studio?family=llm">{d.t('video.vo_script_open_studio')}</Link>
        </p>
      ) : null}
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
              <Link className={styles.voStudioLink} to="/studio?family=llm">{d.t('video.vo_script_open_studio')}</Link>
            </p>
          ) : null}
          <p className={styles.hintTight}>{d.t('video.vo_script_edit_hint')}</p>
          <div className={styles.voScriptTableWrap}>
            <table className={styles.voScriptTable}>
              <thead>
                <tr>
                  <th>{d.t('video.vo_script_col_time')}</th>
                  <th>{d.t('video.vo_script_col_text')}</th>
                </tr>
              </thead>
              <tbody>
                {script.segments.map((seg, index) => (
                  <tr key={`${seg.start_sec}-${index}`}>
                    <td className={styles.voScriptTime}>
                      {formatTimecode(seg.start_sec)} – {formatTimecode(seg.end_sec)}
                      <span className={styles.voScriptRole}>{seg.role}</span>
                    </td>
                    <td>
                      <textarea
                        className={styles.voScriptText}
                        rows={2}
                        value={seg.text}
                        onChange={(e) => d.updateScriptSegment(index, { text: e.target.value })}
                        disabled={busy}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.voNextStep}>
            <VoiceSampleSetup />
            <button
              type="button"
              className={styles.toolPrimary}
              onClick={d.applyScriptVoiceover}
              disabled={busy || !d.ttsReady || voiced}
            >
              {d.voiceoverApplyBusy
                ? d.t('video.vo_voice_applying', {
                    current: d.voiceoverApplyProgress.current,
                    total: d.voiceoverApplyProgress.total,
                  })
                : d.t('video.vo_voice_apply')}
            </button>
            {d.voiceoverApplyBusy ? (
              <p className={styles.hintTight}>{d.voiceoverApplyProgress.detail}</p>
            ) : null}
            {d.voiceoverApplyError ? <p className={styles.error}>{d.voiceoverApplyError}</p> : null}
            {voiced ? (
              <p className={styles.voScriptStatus}>{d.t('video.vo_after_voice_hint')}</p>
            ) : (
              <p className={styles.hintTight}>{d.t('video.vo_voice_apply_hint')}</p>
            )}
          </div>
        </>
      ) : (
        <p className={styles.hintTight}>{d.t('video.vo_script_empty_hint')}</p>
      )}
    </div>
  );
}
