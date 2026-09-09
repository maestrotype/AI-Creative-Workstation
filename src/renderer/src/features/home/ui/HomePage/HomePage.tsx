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
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Asset } from '../../../../core/types';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { IntentInput } from '../../../../shared/ui/IntentInput/IntentInput';
import { filePathFromAssetUrl } from '../../../studio/store/workspaceBridgeStore';
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

  const inspirationStatus = useHomeStore((s) => s.inspirationStatus);
  const inspirationItems = useHomeStore((s) => s.inspirationItems);
  const loadInspirationItems = useHomeStore((s) => s.loadInspirationItems);

  /* Fetch all data on mount. */
  useEffect(() => {
    loadRecentProjects();
    loadRecentAssets();
    loadInspirationItems();
  }, [loadRecentProjects, loadRecentAssets, loadInspirationItems]);

  const handleSubmit = () => {
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
        <IntentInput
          value={intentDraft}
          onChange={setIntentDraft}
          onSubmit={handleSubmit}
          isDisabled={isCreating}
          placeholder={t('home.intent_placeholder')}
          hint={t('home.intent_hint')}
          references={referenceDrafts}
          onReferencesChange={setReferenceDrafts}
        />

        {/* Quick-start suggestion chips */}
        {showSuggestions ? (
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
          hrefFor={(asset) => `/projects/${asset.id}`}
          onDownload={downloadAsset}
          onRetry={loadRecentProjects}
        />
      </div>

      {/* Recent assets grid */}
      <div className={styles.recentSection}>
        <RecentAssets
          status={assetsStatus}
          assets={recentAssets}
          onOpen={openStillInCreate}
          onDownload={downloadAsset}
          onDelete={(asset) => {
            void deleteRecentAsset(asset);
          }}
          onRetry={loadRecentAssets}
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
