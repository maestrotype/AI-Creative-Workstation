import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { WorkspaceFlow } from '../../studio/ui/WorkspaceFlow';
import { useMediaLibraryStore } from '../store/mediaLibraryStore';
import ui from '../../video/ui/VideoPage.module.css';
import styles from './AssetsPage.module.css';

type AudioFormat = 'wav' | 'mp3' | 'flac';

export function AssetsPage(): ReactNode {
  const { t } = useTranslation();
  const audioClips = useMediaLibraryStore((s) => s.audioClips);
  const voicePath = useMediaLibraryStore((s) => s.voicePath);
  const selectedAudioPath = useMediaLibraryStore((s) => s.selectedAudioPath);
  const loadLibrary = useMediaLibraryStore((s) => s.loadLibrary);
  const setSelectedAudioPath = useMediaLibraryStore((s) => s.setSelectedAudioPath);

  const [format, setFormat] = useState<AudioFormat>('wav');
  const [recording, setRecording] = useState<'idle' | 'mic' | 'system'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ttsReady, setTtsReady] = useState(false);
  const [voiceText, setVoiceText] = useState('');
  const systemStopRef = useRef<(() => void) | null>(null);

  const rememberPath = async (filePath: string) => {
    setSelectedAudioPath(filePath);
    await loadLibrary();
    setSelectedAudioPath(filePath);
  };

  const refreshVoiceEngine = async () => {
    if (!window.api?.getVoiceProfile) return;
    const profile = await window.api.getVoiceProfile();
    setTtsReady(profile.tts_ready);
  };

  useEffect(() => {
    void loadLibrary();
    void refreshVoiceEngine();
  }, [loadLibrary]);

  const handleSystemRecord = async () => {
    if (!window.api?.saveAudioBuffer) return;
    setError(null);
    setRecording('system');
    try {
      const data = await new Promise<ArrayBuffer>((resolve, reject) => {
        void (async () => {
          try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            const audioTracks = stream.getAudioTracks();
            stream.getVideoTracks().forEach((track) => track.stop());
            if (audioTracks.length === 0) {
              stream.getTracks().forEach((track) => track.stop());
              reject(new Error('NO_SYSTEM_AUDIO'));
              return;
            }
            const audioStream = new MediaStream(audioTracks);
            const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
              ? 'audio/webm;codecs=opus'
              : 'audio/webm';
            const recorder = new MediaRecorder(audioStream, { mimeType: mime });
            const chunks: Blob[] = [];
            recorder.ondataavailable = (event) => {
              if (event.data.size > 0) chunks.push(event.data);
            };
            recorder.onstop = () => {
              stream.getTracks().forEach((track) => track.stop());
              void new Blob(chunks, { type: mime }).arrayBuffer().then(resolve).catch(reject);
            };
            recorder.onerror = () => reject(new Error('Recorder failed'));
            systemStopRef.current = () => {
              if (recorder.state !== 'inactive') recorder.stop();
            };
            recorder.start(250);
          } catch (err) {
            reject(err);
          }
        })();
      });
      const saved = await window.api.saveAudioBuffer({ data, format, name: `system-${Date.now()}` });
      await rememberPath(saved.file_path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg === 'NO_SYSTEM_AUDIO' ? t('assets.audio_no_loopback') : msg);
    } finally {
      systemStopRef.current = null;
      setRecording('idle');
    }
  };

  const handleMic = async () => {
    if (recording === 'mic') {
      try {
        const stopped = await window.api.stopMicRecord();
        await rememberPath(stopped.file_path);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRecording('idle');
      }
      return;
    }
    setError(null);
    try {
      await window.api.startMicRecord(format);
      setRecording('mic');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveVoice = async () => {
    setError(null);
    setBusy(true);
    try {
      await window.api.startMicRecord('wav');
      setRecording('mic');
      await new Promise((r) => setTimeout(r, 10_000));
      const stopped = await window.api.stopMicRecord();
      setRecording('idle');
      await window.api.saveVoiceSample(stopped.file_path);
      await rememberPath(stopped.file_path);
      await loadLibrary();
      await refreshVoiceEngine();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRecording('idle');
    } finally {
      setBusy(false);
    }
  };

  const handleTts = async () => {
    if (!voiceText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.api.synthesizeVoice({ text: voiceText.trim() });
      await rememberPath(result.file_path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={ui.container}>
      <header className={ui.header}>
        <div>
          <h1 className={ui.title}>{t('assets.title')}</h1>
          <p className={ui.lead}>{t('assets.lead')}</p>
        </div>
      </header>

      <WorkspaceFlow kind="assets" />

      <section className={ui.card}>
        <h2 className={ui.subtitle}>{t('assets.capture_title')}</h2>
        <p className={ui.lead}>{t('assets.capture_lead')}</p>
        <div className={ui.pills}>
          {(['wav', 'mp3', 'flac'] as const).map((fmt) => (
            <button key={fmt} type="button" className={ui.pill} data-on={format === fmt} onClick={() => setFormat(fmt)}>
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>
        <div className={ui.actions}>
          {recording === 'system' ? (
            <button type="button" className={ui.primary} onClick={() => systemStopRef.current?.()}>{t('assets.audio_stop')}</button>
          ) : (
            <button type="button" className={ui.primary} onClick={() => { void handleSystemRecord(); }} disabled={recording !== 'idle'}>
              {t('assets.audio_record_system')}
            </button>
          )}
          <button type="button" className={ui.secondary} onClick={() => { void handleMic(); }} disabled={recording === 'system'}>
            {recording === 'mic' ? t('assets.audio_stop') : t('assets.audio_record_mic')}
          </button>
          <button
            type="button"
            className={ui.secondary}
            onClick={() => {
              void window.api.pickAudio().then((p) => {
                if (p) void rememberPath(p);
              });
            }}
            disabled={recording !== 'idle'}
          >
            {t('assets.audio_pick')}
          </button>
        </div>
      </section>

      <section className={ui.card}>
        <h2 className={ui.subtitle}>{t('assets.voice_title')}</h2>
        <p className={ui.lead}>{t('assets.voice_lead')}</p>
        <p className={ui.output}>
          {voicePath ? t('assets.voice_saved') : t('assets.voice_missing')}
          {ttsReady ? ` · ${t('assets.voice_tts_ready')}` : ` · ${t('assets.voice_tts_missing')}`}
        </p>
        <div className={ui.actions}>
          <button type="button" className={ui.secondary} onClick={() => { void handleSaveVoice(); }} disabled={busy || recording !== 'idle'}>
            {t('assets.voice_record')}
          </button>
        </div>
        <label className={ui.label} htmlFor="voice-tts">{t('assets.voice_prompt')}</label>
        <textarea
          id="voice-tts"
          className={ui.textarea}
          rows={2}
          value={voiceText}
          onChange={(e) => setVoiceText(e.target.value)}
          placeholder={t('assets.voice_prompt_placeholder')}
        />
        <button type="button" className={ui.primary} onClick={() => { void handleTts(); }} disabled={busy || !voiceText.trim()}>
          {t('assets.voice_generate')}
        </button>
      </section>

      <section className={ui.card}>
        <h2 className={ui.subtitle}>{t('assets.library_title')}</h2>
        {audioClips.length === 0 ? (
          <p className={ui.output}>{t('assets.empty_library')}</p>
        ) : (
          <ul className={styles.clipList}>
            {audioClips.map((clip) => (
              <li
                key={clip.path}
                className={styles.clip}
                data-on={clip.path === selectedAudioPath}
              >
                <button type="button" className={styles.clipName} onClick={() => setSelectedAudioPath(clip.path)}>
                  {clip.name}
                </button>
                <button
                  type="button"
                  className={ui.link}
                  onClick={() => { void window.api.openPath(clip.path); }}
                >
                  {t('assets.open')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {busy ? <p className={ui.progress}>{t('assets.working')}</p> : null}
      {error ? <p className={ui.error}>{error}</p> : null}
    </div>
  );
}
