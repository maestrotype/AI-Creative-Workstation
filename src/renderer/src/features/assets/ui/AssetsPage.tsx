import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { WorkspaceFlow } from '../../studio/ui/WorkspaceFlow';
import { useMediaLibraryStore } from '../store/mediaLibraryStore';
import { mediaMime } from '../../video/model/directorMedia';
import ui from '../../video/ui/VideoPage.module.css';
import styles from './AssetsPage.module.css';

type AudioFormat = 'wav' | 'mp3' | 'flac';

type VoiceJob = {
  kind: 'tts' | 'sample' | 'record_sample';
  percent: number;
  stage: string;
  detail: string;
  elapsedSec: number;
};

function ipcMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').trim();
}

function pickRecorderMime(): string | undefined {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime));
}

function startRecorder(stream: MediaStream): MediaRecorder {
  // Chromium refuses MediaRecorder.start() if video tracks were already stopped
  // on a getDisplayMedia stream. Keep the dummy video track until stop().
  const mime = pickRecorderMime();
  const attempts: Array<MediaRecorderOptions | undefined> = mime
    ? [{ mimeType: mime }, undefined]
    : [undefined];
  let last: unknown;
  for (const opts of attempts) {
    try {
      const recorder = opts ? new MediaRecorder(stream, opts) : new MediaRecorder(stream);
      recorder.start(250);
      return recorder;
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error('MediaRecorder start failed');
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s} с`;
}

function VoiceProgressPanel({ job, t }: { job: VoiceJob; t: (key: string, opts?: Record<string, string | number>) => string }) {
  const label = t(`assets.job_${job.kind}`, { defaultValue: job.stage });
  const stageLabel = job.detail || t(`assets.stage_${job.stage}`, { defaultValue: job.stage });
  return (
    <div className={styles.jobPanel} role="status" aria-live="polite">
      <div className={styles.jobHead}>
        <strong>{label}</strong>
        <span className={styles.jobElapsed}>{formatElapsed(job.elapsedSec)}</span>
      </div>
      <div className={styles.jobTrack}>
        <div className={styles.jobFill} style={{ width: `${Math.min(100, Math.max(4, job.percent))}%` }} />
      </div>
      <p className={styles.jobDetail}>{stageLabel}</p>
      {job.percent < 30 && job.kind === 'tts' ? (
        <p className={styles.jobHint}>{t('assets.job_tts_slow_hint')}</p>
      ) : null}
    </div>
  );
}

export function AssetsPage(): ReactNode {
  const { t } = useTranslation();
  const audioClips = useMediaLibraryStore((s) => s.audioClips);
  const voicePath = useMediaLibraryStore((s) => s.voicePath);
  const selectedAudioPath = useMediaLibraryStore((s) => s.selectedAudioPath);
  const loadLibrary = useMediaLibraryStore((s) => s.loadLibrary);
  const setSelectedAudioPath = useMediaLibraryStore((s) => s.setSelectedAudioPath);

  const [format, setFormat] = useState<AudioFormat>('wav');
  const [recording, setRecording] = useState<'idle' | 'mic' | 'system'>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [ttsReady, setTtsReady] = useState(false);
  const [ttsEngine, setTtsEngine] = useState<string>('none');
  const [voiceText, setVoiceText] = useState('');
  const [skipPrepare, setSkipPrepare] = useState(false);
  const [prepareBusy, setPrepareBusy] = useState(false);
  const [prepareResult, setPrepareResult] = useState<{
    normalized: string;
    stressed: string;
    spoken: string;
    warnings: string[];
    stress_available: boolean;
  } | null>(null);
  const [fixPrompt, setFixPrompt] = useState('');
  const [fixHint, setFixHint] = useState<string | null>(null);
  const [lexiconEntries, setLexiconEntries] = useState<Array<{
    word: string;
    spoken: string;
    stress?: string;
    note?: string;
  }>>([]);
  const [voiceSourcePath, setVoiceSourcePath] = useState<string | null>(null);
  const [voiceSourceName, setVoiceSourceName] = useState<string | null>(null);
  const [samplePick, setSamplePick] = useState('');
  const [job, setJob] = useState<VoiceJob | null>(null);
  const [libDrop, setLibDrop] = useState(false);
  const [playingPath, setPlayingPath] = useState<string | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const systemStopRef = useRef<(() => void) | null>(null);
  const jobTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearJobTimers = () => {
    if (jobTimerRef.current) {
      clearInterval(jobTimerRef.current);
      jobTimerRef.current = null;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const rememberPath = async (filePath: string) => {
    setSelectedAudioPath(filePath);
    await loadLibrary();
    setSelectedAudioPath(filePath);
  };

  const refreshVoiceEngine = async () => {
    if (!window.api?.getVoiceProfile) return;
    const profile = await window.api.getVoiceProfile();
    setTtsReady(profile.tts_ready);
    setTtsEngine(profile.engine ?? 'none');
    setVoiceSourcePath(profile.source_path ?? null);
    setVoiceSourceName(profile.source_name ?? null);
    if (profile.source_path) setSamplePick(profile.source_path);
  };

  const refreshLexicon = async () => {
    if (!window.api?.getVoiceLexicon) return;
    try {
      const data = await window.api.getVoiceLexicon();
      setLexiconEntries(data.entries ?? []);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void loadLibrary();
    void refreshVoiceEngine();
    void refreshLexicon();
    return () => clearJobTimers();
  }, [loadLibrary]);

  useEffect(() => {
    setPrepareResult(null);
  }, [voiceText]);

  const startElapsedTimer = (kind: VoiceJob['kind'], stage: string, detail: string, percent = 5) => {
    const started = Date.now();
    setJob({ kind, percent, stage, detail, elapsedSec: 0 });
    jobTimerRef.current = setInterval(() => {
      const elapsedSec = (Date.now() - started) / 1000;
      setJob((prev) => (prev ? { ...prev, elapsedSec } : prev));
    }, 1000);
  };

  const startTtsPoll = () => {
    pollRef.current = setInterval(() => {
      void window.api?.getVoiceTtsProgress?.().then((p) => {
        if (!p) return;
        setJob((prev) => {
          if (!prev || prev.kind !== 'tts') return prev;
          return {
            ...prev,
            percent: p.percent,
            stage: p.stage,
            detail: p.detail || prev.detail,
            elapsedSec: p.elapsed_sec,
          };
        });
      }).catch(() => {
        /* ignore poll errors */
      });
    }, 600);
  };

  const handleSystemRecord = async () => {
    if (!window.api?.saveAudioBuffer) return;
    setCaptureError(null);
    setRecording('system');
    try {
      const data = await new Promise<ArrayBuffer>((resolve, reject) => {
        void (async () => {
          try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: true,
            });
            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length === 0) {
              stream.getTracks().forEach((track) => track.stop());
              reject(new Error('NO_SYSTEM_AUDIO'));
              return;
            }
            // Keep video tracks alive: stopping them before start() throws
            // "Failed to execute 'start' on 'MediaRecorder'" in Chromium/Electron.
            const recorder = startRecorder(stream);
            const chunks: Blob[] = [];
            recorder.ondataavailable = (event) => {
              if (event.data.size > 0) chunks.push(event.data);
            };
            recorder.onstop = () => {
              stream.getTracks().forEach((track) => track.stop());
              const type = recorder.mimeType || 'audio/webm';
              void new Blob(chunks, { type }).arrayBuffer().then(resolve).catch(reject);
            };
            recorder.onerror = () => reject(new Error('RECORDER_FAILED'));
            systemStopRef.current = () => {
              if (recorder.state !== 'inactive') recorder.stop();
            };
          } catch (err) {
            reject(err);
          }
        })();
      });
      const saved = await window.api.saveAudioBuffer({ data, format, name: `system-${Date.now()}` });
      await rememberPath(saved.file_path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'NO_SYSTEM_AUDIO') {
        setCaptureError(t('assets.audio_no_loopback'));
      } else if (/MediaRecorder|RECORDER_FAILED/i.test(msg)) {
        setCaptureError(t('assets.audio_recorder_fail'));
      } else {
        setCaptureError(ipcMessage(err));
      }
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
        setCaptureError(ipcMessage(err));
      } finally {
        setRecording('idle');
      }
      return;
    }
    setCaptureError(null);
    try {
      await window.api.startMicRecord(format);
      setRecording('mic');
    } catch (err) {
      setCaptureError(ipcMessage(err));
    }
  };

  const applyVoiceSample = async (path: string) => {
    if (!path || !window.api?.saveVoiceSample) return;
    setVoiceError(null);
    setVoiceBusy(true);
    clearJobTimers();
    startElapsedTimer('sample', 'preparing', t('assets.stage_sample_prepare'), 12);
    try {
      await window.api.saveVoiceSample(path);
      await refreshVoiceEngine();
      await loadLibrary();
      setJob((prev) => (prev ? { ...prev, percent: 100, stage: 'done', detail: t('assets.stage_sample_done') } : prev));
    } catch (err) {
      setVoiceError(ipcMessage(err));
    } finally {
      clearJobTimers();
      setVoiceBusy(false);
      setTimeout(() => setJob(null), 1200);
    }
  };

  const handleSaveVoice = async () => {
    setVoiceError(null);
    setVoiceBusy(true);
    clearJobTimers();
    startElapsedTimer('record_sample', 'recording', t('assets.stage_record_sample'), 15);
    try {
      await window.api.startMicRecord('wav');
      setRecording('mic');
      await new Promise((r) => setTimeout(r, 10_000));
      const stopped = await window.api.stopMicRecord();
      setRecording('idle');
      setJob((prev) => (prev ? { ...prev, percent: 55, detail: t('assets.stage_sample_prepare') } : prev));
      await window.api.saveVoiceSample(stopped.file_path);
      await rememberPath(stopped.file_path);
      await loadLibrary();
      await refreshVoiceEngine();
      setJob((prev) => (prev ? { ...prev, percent: 100, stage: 'done', detail: t('assets.stage_sample_done') } : prev));
    } catch (err) {
      setVoiceError(ipcMessage(err));
      setRecording('idle');
    } finally {
      clearJobTimers();
      setVoiceBusy(false);
      setTimeout(() => setJob(null), 1200);
    }
  };

  const handleFixPronunciation = async () => {
    if (!fixPrompt.trim() || !window.api?.fixVoicePronunciation) return;
    setVoiceError(null);
    setFixHint(null);
    setVoiceBusy(true);
    try {
      const result = await window.api.fixVoicePronunciation({
        prompt: fixPrompt.trim(),
        context_text: voiceText.trim() || undefined,
      });
      await refreshLexicon();
      setFixPrompt('');
      if (result.needs_spoken_hint) {
        setFixHint(t('assets.voice_fix_needs_spoken'));
      }
      if (result.prepared) {
        setPrepareResult({
          normalized: result.prepared.normalized,
          stressed: result.prepared.stressed,
          spoken: result.prepared.spoken,
          warnings: [],
          stress_available: true,
        });
      } else if (voiceText.trim()) {
        await handlePrepare();
      }
    } catch (err) {
      setVoiceError(ipcMessage(err));
    } finally {
      setVoiceBusy(false);
    }
  };

  const handleDeleteLexicon = async (word: string) => {
    if (!window.api?.deleteVoiceLexicon) return;
    setVoiceError(null);
    try {
      await window.api.deleteVoiceLexicon(word);
      await refreshLexicon();
      if (voiceText.trim()) await handlePrepare();
    } catch (err) {
      setVoiceError(ipcMessage(err));
    }
  };

  const handlePrepare = async () => {
    if (!voiceText.trim() || !window.api?.prepareVoiceText) return;
    setPrepareBusy(true);
    setVoiceError(null);
    try {
      const result = await window.api.prepareVoiceText({ text: voiceText.trim() });
      setPrepareResult({
        normalized: result.normalized,
        stressed: result.stressed,
        spoken: result.spoken,
        warnings: result.warnings ?? [],
        stress_available: result.stress_available,
      });
    } catch (err) {
      setVoiceError(ipcMessage(err));
      setPrepareResult(null);
    } finally {
      setPrepareBusy(false);
    }
  };

  const handleTts = async () => {
    if (!voiceText.trim() || !ttsReady || !voicePath) return;
    setVoiceBusy(true);
    setVoiceError(null);
    clearJobTimers();
    startElapsedTimer('tts', 'starting', t('assets.stage_tts_start'), 5);
    startTtsPoll();
    try {
      const result = await window.api.synthesizeVoice({
        text: voiceText.trim(),
        skip_prepare: skipPrepare,
        prepared_text: !skipPrepare && prepareResult ? prepareResult.spoken : undefined,
      });
      setJob((prev) => (prev ? { ...prev, percent: 100, stage: 'done', detail: t('assets.stage_tts_done') } : prev));
      await rememberPath(result.file_path);
    } catch (err) {
      const msg = ipcMessage(err);
      setVoiceError(msg.includes('CLONE_ENGINE_MISSING') ? t('assets.voice_clone_missing') : msg);
    } finally {
      clearJobTimers();
      setVoiceBusy(false);
      setTimeout(() => setJob(null), 1500);
    }
  };

  const handleImportLibrary = async (paths?: string[]) => {
    if (!window.api?.importLibraryAudio) return;
    setCaptureError(null);
    try {
      const result = await window.api.importLibraryAudio(paths);
      if (result.imported[0]) await rememberPath(result.imported[0]);
      else await loadLibrary();
    } catch (err) {
      setCaptureError(ipcMessage(err));
    }
  };

  const handleDeleteLibrary = async (filePath: string) => {
    if (!window.api?.deleteLibraryAudio) return;
    setCaptureError(null);
    try {
      await window.api.deleteLibraryAudio(filePath);
      if (selectedAudioPath === filePath) setSelectedAudioPath(null);
      if (voiceSourcePath === filePath) {
        setVoiceSourcePath(null);
        setVoiceSourceName(null);
      }
      await loadLibrary();
      await refreshVoiceEngine();
    } catch (err) {
      setCaptureError(ipcMessage(err));
    }
  };

  const importDropped = async (files: FileList) => {
    const paths: string[] = [];
    for (const file of Array.from(files)) {
      let diskPath = '';
      try {
        diskPath = window.api?.getPathForFile?.(file) ?? '';
      } catch {
        diskPath = '';
      }
      if (!diskPath) {
        const legacy = (file as File & { path?: string }).path;
        if (legacy) diskPath = legacy;
      }
      if (diskPath) paths.push(diskPath);
    }
    if (paths.length === 0) {
      setCaptureError(t('assets.library_drop_fail'));
      return;
    }
    await handleImportLibrary(paths);
  };

  const playClip = async (path: string) => {
    setCaptureError(null);
    let target = path;
    try {
      if (window.api?.prepareLibraryAudio) {
        const prepared = await window.api.prepareLibraryAudio(path);
        target = prepared.path;
        if (prepared.converted) await loadLibrary();
      }
    } catch (err) {
      setCaptureError(ipcMessage(err));
      return;
    }
    setSelectedAudioPath(target);
    setPlayingPath(target);
  };

  useEffect(() => {
    if (!playingPath || !window.api?.readMediaFile) {
      setPlayUrl(null);
      return undefined;
    }
    let cancelled = false;
    void window.api.readMediaFile(playingPath).then((buf) => {
      const mime = mediaMime(playingPath);
      const url = URL.createObjectURL(new Blob([buf], { type: mime.startsWith('audio/') ? mime : 'audio/ogg' }));
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      setPlayUrl(url);
    }).catch((err) => {
      if (!cancelled) {
        setCaptureError(ipcMessage(err));
        setPlayingPath(null);
      }
    });
    return () => {
      cancelled = true;
      setPlayUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
    };
  }, [playingPath]);

  const sampleLabel = voiceSourceName ?? (voicePath ? t('assets.voice_sample_default') : null);
  const canPrepare = voiceText.trim().length > 0 && !voiceBusy && !prepareBusy && recording === 'idle';
  const canGenerate = ttsReady && voicePath && voiceText.trim().length > 0 && !voiceBusy && recording === 'idle';

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
            <button type="button" className={ui.primary} onClick={() => { void handleSystemRecord(); }} disabled={recording !== 'idle' || voiceBusy}>
              {t('assets.audio_record_system')}
            </button>
          )}
          <button type="button" className={ui.secondary} onClick={() => { void handleMic(); }} disabled={recording === 'system' || voiceBusy}>
            {recording === 'mic' ? t('assets.audio_stop') : t('assets.audio_record_mic')}
          </button>
          <button
            type="button"
            className={ui.secondary}
            onClick={() => { void handleImportLibrary(); }}
            disabled={recording !== 'idle' || voiceBusy}
          >
            {t('assets.audio_pick')}
          </button>
        </div>
        {captureError ? <p className={ui.error}>{captureError}</p> : null}
      </section>

      <section className={ui.card}>
        <h2 className={ui.subtitle}>{t('assets.voice_title')}</h2>
        <p className={ui.lead}>{t('assets.voice_lead')}</p>
        <p className={ui.output}>
          {ttsEngine === 'xtts' ? t('assets.voice_tts_xtts') : t('assets.voice_tts_missing')}
        </p>
        {ttsEngine !== 'xtts' ? (
          <p className={ui.hint}>
            {t('assets.voice_install_studio')}{' '}
            <Link to="/studio?family=voice">{t('assets.voice_install_studio_link')}</Link>
          </p>
        ) : null}

        <div className={styles.sampleBox}>
          <span className={styles.sampleLabel}>{t('assets.voice_sample_label')}</span>
          {sampleLabel ? (
            <p className={styles.sampleCurrent}>
              <strong>{sampleLabel}</strong>
              {voiceSourcePath ? (
                <button type="button" className={ui.link} onClick={() => { void playClip(voiceSourcePath); }}>
                  {t('assets.library_play')}
                </button>
              ) : null}
            </p>
          ) : (
            <p className={styles.sampleMissing}>{t('assets.voice_sample_none')}</p>
          )}
          {audioClips.length > 0 ? (
            <div className={styles.samplePickRow}>
              <select
                className={styles.sampleSelect}
                value={samplePick}
                onChange={(e) => setSamplePick(e.target.value)}
                disabled={voiceBusy || recording !== 'idle'}
              >
                <option value="">{t('assets.voice_sample_pick')}</option>
                {audioClips.map((clip) => (
                  <option key={clip.path} value={clip.path}>{clip.name}</option>
                ))}
              </select>
              <button
                type="button"
                className={ui.secondary}
                disabled={!samplePick || voiceBusy || recording !== 'idle'}
                onClick={() => { void applyVoiceSample(samplePick); }}
              >
                {t('assets.voice_sample_apply')}
              </button>
            </div>
          ) : null}
          <p className={styles.sampleHint}>{t('assets.voice_sample_hint')}</p>
        </div>

        {job ? <VoiceProgressPanel job={job} t={t} /> : null}
        {voiceError ? <p className={ui.error}>{voiceError}</p> : null}

        <div className={ui.actions}>
          <button type="button" className={ui.secondary} onClick={() => { void handleSaveVoice(); }} disabled={voiceBusy || recording !== 'idle'}>
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
          disabled={voiceBusy}
        />
        <label className={styles.prepareSkip}>
          <input
            type="checkbox"
            checked={skipPrepare}
            onChange={(e) => setSkipPrepare(e.target.checked)}
            disabled={voiceBusy}
          />
          {t('assets.voice_skip_prepare')}
        </label>
        <div className={ui.actions}>
          <button
            type="button"
            className={ui.secondary}
            onClick={() => { void handlePrepare(); }}
            disabled={!canPrepare}
          >
            {prepareBusy ? t('assets.voice_prepare_busy') : t('assets.voice_prepare')}
          </button>
        </div>
        {prepareResult && !skipPrepare ? (
          <div className={styles.prepareBox}>
            {prepareResult.normalized !== voiceText.trim() ? (
              <div className={styles.prepareRow}>
                <span className={styles.prepareLabel}>{t('assets.voice_prepare_normalized')}</span>
                <p className={styles.prepareText}>{prepareResult.normalized}</p>
              </div>
            ) : null}
            <div className={styles.prepareRow}>
              <span className={styles.prepareLabel}>{t('assets.voice_prepare_spoken')}</span>
              <p className={styles.prepareText}>{prepareResult.spoken}</p>
            </div>
            {prepareResult.stress_available && prepareResult.stressed !== prepareResult.spoken ? (
              <div className={styles.prepareRow}>
                <span className={styles.prepareLabel}>{t('assets.voice_prepare_stressed')}</span>
                <p className={styles.prepareText}>{prepareResult.stressed}</p>
                <p className={styles.prepareWarn}>{t('assets.voice_prepare_stress_hint')}</p>
              </div>
            ) : null}
            {!prepareResult.stress_available ? (
              <p className={styles.prepareWarn}>{t('assets.voice_prepare_no_stress')}</p>
            ) : null}
            {prepareResult.warnings.length > 0 ? (
              <p className={styles.prepareWarn}>{prepareResult.warnings.join(' · ')}</p>
            ) : null}
          </div>
        ) : null}
        <div className={styles.fixBox}>
          <label className={ui.label} htmlFor="voice-fix">{t('assets.voice_fix_label')}</label>
          <textarea
            id="voice-fix"
            className={ui.textarea}
            rows={2}
            value={fixPrompt}
            onChange={(e) => setFixPrompt(e.target.value)}
            placeholder={t('assets.voice_fix_placeholder')}
            disabled={voiceBusy}
          />
          <div className={ui.actions}>
            <button
              type="button"
              className={ui.secondary}
              onClick={() => { void handleFixPronunciation(); }}
              disabled={!fixPrompt.trim() || voiceBusy || recording !== 'idle'}
            >
              {t('assets.voice_fix_apply')}
            </button>
          </div>
          <p className={styles.prepareWarn}>{t('assets.voice_fix_help')}</p>
          {fixHint ? <p className={styles.prepareWarn}>{fixHint}</p> : null}
        </div>
        {lexiconEntries.length > 0 ? (
          <div className={styles.lexiconBox}>
            <span className={styles.sampleLabel}>{t('assets.voice_lexicon_title')}</span>
            <ul className={styles.lexiconList}>
              {lexiconEntries.map((entry) => (
                <li key={entry.word} className={styles.lexiconItem}>
                  <span className={styles.lexiconWord}>{entry.word}</span>
                  <span className={styles.lexiconSpoken}>→ {entry.spoken}</span>
                  <button
                    type="button"
                    className={styles.clipDelete}
                    onClick={() => { void handleDeleteLexicon(entry.word); }}
                    disabled={voiceBusy}
                  >
                    {t('assets.library_delete')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {canGenerate && sampleLabel ? (
          <p className={styles.generateHint}>{t('assets.voice_generate_as', { name: sampleLabel })}</p>
        ) : null}
        <div className={ui.actions}>
          <button
            type="button"
            className={ui.primary}
            onClick={() => { void handleMic(); }}
            disabled={voiceBusy || recording === 'system'}
          >
            {recording === 'mic' ? t('assets.audio_stop') : t('assets.voice_record_line')}
          </button>
          <button
            type="button"
            className={ui.secondary}
            onClick={() => { void handleTts(); }}
            disabled={!canGenerate}
          >
            {voiceBusy && job?.kind === 'tts' ? t('assets.voice_generating') : t('assets.voice_generate')}
          </button>
        </div>
      </section>

      <section
        className={`${ui.card} ${libDrop ? styles.libraryDropOn : ''}`}
        onDragOver={(event) => {
          if (!Array.from(event.dataTransfer.types).includes('Files')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setLibDrop(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node)) return;
          setLibDrop(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setLibDrop(false);
          if (event.dataTransfer.files.length > 0) {
            void importDropped(event.dataTransfer.files);
          }
        }}
      >
        <div className={styles.libraryHead}>
          <h2 className={ui.subtitle}>{t('assets.library_title')}</h2>
          <button
            type="button"
            className={ui.primary}
            onClick={() => { void handleImportLibrary(); }}
            disabled={recording !== 'idle' || voiceBusy}
          >
            {t('assets.library_add')}
          </button>
        </div>
        <p className={ui.lead}>{t('assets.library_formats')}</p>
        {audioClips.length === 0 ? (
          <p className={ui.output}>{t('assets.empty_library')}</p>
        ) : (
          <ul className={styles.clipList}>
            {audioClips.map((clip) => (
              <li
                key={clip.path}
                className={styles.clip}
                data-on={clip.path === selectedAudioPath}
                data-voice={clip.path === voiceSourcePath ? 'true' : undefined}
              >
                <button type="button" className={styles.clipName} onClick={() => setSelectedAudioPath(clip.path)}>
                  {clip.name}
                  {clip.path === voiceSourcePath ? (
                    <span className={styles.voiceBadge}>{t('assets.voice_sample_badge')}</span>
                  ) : null}
                </button>
                <div className={styles.clipActions}>
                  <button
                    type="button"
                    className={ui.link}
                    onClick={() => { void playClip(clip.path); }}
                  >
                    {playingPath === clip.path ? t('assets.library_playing') : t('assets.library_play')}
                  </button>
                  <button
                    type="button"
                    className={ui.link}
                    disabled={voiceBusy || clip.path === voiceSourcePath}
                    onClick={() => { void applyVoiceSample(clip.path); }}
                  >
                    {t('assets.voice_sample_use')}
                  </button>
                  <button
                    type="button"
                    className={styles.clipDelete}
                    onClick={() => {
                      if (playingPath === clip.path) setPlayingPath(null);
                      void handleDeleteLibrary(clip.path);
                    }}
                    title={t('assets.library_delete')}
                  >
                    {t('assets.library_delete')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {playingPath && playUrl ? (
          <audio className={styles.player} src={playUrl} controls autoPlay onEnded={() => setPlayingPath(null)} />
        ) : null}
      </section>
    </div>
  );
}
