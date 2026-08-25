/**
 * HomePage — container component for the Canvas start page.
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
import { useNavigate } from 'react-router-dom';

import { IntentInput } from '../../../../shared/ui/IntentInput/IntentInput';
import { QUICK_SUGGESTIONS } from '../../api/assetApi';
import { useHomeStore } from '../../store/homeStore';
import { ContinueWorking } from '../ContinueWorking/ContinueWorking';
import { RecentAssets } from '../RecentAssets/RecentAssets';
import { Inspiration } from '../Inspiration/Inspiration';
import styles from './HomePage.module.css';

/* ─── Component ─────────────────────────────────────────────────────── */

export function HomePage(): ReactNode {
  const navigate = useNavigate();

  /* Store selectors */
  const intentDraft = useHomeStore((s) => s.intentDraft);
  const isCreating = useHomeStore((s) => s.isCreating);
  const setIntentDraft = useHomeStore((s) => s.setIntentDraft);

  const projectsStatus = useHomeStore((s) => s.projectsStatus);
  const recentProjects = useHomeStore((s) => s.recentProjects);
  const loadRecentProjects = useHomeStore((s) => s.loadRecentProjects);

  const assetsStatus = useHomeStore((s) => s.assetsStatus);
  const recentAssets = useHomeStore((s) => s.recentAssets);
  const loadRecentAssets = useHomeStore((s) => s.loadRecentAssets);

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

  const handleInspirationSelect = (prompt: string) => {
    setIntentDraft(prompt);
  };

  /* Suggestion chips are an idle-state affordance: they disappear
     once the user has typed something. */
  const showSuggestions = intentDraft.trim().length === 0;

  return (
    <div className={styles.content}>
      {/* Hero heading */}
      <header className={styles.header}>
        <h1 className={styles.heading}>Create something new</h1>
        <p className={styles.subheading}>
          Describe the result you want — Canvas takes care of the rest.
        </p>
      </header>

      {/* Intent bar — the centrepiece */}
      <div className={styles.intentSection}>
        <IntentInput
          value={intentDraft}
          onChange={setIntentDraft}
          onSubmit={handleSubmit}
          isDisabled={isCreating}
          placeholder="A cinematic portrait with dramatic lighting…"
          onAttach={() => {
            /* Attach handler — wired in a future milestone. */
          }}
        />

        {/* Quick-start suggestion chips */}
        {showSuggestions ? (
          <div className={styles.suggestions}>
            {QUICK_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className={styles.chip}
                onClick={() => setIntentDraft(suggestion)}
              >
                {suggestion}
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
          onRetry={loadRecentProjects}
        />
      </div>

      {/* Recent assets grid */}
      <div className={styles.recentSection}>
        <RecentAssets
          status={assetsStatus}
          assets={recentAssets}
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
