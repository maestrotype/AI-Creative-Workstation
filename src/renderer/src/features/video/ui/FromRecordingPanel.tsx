import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { fileName } from '../model/directorTimeline';
import styles from './VideoPage.module.css';

export function FromRecordingPanel({
  onProduced,
  embedded,
}: {
  onProduced?: (path: string) => void;
  embedded?: boolean;
}): ReactNode {
  const { t } = useTranslation();

  const [screencastPath, setScreencastPath] = useState<string | null>(null);
  const [cleanPrompt, setCleanPrompt] = useState(
    'Remove browser chrome, playback controls, and the stop-recording UI at the end',
  );
  const [cleanBusy, setCleanBusy] = useState(false);
  const [cleanError, setCleanError] = useState<string | null>(null);
  const [cleanNotes, setCleanNotes] = useState<string[]>([]);
  const [sentName, setSentName] = useState<string | null>(null);

  const handlePickScreencast = async () => {
    if (!window.api?.pickVideo) return;
    const picked = await window.api.pickVideo();
    if (picked) {
      setScreencastPath(picked);
      setCleanError(null);
      setSentName(null);
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
        onProduced?.(result.file_path);
        setSentName(fileName(result.file_path));
      }
    } catch (err) {
      setCleanError(err instanceof Error ? err.message : String(err));
    } finally {
      setCleanBusy(false);
    }
  };

  const handleUseRaw = () => {
    if (!screencastPath) return;
    onProduced?.(screencastPath);
    setSentName(fileName(screencastPath));
  };

  return (
    <>
      {embedded ? null : (
        <ol className={styles.howto}>
          <li>{t('video.rec_step_1')}</li>
          <li>{t('video.rec_step_2')}</li>
          <li>{t('video.rec_step_3')}</li>
        </ol>
      )}
      <section className={styles.card}>
        <h2 className={styles.subtitle}>{t('video.clean_title')}</h2>
        <p className={styles.lead}>{t('video.clean_lead')}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => { void handlePickScreencast(); }} disabled={cleanBusy}>
            {t('video.clean_choose')}
          </button>
          {screencastPath && onProduced ? (
            <button type="button" className={styles.secondary} onClick={handleUseRaw} disabled={cleanBusy}>
              {t('video.rec_use_raw')}
            </button>
          ) : null}
        </div>
        {screencastPath ? <p className={styles.hint}>{fileName(screencastPath)}</p> : null}
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
        {sentName ? <p className={styles.nextHint}>{t('video.rec_sent_to_sources', { name: sentName })}</p> : null}
        {cleanNotes.length > 0 ? (
          <ul className={styles.notes}>
            {cleanNotes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        ) : null}
      </section>
    </>
  );
}
