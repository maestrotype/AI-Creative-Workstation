import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './VideoPage.module.css';
import { VideoPreviewPane } from './VideoPreviewPane';
import { VideoTimelineCard } from './VideoTimelineCard';

export function FromRecordingPanel({ embedded }: { embedded?: boolean }): ReactNode {
  const { t } = useTranslation();

  const [screencastPath, setScreencastPath] = useState<string | null>(null);
  const [cleanPrompt, setCleanPrompt] = useState(
    'Remove browser chrome, playback controls, and the stop-recording UI at the end',
  );
  const [cleanBusy, setCleanBusy] = useState(false);
  const [cleanError, setCleanError] = useState<string | null>(null);
  const [cleanNotes, setCleanNotes] = useState<string[]>([]);
  const [draftPath, setDraftPath] = useState<string | null>(null);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [pickedPath, setPickedPath] = useState<string | null>(null);

  const handlePickScreencast = async () => {
    if (!window.api?.pickVideo) return;
    const picked = await window.api.pickVideo();
    if (picked) {
      setScreencastPath(picked);
      setCleanError(null);
      setDraftPath(null);
      setSavedTo(null);
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
        setDraftPath(result.file_path);
        setSavedTo(null);
      }
    } catch (err) {
      setCleanError(err instanceof Error ? err.message : String(err));
    } finally {
      setCleanBusy(false);
    }
  };

  const previewPath = draftPath ?? pickedPath ?? screencastPath;
  const canSaveDraft = Boolean(draftPath);

  return (
    <>
      {embedded ? null : (
      <ol className={styles.howto}>
        <li>{t('video.rec_step_1')}</li>
        <li>{t('video.rec_step_2')}</li>
        <li>{t('video.rec_step_3')}</li>
      </ol>
      )}
      <div className={styles.split}>
        <div className={styles.workCol}>
          <section className={styles.card}>
            <h2 className={styles.subtitle}>{t('video.clean_title')}</h2>
            <p className={styles.lead}>{t('video.clean_lead')}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={() => { void handlePickScreencast(); }} disabled={cleanBusy}>
                {t('video.clean_choose')}
              </button>
            </div>
            <label className={styles.label} htmlFor="clean-prompt">{t('video.clean_prompt')}</label>
            <textarea
              id="clean-prompt"
              className={styles.textarea}
              rows={3}
              value={cleanPrompt}
              onChange={(e) => setCleanPrompt(e.target.value)}
              placeholder={t('video.clean_prompt_placeholder')}
              disabled={cleanBusy}
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
          </section>
        </div>
        <div className={styles.previewCol}>
          <VideoPreviewPane
            filePath={previewPath}
            savedTo={savedTo}
            allowSave={canSaveDraft}
            onSaveAs={() => {
              if (!draftPath || !window.api?.saveVideoAs) return;
              void window.api.saveVideoAs(draftPath).then((dest) => { if (dest) setSavedTo(dest); });
            }}
            onDiscard={() => {
              if (draftPath) void window.api?.discardVideoDraft?.(draftPath);
              setDraftPath(null);
              setSavedTo(null);
            }}
          />
          <VideoTimelineCard
            videoPath={previewPath}
            initialPrompt={'at 0:05 add captured audio\nна 0:20 озвучка: Привет, это мой ролик'}
            showPickVideo
            hidePath
            onPickedVideo={(path) => { setPickedPath(path); }}
          />
        </div>
      </div>
    </>
  );
}
