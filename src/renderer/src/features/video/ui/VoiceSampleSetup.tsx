import { useState } from 'react';
import type { ReactNode } from 'react';

import { useDirector } from './DirectorBoard';
import styles from './VideoPage.module.css';

function ipcMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.trim() || fallback;
}

export function VoiceSampleSetup(): ReactNode {
  const d = useDirector();
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const busy = d.voiceBusy || installing || d.voiceoverApplyBusy || d.scriptBusy;
  const sampleLabel = d.voiceSampleName
    ? d.voiceSampleName.split(/[/\\]/).pop() ?? d.voiceSampleName
    : null;
  const audioOptions = (() => {
    const seen = new Set<string>();
    const out: Array<{ path: string; name: string }> = [];
    for (const item of [
      ...d.libraryAudio,
      ...d.bins.filter((b) => b.kind === 'audio').map((b) => ({ path: b.path, name: b.name })),
    ]) {
      if (!item.path || seen.has(item.path)) continue;
      seen.add(item.path);
      out.push(item);
    }
    return out;
  })();

  const handleInstall = async () => {
    if (!window.api?.installVoiceEngine) return;
    setInstalling(true);
    setInstallError(null);
    try {
      await window.api.installVoiceEngine();
    } catch (err) {
      setInstallError(ipcMessage(err, d.t('video.vo_voice_install_fail')));
    } finally {
      setInstalling(false);
    }
  };

  const sampleControls = (
    <div className={styles.toolRow}>
      <button
        type="button"
        className={d.voiceSampleRecording ? styles.toolPrimary : styles.toolBtn}
        onClick={d.toggleVoiceSampleRecord}
        disabled={busy || d.voiceRecording}
      >
        {d.voiceSampleRecording ? d.t('video.vo_voice_sample_stop') : d.t('video.vo_voice_sample_record')}
      </button>
      <button
        type="button"
        className={styles.toolBtn}
        onClick={d.pickVoiceSample}
        disabled={busy || d.voiceSampleRecording}
      >
        {d.t('video.vo_voice_sample_pick')}
      </button>
      {audioOptions.length > 0 ? (
        <select
          className={styles.voiceSelect}
          defaultValue=""
          disabled={busy || d.voiceSampleRecording}
          onChange={(e) => {
            const path = e.target.value;
            e.target.value = '';
            if (path) d.setVoiceSampleFromLibrary(path);
          }}
        >
          <option value="" disabled>{d.t('video.vo_voice_sample_lib')}</option>
          {audioOptions.map((clip) => (
            <option key={clip.path} value={clip.path}>{clip.name}</option>
          ))}
        </select>
      ) : null}
    </div>
  );

  if (!d.voiceEngineReady) {
    return (
      <div className={styles.voSampleBlock}>
        <h4 className={styles.voSubtitle}>{d.t('video.vo_voice_sample_title')}</h4>
        <p className={styles.hintTight}>{d.t('video.vo_voice_sample_hint')}</p>
        <div className={styles.toolRow}>
          <button
            type="button"
            className={styles.toolPrimary}
            onClick={() => { void handleInstall(); }}
            disabled={busy || !window.api?.installVoiceEngine}
          >
            {installing ? d.t('video.vo_voice_installing') : d.t('video.vo_voice_install')}
          </button>
        </div>
        {installError ? <p className={styles.error}>{installError}</p> : null}
        {d.voiceError ? <p className={styles.error}>{d.voiceError}</p> : null}
      </div>
    );
  }

  return (
    <div className={styles.voSampleBlock}>
      <h4 className={styles.voSubtitle}>{d.t('video.vo_voice_sample_title')}</h4>
      {d.ttsReady ? (
        <p className={styles.voScriptStatus}>
          {sampleLabel
            ? d.t('video.vo_voice_ready_named', { name: sampleLabel })
            : d.t('video.vo_voice_ready')}
        </p>
      ) : (
        <p className={styles.hintTight}>{d.t('video.vo_voice_sample_hint')}</p>
      )}
      <p className={styles.hintTight}>{d.t('video.vo_voice_sample_change')}</p>
      {sampleControls}
      {d.voiceSampleRecording ? (
        <p className={styles.hintTight}>{d.t('video.vo_voice_sample_recording')}</p>
      ) : null}
      {d.voiceSampleWarning === 'SAMPLE_TOO_QUIET' ? (
        <div className={styles.voSampleAlert}>
          <p className={styles.error}>
            {d.t('video.vo_sample_quiet', { peak: Math.round(d.voiceSamplePeakDb ?? 0) })}
          </p>
          <p className={styles.hintTight}>{d.t('video.vo_sample_quiet_fix')}</p>
        </div>
      ) : null}
      {d.voiceSampleWarning === 'SAMPLE_TOO_SHORT' ? (
        <p className={styles.voScriptWarn}>
          {d.t('video.vo_sample_short', { sec: Math.round(d.voiceSampleSec ?? 0) })}
        </p>
      ) : null}
      {installError ? <p className={styles.error}>{installError}</p> : null}
      {d.voiceError ? <p className={styles.error}>{d.voiceError}</p> : null}
    </div>
  );
}
