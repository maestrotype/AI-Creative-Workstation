import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { runGeneration } from '../../create/api/generationApi';
import { planYoutubeVideo, type YoutubeFormat, type YoutubePlan } from '../model/planYoutubeVideo';
import styles from './VideoPage.module.css';

export function FromIdeaPanel(): ReactNode {
  const { t } = useTranslation();
  const [topic, setTopic] = useState('');
  const [format, setFormat] = useState<YoutubeFormat>('landscape');
  const [durationSec, setDurationSec] = useState(60);
  const [plan, setPlan] = useState<YoutubePlan | null>(null);
  const [busy, setBusy] = useState<'idle' | 'scenes' | 'assemble'>('idle');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);

  const handlePlan = () => {
    if (!topic.trim()) return;
    setError(null);
    setOutputPath(null);
    setPlan(planYoutubeVideo(topic, format, durationSec));
  };

  const handleGenerateScenes = async () => {
    if (!plan || !window.api?.generateImage) return;
    setBusy('scenes');
    setError(null);
    const next = { ...plan, scenes: plan.scenes.map((s) => ({ ...s })) };
    try {
      for (let i = 0; i < next.scenes.length; i += 1) {
        const scene = next.scenes[i];
        setProgress(t('video.generating_scene', { current: i + 1, total: next.scenes.length }));
        const { promise } = runGeneration(
          { prompt: scene.prompt, format: next.imageFormat, style: 'cinematic' },
          () => {},
        );
        const result = await promise;
        const path = result.thumbnailUrl?.startsWith('asset://')
          ? result.thumbnailUrl.slice('asset://'.length)
          : result.thumbnailUrl;
        next.scenes[i] = { ...scene, imagePath: path };
        setPlan({ ...next });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('idle');
      setProgress('');
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
        image_paths: ready.map((s) => s.imagePath as string),
        durations: ready.map((s) => s.durationSec),
        width: plan.width,
        height: plan.height,
        output_name: `${slug}-${Date.now()}`,
      });
      setOutputPath(result.file_path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('idle');
      setProgress('');
    }
  };

  const allScenesReady = Boolean(plan && plan.scenes.every((s) => s.imagePath));

  return (
    <>
      <section className={styles.card}>
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
              <button type="button" className={styles.pill} data-on={format === 'landscape'} onClick={() => setFormat('landscape')}>
                {t('video.format_landscape')}
              </button>
              <button type="button" className={styles.pill} data-on={format === 'shorts'} onClick={() => setFormat('shorts')}>
                {t('video.format_shorts')}
              </button>
            </div>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>{t('video.length')}</span>
            <div className={styles.pills}>
              {([30, 60, 180, 480] as const).map((sec) => (
                <button key={sec} type="button" className={styles.pill} data-on={durationSec === sec} onClick={() => setDurationSec(sec)}>
                  {sec < 120 ? `${sec}s` : `${sec / 60}m`}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button type="button" className={styles.primary} onClick={handlePlan} disabled={!topic.trim()}>
          {t('video.plan')}
        </button>
      </section>

      {plan ? (
        <section className={styles.card}>
          <div className={styles.sceneHeader}>
            <h2 className={styles.subtitle}>{t('video.storyboard', { count: plan.scenes.length })}</h2>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => { void handleGenerateScenes(); }} disabled={busy !== 'idle'}>
                {t('video.generate_scenes')}
              </button>
              <button type="button" className={styles.secondary} onClick={() => { void handleAssemble(); }} disabled={busy !== 'idle' || !allScenesReady}>
                {t('video.assemble')}
              </button>
            </div>
          </div>
          {progress ? <p className={styles.progress}>{progress}</p> : null}
          {error ? <p className={styles.error}>{error}</p> : null}
          {outputPath ? (
            <p className={styles.output}>
              {t('video.saved')}{' '}
              <button type="button" className={styles.link} onClick={() => { void window.api.openPath(outputPath); }}>
                {outputPath}
              </button>
            </p>
          ) : null}
          <ol className={styles.scenes}>
            {plan.scenes.map((scene) => (
              <li key={scene.id} className={styles.scene}>
                {scene.imagePath ? (
                  <img className={styles.thumb} src={`asset://${scene.imagePath}`} alt="" />
                ) : (
                  <div className={styles.thumbEmpty} />
                )}
                <div className={styles.sceneBody}>
                  <strong>{scene.title}</strong>
                  <span>{scene.durationSec}s</span>
                  <p>{scene.prompt}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}
