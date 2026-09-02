import type { ReactNode } from 'react';

import { useDirector } from './DirectorBoard';
import { formatTimecode } from '../model/videoAnalysis';
import styles from './VideoPage.module.css';

export function VoiceoverScriptEditor(): ReactNode {
  const d = useDirector();
  const script = d.voiceover.script;
  const busy = d.scriptBusy;

  return (
    <div className={styles.voScriptBlock}>
      <h4 className={styles.voSubtitle}>{d.t('video.vo_script_title')}</h4>
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
          {busy ? d.t('video.vo_script_generating') : d.t('video.vo_script_generate')}
        </button>
      </div>
      {d.scriptError ? <p className={styles.error}>{d.scriptError}</p> : null}
      {script ? (
        <>
          <p className={styles.hintTight}>
            {d.t('video.vo_script_meta', {
              segments: script.segments.length,
              provider:
                script.meta.provider === 'ollama'
                  ? d.t('video.vo_script_provider_ollama')
                  : d.t('video.vo_script_provider_fallback'),
            })}
          </p>
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
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.hintTight}>{d.t('video.vo_phase3_hint')}</p>
        </>
      ) : null}
    </div>
  );
}
