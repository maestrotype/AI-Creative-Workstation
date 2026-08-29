import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useMediaLibraryStore } from '../../assets/store/mediaLibraryStore';
import styles from './VideoPage.module.css';

interface VideoTimelineCardProps {
  videoPath: string | null;
  initialPrompt: string;
  showPickVideo?: boolean;
  hidePath?: boolean;
  onPickedVideo?: (path: string) => void;
}

export function VideoTimelineCard({
  videoPath,
  initialPrompt,
  showPickVideo = false,
  hidePath = false,
  onPickedVideo,
}: VideoTimelineCardProps): ReactNode {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const audioClips = useMediaLibraryStore((s) => s.audioClips);
  const selectedAudioPath = useMediaLibraryStore((s) => s.selectedAudioPath);
  const loadLibrary = useMediaLibraryStore((s) => s.loadLibrary);
  const setSelectedAudioPath = useMediaLibraryStore((s) => s.setSelectedAudioPath);

  const [prompt, setPrompt] = useState(initialPrompt);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [voiceReady, setVoiceReady] = useState<{ has_sample: boolean; tts_ready: boolean } | null>(null);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    setPrompt(initialPrompt);
  }, [initialPrompt]);

  useEffect(() => {
    void window.api?.getVoiceProfile?.().then((p) => {
      setVoiceReady({ has_sample: p.has_sample, tts_ready: p.tts_ready });
    }).catch(() => {});
  }, []);

  const handleTimeline = async (dryRun: boolean) => {
    if (!videoPath || !window.api?.applyVideoTimeline) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.api.applyVideoTimeline({
        prompt,
        video_path: videoPath,
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

  const trackOptions =
    selectedAudioPath && !audioClips.some((c) => c.path === selectedAudioPath)
      ? [{ path: selectedAudioPath, name: selectedAudioPath.split('/').pop() ?? selectedAudioPath }, ...audioClips]
      : audioClips;

  return (
    <section className={styles.card}>
      <h2 className={styles.subtitle}>{t('video.timeline_title')}</h2>
      <p className={styles.lead}>{t('video.timeline_lead')}</p>
      {voiceReady && (!voiceReady.has_sample || !voiceReady.tts_ready) ? (
        <p className={styles.output}>{t('video.timeline_voice_hint')}</p>
      ) : null}
      <div className={styles.actions}>
        {showPickVideo ? (
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              void window.api.pickVideo().then((p) => {
                if (p) onPickedVideo?.(p);
              });
            }}
          >
            {t('video.timeline_pick_video')}
          </button>
        ) : null}
        <button type="button" className={styles.secondary} onClick={() => navigate('/assets')}>
          {t('video.go_assets')}
        </button>
      </div>
      {hidePath ? null : videoPath ? <p className={styles.output}>{videoPath}</p> : <p className={styles.output}>{t('video.timeline_need_video')}</p>}
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
        rows={6}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t('video.timeline_placeholder')}
      />
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={() => { void handleTimeline(true); }} disabled={busy || !videoPath}>
          {t('video.clean_preview')}
        </button>
        <button type="button" className={styles.primary} onClick={() => { void handleTimeline(false); }} disabled={busy || !videoPath}>
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
  );
}
