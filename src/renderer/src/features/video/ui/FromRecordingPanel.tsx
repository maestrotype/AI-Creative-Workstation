import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useMediaLibraryStore } from '../../assets/store/mediaLibraryStore';
import styles from './VideoPage.module.css';

export function FromRecordingPanel(): ReactNode {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const audioClips = useMediaLibraryStore((s) => s.audioClips);
  const selectedAudioPath = useMediaLibraryStore((s) => s.selectedAudioPath);
  const loadLibrary = useMediaLibraryStore((s) => s.loadLibrary);
  const setSelectedAudioPath = useMediaLibraryStore((s) => s.setSelectedAudioPath);

  const [screencastPath, setScreencastPath] = useState<string | null>(null);
  const [cleanPrompt, setCleanPrompt] = useState(
    'Remove browser chrome, playback controls, and the stop-recording UI at the end',
  );
  const [cleanBusy, setCleanBusy] = useState(false);
  const [cleanError, setCleanError] = useState<string | null>(null);
  const [cleanNotes, setCleanNotes] = useState<string[]>([]);
  const [cleanOutput, setCleanOutput] = useState<string | null>(null);

  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [timelinePrompt, setTimelinePrompt] = useState(
    'at 0:05 add captured audio\nна 0:20 озвучка: Привет, это мой ролик',
  );
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const handlePickScreencast = async () => {
    if (!window.api?.pickVideo) return;
    const picked = await window.api.pickVideo();
    if (picked) {
      setScreencastPath(picked);
      setCleanError(null);
      setCleanOutput(null);
    }
  };

  const handleCleanPlan = async (dryRun: boolean) => {
    if (!screencastPath || !window.api?.cleanScreencast) {
      setCleanError(t('video.clean_no_file'));
      return;
    }
    setCleanBusy(true);
    setCleanError(null);
    try {
      const result = await window.api.cleanScreencast({
        input_path: screencastPath,
        prompt: cleanPrompt,
        dry_run: dryRun,
      });
      setCleanNotes(result.plan?.notes ?? []);
      if (!dryRun && result.file_path) {
        setCleanOutput(result.file_path);
        setVideoPath(result.file_path);
      }
    } catch (err) {
      setCleanError(err instanceof Error ? err.message : String(err));
    } finally {
      setCleanBusy(false);
    }
  };

  const handleTimeline = async (dryRun: boolean) => {
    const mixVideo = videoPath ?? cleanOutput ?? screencastPath;
    setBusy(true);
    setError(null);
    try {
      const result = await window.api.applyVideoTimeline({
        prompt: timelinePrompt,
        video_path: mixVideo ?? undefined,
        audio_path: selectedAudioPath ?? undefined,
        dry_run: dryRun,
      });
      setNotes(result.plan?.notes ?? []);
      if (!dryRun && result.file_path) setOutput(result.file_path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const mixVideo = videoPath ?? cleanOutput ?? screencastPath;
  const trackOptions =
    selectedAudioPath && !audioClips.some((c) => c.path === selectedAudioPath)
      ? [{ path: selectedAudioPath, name: selectedAudioPath.split('/').pop() ?? selectedAudioPath }, ...audioClips]
      : audioClips;

  return (
    <>
      <section className={styles.card}>
        <h2 className={styles.subtitle}>{t('video.clean_title')}</h2>
        <p className={styles.lead}>{t('video.clean_lead')}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => { void handlePickScreencast(); }} disabled={cleanBusy}>
            {t('video.clean_choose')}
          </button>
        </div>
        {screencastPath ? <p className={styles.output}>{screencastPath}</p> : null}
        <label className={styles.label} htmlFor="clean-prompt">{t('video.clean_prompt')}</label>
        <textarea
          id="clean-prompt"
          className={styles.textarea}
          rows={3}
          value={cleanPrompt}
          onChange={(e) => setCleanPrompt(e.target.value)}
          placeholder={t('video.clean_prompt_placeholder')}
        />
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => { void handleCleanPlan(true); }} disabled={cleanBusy || !screencastPath}>
            {t('video.clean_preview')}
          </button>
          <button type="button" className={styles.primary} onClick={() => { void handleCleanPlan(false); }} disabled={cleanBusy || !screencastPath}>
            {t('video.clean_run')}
          </button>
        </div>
        {cleanBusy ? <p className={styles.progress}>{t('video.clean_working')}</p> : null}
        {cleanError ? <p className={styles.error}>{cleanError}</p> : null}
        {cleanNotes.length > 0 ? (
          <ul className={styles.notes}>
            {cleanNotes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        ) : null}
        {cleanOutput ? (
          <p className={styles.output}>
            {t('video.saved')}{' '}
            <button type="button" className={styles.link} onClick={() => { void window.api.openPath(cleanOutput); }}>
              {cleanOutput}
            </button>
          </p>
        ) : null}
      </section>

      <section className={styles.card}>
        <h2 className={styles.subtitle}>{t('video.timeline_title')}</h2>
        <p className={styles.lead}>{t('video.timeline_lead')}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              void window.api.pickVideo().then((p) => {
                if (p) setVideoPath(p);
              });
            }}
          >
            {t('video.timeline_pick_video')}
          </button>
          <button type="button" className={styles.secondary} onClick={() => navigate('/assets')}>
            {t('video.go_assets')}
          </button>
        </div>
        {mixVideo ? <p className={styles.output}>{mixVideo}</p> : null}
        <label className={styles.label} htmlFor="library-track">{t('video.use_library_track')}</label>
        {trackOptions.length === 0 ? (
          <p className={styles.output}>{t('video.no_library_audio')}</p>
        ) : (
          <select
            id="library-track"
            className={styles.select}
            value={selectedAudioPath ?? ''}
            onChange={(e) => setSelectedAudioPath(e.target.value || null)}
          >
            {trackOptions.map((clip) => (
              <option key={clip.path} value={clip.path}>{clip.name}</option>
            ))}
          </select>
        )}
        <label className={styles.label} htmlFor="timeline-prompt">{t('video.timeline_prompt')}</label>
        <textarea
          id="timeline-prompt"
          className={styles.textarea}
          rows={4}
          value={timelinePrompt}
          onChange={(e) => setTimelinePrompt(e.target.value)}
          placeholder={t('video.timeline_placeholder')}
        />
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => { void handleTimeline(true); }} disabled={busy}>
            {t('video.clean_preview')}
          </button>
          <button type="button" className={styles.primary} onClick={() => { void handleTimeline(false); }} disabled={busy || !mixVideo}>
            {t('video.timeline_apply')}
          </button>
        </div>
        {busy ? <p className={styles.progress}>{t('video.timeline_working')}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
        {notes.length > 0 ? (
          <ul className={styles.notes}>
            {notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        ) : null}
        {output ? (
          <p className={styles.output}>
            {t('video.saved')}{' '}
            <button type="button" className={styles.link} onClick={() => { void window.api.openPath(output); }}>{output}</button>
          </p>
        ) : null}
      </section>
    </>
  );
}
