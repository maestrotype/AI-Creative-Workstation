import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { runGeneration, type GenerationProgress } from '../../create/api/generationApi';
import { filePathFromAssetUrl } from '../../studio/store/workspaceBridgeStore';
import {
  estimateStoryboard,
  planYoutubeVideo,
  voiceoverPromptFromPlan,
  type YoutubeFormat,
  type YoutubePlan,
} from '../model/planYoutubeVideo';
import {
  drawnCount as countDrawn,
  loadHistory,
  newDraftId,
  persistHistory,
  removeDraft,
  upsertDraft,
  type VideoDraftRecord,
  type VideoHistoryFile,
} from '../model/videoDraftStore';
import styles from './VideoPage.module.css';
import { VideoPreviewPane } from './VideoPreviewPane';
import { VideoTimelineCard } from './VideoTimelineCard';

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

export function FromIdeaPanel(): ReactNode {
  const { t } = useTranslation();
  const [topic, setTopic] = useState('');
  const [format, setFormat] = useState<YoutubeFormat>('landscape');
  const [durationSec, setDurationSec] = useState(60);
  const [plan, setPlan] = useState<YoutubePlan | null>(null);
  const [busy, setBusy] = useState<'idle' | 'scenes' | 'assemble'>('idle');
  const [progress, setProgress] = useState('');
  const [frameTick, setFrameTick] = useState<GenerationProgress | null>(null);
  const [drawingIndex, setDrawingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [hasImageEngine, setHasImageEngine] = useState<boolean | null>(null);
  const [engineName, setEngineName] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<VideoDraftRecord[]>([]);
  const [diskStills, setDiskStills] = useState<{ path: string; mtime: number }[]>([]);

  const draftIdRef = useRef(newDraftId());
  const historyRef = useRef<VideoHistoryFile>({ savedAt: 0, currentId: '', drafts: [] });

  const estimate = estimateStoryboard(format, durationSec);

  const commit = (
    nextPlan: YoutubePlan | null,
    nextOutput: string | null = outputPath,
    fields?: { topic: string; format: YoutubeFormat; durationSec: number },
  ) => {
    const rec: VideoDraftRecord = {
      id: draftIdRef.current,
      updatedAt: Date.now(),
      topic: fields?.topic ?? topic,
      format: fields?.format ?? format,
      durationSec: fields?.durationSec ?? durationSec,
      plan: nextPlan,
      outputPath: nextOutput,
    };
    historyRef.current = upsertDraft(historyRef.current, rec);
    setDrafts(historyRef.current.drafts);
    void persistHistory(historyRef.current);
  };

  useEffect(() => {
    const boot = async () => {
      const hist = await loadHistory();
      historyRef.current = hist;
      setDrafts(hist.drafts);
      const current = hist.drafts.find((d) => d.id === hist.currentId) ?? hist.drafts[0];
      if (current) {
        draftIdRef.current = current.id;
        setTopic(current.topic);
        setFormat(current.format);
        setDurationSec(current.durationSec);
        setPlan(current.plan);
        setOutputPath(current.outputPath);
        setSavedTo(null);
      }
      try {
        const stills = await window.api.listGeneratedStills();
        setDiskStills(stills);
      } catch {
        setDiskStills([]);
      }
    };
    void boot();
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!window.api) return;
      try {
        const [models, active] = await Promise.all([window.api.getModels(), window.api.getActiveModel()]);
        const ready = models.some((m: { type: string; status: string }) => m.type === 'image' && m.status === 'ready');
        setHasImageEngine(ready);
        const name = models.find((m: { id: string }) => m.id === active)?.name ?? active;
        setEngineName(name);
      } catch {
        setHasImageEngine(false);
      }
    };
    void load();
    return window.api?.onModelsUpdated(() => { void load(); }) ?? (() => {});
  }, []);

  const applyPlan = (nextTopic: string, nextFormat: YoutubeFormat, nextDuration: number) => {
    if (!nextTopic.trim()) return;
    if (plan && countDrawn(plan) > 0) {
      commit(plan, outputPath, { topic: plan.topic, format: plan.format, durationSec: plan.durationSec });
      draftIdRef.current = newDraftId();
    }
    setError(null);
    setOutputPath(null);
    setSavedTo(null);
    const next = planYoutubeVideo(nextTopic, nextFormat, nextDuration);
    setPlan(next);
    commit(next, null, { topic: nextTopic, format: nextFormat, durationSec: nextDuration });
  };

  const handlePlan = () => applyPlan(topic, format, durationSec);

  const handleFormat = (next: YoutubeFormat) => {
    setFormat(next);
    if (plan) applyPlan(topic, next, durationSec);
  };

  const handleDuration = (sec: number) => {
    setDurationSec(sec);
    if (plan) applyPlan(topic, format, sec);
  };

  const handleGenerateScenes = async () => {
    if (!plan || !window.api?.generateImage) return;
    setBusy('scenes');
    setError(null);
    const next = { ...plan, scenes: plan.scenes.map((s) => ({ ...s })) };
    try {
      for (let i = 0; i < next.scenes.length; i += 1) {
        if (next.scenes[i].imagePath) continue;
        setDrawingIndex(i);
        setFrameTick({ progress: 0.02, message: '', estimatedSecondsLeft: 0, elapsedSeconds: 0 });
        setProgress(t('video.generating_scene', { current: i + 1, total: next.scenes.length }));
        const { promise } = runGeneration(
          { prompt: next.scenes[i].prompt, format: next.imageFormat, style: 'cinematic' },
          (tick) => { setFrameTick(tick); },
        );
        const result = await promise;
        const path = filePathFromAssetUrl(result.thumbnailUrl);
        next.scenes[i] = { ...next.scenes[i], imagePath: path };
        setPlan({ ...next });
        commit({ ...next });
      }
      setProgress('');
      setFrameTick(null);
      setDrawingIndex(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('idle');
    }
  };

  const handleAssemble = async () => {
    if (!plan || !window.api?.assembleVideo) return;
    const ready = plan.scenes.filter((s) => s.imagePath);
    if (ready.length !== plan.scenes.length) {
      setError(t('video.need_all_scenes'));
      return;
    }
    setBusy('assemble');
    setError(null);
    setProgress(t('video.assembling'));
    try {
      const slug = plan.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'youtube-video';
      const result = await window.api.assembleVideo({
        image_paths: ready.map((s) => filePathFromAssetUrl(s.imagePath) as string),
        durations: ready.map((s) => s.durationSec),
        width: plan.width,
        height: plan.height,
        output_name: `${slug}-${Date.now()}`,
      });
      setOutputPath(result.file_path);
      setSavedTo(null);
      commit(plan, result.file_path);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, ''));
    } finally {
      setBusy('idle');
      setProgress('');
    }
  };

  const handleRestore = (id: string) => {
    const rec = historyRef.current.drafts.find((d) => d.id === id);
    if (!rec) return;
    draftIdRef.current = rec.id;
    historyRef.current = { ...historyRef.current, currentId: rec.id, savedAt: Date.now() };
    setTopic(rec.topic);
    setFormat(rec.format);
    setDurationSec(rec.durationSec);
    setPlan(rec.plan);
    setOutputPath(rec.outputPath);
    setSavedTo(null);
    setError(null);
    void persistHistory(historyRef.current);
    setDrafts(historyRef.current.drafts);
  };

  const handleSaveAs = async () => {
    if (!outputPath || !window.api?.saveVideoAs) return;
    try {
      const dest = await window.api.saveVideoAs(outputPath);
      if (dest) setSavedTo(dest);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDiscard = async () => {
    if (outputPath) {
      await window.api?.discardVideoDraft?.(outputPath);
    }
    setOutputPath(null);
    setSavedTo(null);
    commit(plan, null);
  };

  const handleDeleteDraft = (id: string) => {
    historyRef.current = removeDraft(historyRef.current, id);
    setDrafts(historyRef.current.drafts);
    if (draftIdRef.current === id) {
      const next = historyRef.current.drafts[0];
      if (next) handleRestore(next.id);
      else {
        draftIdRef.current = newDraftId();
        setPlan(null);
        setOutputPath(null);
        setSavedTo(null);
      }
    }
    void persistHistory(historyRef.current);
  };

  const handleFillFromDisk = () => {
    if (!plan) return;
    const empty = plan.scenes.map((s, i) => (s.imagePath ? -1 : i)).filter((i) => i >= 0);
    if (empty.length === 0) return;
    const newest = [...diskStills].sort((a, b) => a.mtime - b.mtime).slice(-empty.length);
    const next = { ...plan, scenes: plan.scenes.map((s) => ({ ...s })) };
    empty.forEach((sceneIndex, k) => {
      const still = newest[k];
      if (still) next.scenes[sceneIndex] = { ...next.scenes[sceneIndex], imagePath: still.path };
    });
    setPlan(next);
    commit(next);
  };

  const allScenesReady = Boolean(plan && plan.scenes.every((s) => s.imagePath));
  const drawnCount = countDrawn(plan);
  const remaining = plan ? plan.scenes.length - drawnCount : 0;
  const topicDirty = Boolean(plan && topic.trim() !== plan.topic);
  const canFillDisk = Boolean(plan && remaining > 0 && diskStills.length > 0);
  const sceneTitle = (scene: YoutubePlan['scenes'][number]) => {
    if (scene.role === 'hook') return t('video.scene_hook');
    if (scene.role === 'outro') return t('video.scene_outro');
    return t('video.scene_beat', { n: scene.beatIndex });
  };

  const overallPct = plan && drawingIndex != null && frameTick
    ? Math.round(((drawnCount + frameTick.progress) / plan.scenes.length) * 100)
    : plan && plan.scenes.length
      ? Math.round((drawnCount / plan.scenes.length) * 100)
      : 0;

  return (
    <>
      {!plan ? (
        <ol className={styles.howto}>
          <li>{t('video.step_1')}</li>
          <li>{t('video.step_2', { count: estimate.count, seconds: estimate.eachSec })}</li>
          <li>{t('video.step_3')}</li>
        </ol>
      ) : (
        <p className={styles.nextHint}>
          {!allScenesReady
            ? t('video.next_draw', { count: plan.scenes.length, drawn: drawnCount })
            : t('video.next_assemble')}
        </p>
      )}

      {drafts.length > 0 ? (
        <section className={styles.card}>
          <h2 className={styles.subtitle}>{t('video.history_title')}</h2>
          <p className={styles.lead}>{t('video.history_help')}</p>
          <ul className={styles.history}>
            {drafts.map((d) => (
              <li key={d.id} className={styles.historyRow} data-on={d.id === draftIdRef.current}>
                <button type="button" className={styles.historyMain} onClick={() => handleRestore(d.id)} disabled={busy !== 'idle'}>
                  <strong>{d.topic || t('video.history_untitled')}</strong>
                  <span>
                    {t('video.history_meta', {
                      drawn: countDrawn(d.plan),
                      total: d.plan?.scenes.length ?? 0,
                      when: new Date(d.updatedAt).toLocaleString(),
                    })}
                  </span>
                </button>
                <button type="button" className={styles.link} onClick={() => handleDeleteDraft(d.id)} disabled={busy !== 'idle'}>
                  {t('video.history_delete')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className={styles.split}>
      <div className={styles.workCol}>
      {hasImageEngine === false ? (
        <section className={styles.card}>
          <p className={styles.error}>{t('video.need_image_engine')}</p>
          <Link className={styles.link} to="/studio?family=image">{t('video.open_image_studio')}</Link>
        </section>
      ) : null}

      <section className={styles.card}>
        <h2 className={styles.subtitle}>{t('video.step_card_topic')}</h2>
        <p className={styles.lead}>{t('video.topic_help')}</p>
        <label className={styles.label} htmlFor="yt-topic">{t('video.topic')}</label>
        <textarea
          id="yt-topic"
          className={styles.textarea}
          rows={3}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={t('video.topic_placeholder')}
        />
        <div className={styles.row}>
          <div className={styles.field}>
            <span className={styles.label}>{t('video.format')}</span>
            <div className={styles.pills}>
              <button type="button" className={styles.pill} data-on={format === 'landscape'} onClick={() => handleFormat('landscape')}>
                {t('video.format_landscape')}
              </button>
              <button type="button" className={styles.pill} data-on={format === 'shorts'} onClick={() => handleFormat('shorts')}>
                {t('video.format_shorts')}
              </button>
            </div>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>{t('video.length')}</span>
            <div className={styles.pills}>
              {([30, 60, 180, 480] as const).map((sec) => (
                <button key={sec} type="button" className={styles.pill} data-on={durationSec === sec} onClick={() => handleDuration(sec)}>
                  {sec < 120 ? `${sec}s` : `${sec / 60}m`}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className={styles.hint}>{t('video.estimate_scenes', { count: estimate.count, seconds: estimate.eachSec })}</p>
        {engineName ? <p className={styles.hint}>{t('video.engine_draws', { engine: engineName })}</p> : null}
        {topicDirty ? <p className={styles.hint}>{t('video.topic_changed')}</p> : null}
        <button
          type="button"
          className={plan ? styles.secondary : styles.primary}
          onClick={handlePlan}
          disabled={!topic.trim() || busy !== 'idle'}
        >
          {plan ? t('video.plan_again') : t('video.plan')}
        </button>
      </section>

      {plan ? (
        <section className={styles.card}>
          <div className={styles.sceneHeader}>
            <h2 className={styles.subtitle}>{t('video.storyboard', { count: plan.scenes.length })}</h2>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={() => { void handleGenerateScenes(); }}
                disabled={busy !== 'idle' || hasImageEngine !== true || allScenesReady}
              >
                {drawnCount > 0 && !allScenesReady ? t('video.generate_remaining', { count: remaining }) : t('video.generate_scenes')}
              </button>
              <button type="button" className={styles.secondary} onClick={() => { void handleAssemble(); }} disabled={busy !== 'idle' || !allScenesReady}>
                {t('video.assemble')}
              </button>
            </div>
          </div>
          <p className={styles.lead}>{t('video.storyboard_help')}</p>
          {canFillDisk ? (
            <p className={styles.hint}>
              {t('video.fill_from_disk_help', { n: Math.min(remaining, diskStills.length) })}{' '}
              <button type="button" className={styles.link} onClick={handleFillFromDisk} disabled={busy !== 'idle'}>
                {t('video.fill_from_disk')}
              </button>
            </p>
          ) : null}
          {busy === 'idle' && !allScenesReady ? <p className={styles.nextHint}>{t('video.click_draw')}</p> : null}
          {busy === 'scenes' ? (
            <div className={styles.genStatus}>
              <p className={styles.progress}>{progress}</p>
              <p className={styles.hint}>
                {t('video.generating_tick', {
                  pct: Math.round((frameTick?.progress ?? 0) * 100),
                  elapsed: formatClock(frameTick?.elapsedSeconds ?? 0),
                  overall: overallPct,
                })}
              </p>
              <div className={styles.barTrack} aria-hidden>
                <div className={styles.barFill} style={{ width: `${Math.round((frameTick?.progress ?? 0) * 100)}%` }} />
              </div>
              <p className={styles.hint}>{t('video.generating_wait')}</p>
            </div>
          ) : null}
          {error ? <p className={styles.error}>{error}</p> : null}
          <ol className={styles.scenes}>
            {plan.scenes.map((scene, index) => (
              <li key={scene.id} className={styles.scene} data-drawing={drawingIndex === index}>
                {scene.imagePath ? (
                  <img className={styles.thumb} src={`asset://${filePathFromAssetUrl(scene.imagePath)}`} alt="" />
                ) : (
                  <div className={styles.thumbEmpty} aria-hidden>
                    <span>{drawingIndex === index ? t('video.scene_drawing') : t('video.thumb_empty')}</span>
                  </div>
                )}
                <div className={styles.sceneBody}>
                  <strong>{t('video.scene_index', { n: index + 1, total: plan.scenes.length })} · {sceneTitle(scene)}</strong>
                  <span>{t('video.scene_hold', { seconds: scene.durationSec })}</span>
                  {drawingIndex === index && frameTick ? (
                    <>
                      <span>{t('video.scene_tick', { pct: Math.round(frameTick.progress * 100), elapsed: formatClock(frameTick.elapsedSeconds) })}</span>
                      <div className={styles.barTrack} aria-hidden>
                        <div className={styles.barFill} style={{ width: `${Math.round(frameTick.progress * 100)}%` }} />
                      </div>
                    </>
                  ) : (
                    <p>{t(`video.hint_${scene.hintKey}`)}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      </div>

      <div className={styles.previewCol}>
      <VideoPreviewPane
        filePath={outputPath}
        savedTo={savedTo}
        onSaveAs={() => { void handleSaveAs(); }}
        onDiscard={() => { void handleDiscard(); }}
      />
      {outputPath ? (
        <VideoTimelineCard
          videoPath={outputPath}
          initialPrompt={plan ? voiceoverPromptFromPlan(plan) : ''}
          hidePath
        />
      ) : null}
      </div>
      </div>
    </>
  );
}
