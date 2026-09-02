import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { fileName } from '../model/directorTimeline';
import {
  formatTimecode,
  type VideoAnalysisContext,
} from '../model/videoAnalysis';
import styles from './VideoPage.module.css';

function ipcMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').trim();
}

export function FromVideoPanel({
  onProduced,
  embedded,
}: {
  onProduced?: (path: string, context?: VideoAnalysisContext) => void;
  embedded?: boolean;
}): ReactNode {
  const { t } = useTranslation();

  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [analyzeBusy, setAnalyzeBusy] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [context, setContext] = useState<VideoAnalysisContext | null>(null);
  const [progress, setProgress] = useState({ stage: '', percent: 0, detail: '' });
  const [sentName, setSentName] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => clearPoll(), []);

  const startPoll = () => {
    clearPoll();
    pollRef.current = setInterval(() => {
      void window.api?.getVideoAnalyzeProgress?.().then((p) => {
        if (!p) return;
        setProgress({
          stage: p.stage,
          percent: p.percent,
          detail: p.detail || p.stage,
        });
      }).catch(() => {
        /* ignore */
      });
    }, 500);
  };

  const handlePick = async () => {
    if (!window.api?.pickVideo) return;
    const picked = await window.api.pickVideo();
    if (picked) {
      setVideoPath(picked);
      setAnalyzeError(null);
      setContext(null);
      setSentName(null);
      if (window.api.getVideoAnalyzeCache) {
        try {
          const cached = await window.api.getVideoAnalyzeCache(picked);
          if (cached.status === 'hit' && cached.context) {
            setContext(cached.context as VideoAnalysisContext);
          }
        } catch {
          /* ignore cache miss */
        }
      }
    }
  };

  const handleAnalyze = async () => {
    if (!videoPath || !window.api?.analyzeVideo) return;
    setAnalyzeBusy(true);
    setAnalyzeError(null);
    setProgress({ stage: 'starting', percent: 3, detail: t('video.vo_analyze_start') });
    startPoll();
    try {
      const result = await window.api.analyzeVideo({
        video_path: videoPath,
        transcribe: true,
        scene_detect: true,
        language: 'auto',
        use_cache: true,
      });
      setContext(result.context as VideoAnalysisContext);
      setProgress({ stage: 'done', percent: 100, detail: t('video.vo_analyze_done') });
    } catch (err) {
      setAnalyzeError(ipcMessage(err));
    } finally {
      clearPoll();
      setAnalyzeBusy(false);
    }
  };

  const handleAddTimeline = () => {
    if (!videoPath) return;
    onProduced?.(videoPath, context ?? undefined);
    setSentName(fileName(videoPath));
  };

  const whisperMissing = context?.warnings?.includes('WHISPER_NOT_INSTALLED');

  return (
    <>
      {embedded ? null : (
        <ol className={styles.howto}>
          <li>{t('video.vo_step_1')}</li>
          <li>{t('video.vo_step_2')}</li>
          <li>{t('video.vo_step_3')}</li>
        </ol>
      )}
      <section className={styles.card}>
        <h2 className={styles.subtitle}>{t('video.vo_title')}</h2>
        <p className={styles.lead}>{t('video.vo_lead')}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => { void handlePick(); }} disabled={analyzeBusy}>
            {t('video.vo_pick')}
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => { void handleAnalyze(); }}
            disabled={!videoPath || analyzeBusy}
          >
            {analyzeBusy ? t('video.vo_analyzing') : t('video.vo_analyze')}
          </button>
          {videoPath && onProduced ? (
            <button type="button" className={styles.secondary} onClick={handleAddTimeline} disabled={analyzeBusy}>
              {t('video.vo_add_timeline')}
            </button>
          ) : null}
        </div>
        {videoPath ? <p className={styles.hint}>{fileName(videoPath)}</p> : null}
        {sentName ? <p className={styles.output}>{t('video.vo_sent', { name: sentName })}</p> : null}
        {analyzeError ? <p className={styles.error}>{analyzeError}</p> : null}

        {analyzeBusy ? (
          <div className={styles.progressBox}>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${Math.max(4, progress.percent)}%` }} />
            </div>
            <p className={styles.hint}>{progress.detail}</p>
          </div>
        ) : null}

        {context ? (
          <div className={styles.analysisBox}>
            <p className={styles.output}>
              {t('video.vo_summary', {
                duration: formatTimecode(context.duration_sec),
                scenes: context.scenes.length,
                words: context.transcript.full_text.split(/\s+/).filter(Boolean).length,
              })}
            </p>
            {whisperMissing ? (
              <p className={styles.hint}>{t('video.vo_whisper_missing')}</p>
            ) : null}
            <h3 className={styles.subtitle}>{t('video.vo_scenes')}</h3>
            <ul className={styles.scenes}>
              {context.scenes.map((scene) => (
                <li key={scene.index}>
                  {formatTimecode(scene.start)} – {formatTimecode(scene.end)}
                </li>
              ))}
            </ul>
            {context.transcript.segments.length > 0 ? (
              <>
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => setShowTranscript((v) => !v)}
                >
                  {showTranscript ? t('video.vo_hide_transcript') : t('video.vo_show_transcript')}
                </button>
                {showTranscript ? (
                  <ul className={styles.transcriptList}>
                    {context.transcript.segments.map((seg, i) => (
                      <li key={`${seg.start}-${i}`}>
                        <span className={styles.ts}>{formatTimecode(seg.start)}</span>
                        {seg.text}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </section>
    </>
  );
}
