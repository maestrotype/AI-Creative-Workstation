import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useDirector } from './DirectorBoard';
import { mediaMime, toAssetUrl } from '../model/directorMedia';
import styles from './VideoPage.module.css';

function ipcMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.trim() || fallback;
}

export function VoiceSampleSetup(): ReactNode {
  const d = useDirector();
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [playingPath, setPlayingPath] = useState<string | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  useEffect(() => {
    if (!playingPath) {
      setPlayUrl(null);
      return undefined;
    }
    let cancelled = false;
    if (window.api?.readMediaFile) {
      void window.api
        .readMediaFile(playingPath)
        .then((buf) => {
          const mime = mediaMime(playingPath);
          const url = URL.createObjectURL(
            new Blob([buf], { type: mime.startsWith('audio/') ? mime : 'audio/wav' }),
          );
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          setPlayUrl(url);
        })
        .catch(() => {
          if (!cancelled) setPlayUrl(toAssetUrl(playingPath));
        });
    } else {
      setPlayUrl(toAssetUrl(playingPath));
    }
    return () => {
      cancelled = true;
      setPlayUrl((current) => {
        if (current && current.startsWith('blob:')) URL.revokeObjectURL(current);
        return null;
      });
    };
  }, [playingPath]);

  useEffect(() => {
    if ((d.playing || d.voiceSampleRecording || d.voiceRecording) && playingPath) {
      setPlayingPath(null);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    }
  }, [d.playing, d.voiceSampleRecording, d.voiceRecording, playingPath]);

  const togglePlay = (path: string) => {
    if (playingPath === path) {
      setPlayingPath(null);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    } else {
      if (d.playing) {
        d.togglePlay();
      }
      setPlayingPath(path);
    }
  };

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
      {d.ttsReady && d.voiceSamplePath ? (
        <div className={styles.voCurrentSampleCard}>
          <div className={styles.voCurrentSampleInfo}>
            <span className={styles.voCurrentBadge}>{d.t('video.vo_voice_ready')}</span>
            <span className={styles.voCurrentName} title={d.voiceSamplePath}>
              🎙️ {sampleLabel ?? d.t('video.vo_voice_sample_title')}
              {d.voiceSampleSec ? ` (${d.voiceSampleSec.toFixed(1)}s)` : ''}
            </span>
          </div>
          <button
            type="button"
            className={playingPath === d.voiceSamplePath ? styles.toolPrimary : styles.toolBtn}
            onClick={() => togglePlay(d.voiceSamplePath!)}
            disabled={busy || d.voiceSampleRecording}
            title={d.t(playingPath === d.voiceSamplePath ? 'video.vo_sample_stop' : 'video.vo_sample_play')}
          >
            {playingPath === d.voiceSamplePath
              ? `⏹ ${d.t('video.vo_sample_stop')}`
              : `▶ ${d.t('video.vo_sample_play')}`}
          </button>
        </div>
      ) : d.ttsReady ? (
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

      {audioOptions.length > 0 ? (
        <div className={styles.voSampleLibrary}>
          <h5 className={styles.voSampleLibraryTitle}>
            {d.t('video.vo_sample_list_title')} ({audioOptions.length})
          </h5>
          <p className={styles.hintTight}>{d.t('video.vo_sample_preview_hint')}</p>
          <div className={styles.voSampleList}>
            {audioOptions.map((clip) => {
              const isCurrent = Boolean(
                (d.voiceSampleSourcePath && clip.path === d.voiceSampleSourcePath) ||
                (d.voiceSamplePath && clip.path === d.voiceSamplePath) ||
                (sampleLabel && clip.name === sampleLabel),
              );
              const isPlayingThis = playingPath === clip.path;
              return (
                <div
                  key={clip.path}
                  className={`${styles.voSampleItem} ${isCurrent ? styles.voSampleItemActive : ''}`}
                >
                  <span className={styles.voSampleItemName} title={clip.path}>
                    {clip.name}
                  </span>
                  <div className={styles.voSampleItemActions}>
                    <button
                      type="button"
                      className={isPlayingThis ? styles.toolPrimary : styles.toolBtn}
                      onClick={() => togglePlay(clip.path)}
                      disabled={busy || d.voiceSampleRecording}
                      title={d.t(isPlayingThis ? 'video.vo_sample_stop' : 'video.vo_sample_audition')}
                    >
                      {isPlayingThis
                        ? `⏹ ${d.t('video.vo_sample_stop')}`
                        : `▶ ${d.t('video.vo_sample_audition')}`}
                    </button>
                    {isCurrent ? (
                      <span className={styles.voSampleSelectedBadge}>
                        {d.t('video.vo_sample_current_badge')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={styles.toolBtn}
                        onClick={() => void d.setVoiceSampleFromLibrary(clip.path)}
                        disabled={busy || d.voiceSampleRecording}
                      >
                        {d.t('video.vo_sample_apply')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {d.voiceSampleRecording ? (
        <p className={styles.hintTight}>{d.t('video.vo_voice_sample_recording')}</p>
      ) : null}
      {d.voiceSampleWarning === 'SAMPLE_EMPTY' ? (
        <div className={styles.voSampleAlert}>
          <p className={styles.error}>{d.t('video.vo_sample_empty')}</p>
        </div>
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

      {playUrl ? (
        <audio
          ref={audioRef}
          src={playUrl}
          autoPlay
          onEnded={() => setPlayingPath(null)}
          onError={() => setPlayingPath(null)}
          style={{ display: 'none' }}
        />
      ) : null}
    </div>
  );
}
