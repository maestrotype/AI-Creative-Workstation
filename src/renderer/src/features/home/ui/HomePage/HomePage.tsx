/**
 * HomePage — start page container.
 *
 * Architecture: Container / Smart component.
 * - Wires Zustand store slices to presentational children.
 * - No visual styling of its own beyond layout (all values from tokens).
 * - Renders: IntentInput, suggestion chips, ContinueWorking, RecentAssets, Inspiration.
 *
 * This is the first screen the user sees. It must feel cinematic and inviting,
 * encouraging creation from the moment of arrival.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Asset } from '../../../../core/types';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { IntentInput } from '../../../../shared/ui/IntentInput/IntentInput';
import { filePathFromAssetUrl } from '../../../studio/store/workspaceBridgeStore';
import { attachGeneratedToFilm } from '../../../projects/model/attachToFilm';
import { isVoiceoverIntent, pickAndStartVoiceover, startProjectFromVideo } from '../../../projects/model/startVoiceover';
import { useHomeStore } from '../../store/homeStore';
import { useCreateStore } from '../../../create/store/createStore';
import { ContinueWorking } from '../ContinueWorking/ContinueWorking';
import { RecentAssets } from '../RecentAssets/RecentAssets';
import { Inspiration } from '../Inspiration/Inspiration';
import styles from './HomePage.module.css';

/* ─── Component ─────────────────────────────────────────────────────── */

export function HomePage(): ReactNode {
  const navigate = useNavigate();
  const { t } = useTranslation();

  /* Store selectors */
  const intentDraft = useHomeStore((s) => s.intentDraft);
  const isCreating = useHomeStore((s) => s.isCreating);
  const setIntentDraft = useHomeStore((s) => s.setIntentDraft);
  const setIntentJob = useHomeStore((s) => s.setIntentJob);
  const referenceDrafts = useHomeStore((s) => s.referenceDrafts);
  const setReferenceDrafts = useHomeStore((s) => s.setReferenceDrafts);

  const projectsStatus = useHomeStore((s) => s.projectsStatus);
  const recentProjects = useHomeStore((s) => s.recentProjects);
  const loadRecentProjects = useHomeStore((s) => s.loadRecentProjects);

  const assetsStatus = useHomeStore((s) => s.assetsStatus);
  const recentAssets = useHomeStore((s) => s.recentAssets);
  const loadRecentAssets = useHomeStore((s) => s.loadRecentAssets);
  const deleteRecentAsset = useHomeStore((s) => s.deleteRecentAsset);
  const openFromAsset = useCreateStore((s) => s.openFromAsset);
  const [assetsExpanded, setAssetsExpanded] = useState(false);
  const [filmNote, setFilmNote] = useState<string | null>(null);
  const [filmOpenId, setFilmOpenId] = useState<string | null>(null);
  const [jobMode, setJobMode] = useState<'voice' | 'picture' | 'film'>('voice');
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const inspirationStatus = useHomeStore((s) => s.inspirationStatus);
  const inspirationItems = useHomeStore((s) => s.inspirationItems);
  const loadInspirationItems = useHomeStore((s) => s.loadInspirationItems);

  /* Fetch all data on mount. */
  useEffect(() => {
    loadRecentProjects();
    loadRecentAssets();
    loadInspirationItems();
  }, [loadRecentProjects, loadRecentAssets, loadInspirationItems]);

  const attachedVideo = referenceDrafts.find((ref) => ref.kind === 'video' && ref.sourcePath)?.sourcePath;

  const startVoice = async (path?: string) => {
    setVoiceBusy(true);
    setVoiceError(null);
    try {
      const options = {
        untitled: t('projects.untitled'),
        chapterTitle: t('projects.imported_video_chapter'),
        brief: intentDraft.trim(),
      };
      const href = path
        ? await startProjectFromVideo(path, { ...options, voice: true })
        : await pickAndStartVoiceover(options);
      if (href) navigate(href);
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : String(err));
    } finally {
      setVoiceBusy(false);
    }
  };

  const handleSubmit = () => {
    if (jobMode === 'voice' || isVoiceoverIntent(intentDraft)) {
      setJobMode('voice');
      void startVoice(attachedVideo);
      return;
    }
    if (jobMode === 'film') {
      navigate('/projects');
      return;
    }
    if (intentDraft.trim().length > 0) {
      navigate('/create');
    }
  };

  const handleInspirationSelect = (item: { prompt: string; job: 'title' | 'frame' | 'product' }) => {
    setIntentDraft(item.prompt);
    setIntentJob(item.job);
    navigate('/create');
  };

  const openStillInCreate = (asset: Asset) => {
    openFromAsset(asset);
    navigate('/create');
  };

  const diskPathOf = (asset: Asset): string | null => {
    if (asset.id.startsWith('/')) return asset.id;
    return filePathFromAssetUrl(asset.thumbnailUrl);
  };

  const useInFilm = async (asset: Asset) => {
    const path = diskPathOf(asset);
    if (!path) return;
    try {
      const film = await attachGeneratedToFilm({
        path,
        kind: asset.kind === 'video' ? 'video' : 'image',
        prompt: asset.name,
      });
      setFilmOpenId(film.projectId);
      setFilmNote(t('home.added_to_film', { name: film.name }));
    } catch (err) {
      setFilmNote(err instanceof Error ? err.message : String(err));
    }
  };

  const downloadAsset = (asset: Asset) => {
    const path = asset.kind === 'video' && asset.id.startsWith('/')
      ? asset.id
      : filePathFromAssetUrl(asset.thumbnailUrl);
    if (!path || !window.api?.saveMediaAs) return;
    void window.api.saveMediaAs(path).catch(() => undefined);
  };

  /* Suggestion chips are an idle-state affordance: they disappear
     once the user has typed something. */
  const showSuggestions = intentDraft.trim().length === 0;

  return (
    <div className={styles.content}>
      {/* Hero heading */}
      <header className={styles.header}>
        <h1 className={styles.heading}>{t('home.hero_heading')}</h1>
        <p className={styles.subheading}>{t('home.hero_subheading')}</p>
      </header>

      {/* Intent bar — the centrepiece */}
      <div className={styles.intentSection}>
        <div className={styles.modes} role="tablist" aria-label={t('home.hero_heading')}>
          {([
            ['voice', 'home.job_voice'],
            ['picture', 'home.job_picture'],
            ['film', 'home.job_film'],
          ] as const).map(([id, key]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={jobMode === id}
              className={styles.mode}
              data-on={jobMode === id || undefined}
              onClick={() => setJobMode(id)}
            >
              {t(key)}
            </button>
          ))}
        </div>

        {jobMode === 'voice' ? (
          <div className={styles.voiceCard}>
            <strong>{t('home.job_voice_title')}</strong>
            <p>{t('home.job_voice_body')}</p>
            <div className={styles.voiceActions}>
              <button
                type="button"
                className={styles.voicePrimary}
                disabled={voiceBusy}
                onClick={() => { void startVoice(attachedVideo); }}
              >
                {voiceBusy
                  ? t('home.job_voice_busy')
                  : attachedVideo
                    ? t('home.job_voice_attached')
                    : t('home.job_voice_pick')}
              </button>
              <button type="button" className={styles.chip} onClick={() => navigate('/assets?tab=voice')}>
                {t('home.job_voice_sample')}
              </button>
            </div>
            {voiceError ? <p className={styles.voiceError}>{voiceError}</p> : null}
          </div>
        ) : null}

        {jobMode === 'film' ? (
          <p className={styles.modeNote}>{t('home.job_film_body')}</p>
        ) : null}

        <IntentInput
          value={intentDraft}
          onChange={setIntentDraft}
          onSubmit={handleSubmit}
          isDisabled={isCreating || voiceBusy}
          placeholder={t(
            jobMode === 'voice'
              ? 'home.intent_placeholder_voice'
              : jobMode === 'film'
                ? 'home.intent_placeholder_film'
                : 'home.intent_placeholder',
          )}
          hint={t(
            jobMode === 'voice'
              ? 'home.intent_hint_voice'
              : jobMode === 'film'
                ? 'home.intent_hint_film'
                : 'home.intent_hint',
          )}
          references={referenceDrafts}
          onReferencesChange={setReferenceDrafts}
        />

        {/* Quick-start suggestion chips */}
        {jobMode === 'picture' && showSuggestions ? (
          <div className={styles.suggestions}>
            {(['suggest_1', 'suggest_2', 'suggest_3'] as const).map((key) => (
              <button
                key={key}
                type="button"
                className={styles.chip}
                onClick={() => {
                  setIntentDraft(t(`home.${key}`));
                  setIntentJob(key === 'suggest_1' ? 'title' : 'product');
                }}
              >
                {t(`home.${key}`)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Recent projects grid */}
      <div className={styles.recentSection}>
        <ContinueWorking
          status={projectsStatus}
          projects={recentProjects}
          hrefFor={(asset) => `/video?project=${encodeURIComponent(asset.id)}`}
          onDownload={downloadAsset}
          onRetry={loadRecentProjects}
        />
      </div>

      {/* Recent assets grid */}
      <div className={styles.recentSection}>
        <RecentAssets
          status={assetsStatus}
          assets={recentAssets}
          expanded={assetsExpanded}
          onToggleExpanded={() => setAssetsExpanded((on) => !on)}
          onOpen={openStillInCreate}
          onUse={(asset) => { void useInFilm(asset); }}
          useLabelFor={(asset) => (
            asset.kind === 'video' ? t('home.use_in_film') : t('home.use_as_product')
          )}
          onDownload={downloadAsset}
          onDelete={(asset) => {
            void deleteRecentAsset(asset);
          }}
          onRetry={loadRecentAssets}
          note={filmNote}
          noteHref={filmOpenId ? `/video?project=${encodeURIComponent(filmOpenId)}` : null}
          noteHrefLabel={t('home.open_this_film')}
        />
      </div>

      {/* Inspiration gallery */}
      <div className={styles.inspirationSection}>
        <Inspiration
          status={inspirationStatus}
          items={inspirationItems}
          onSelect={handleInspirationSelect}
        />
      </div>
    </div>
  );
}
