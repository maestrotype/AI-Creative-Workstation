/**
 * HomePage — container component for the Canvas start page.
 *
 * Architecture: Container / Smart component.
 * - Wires Zustand store slices to presentational children.
 * - No visual styling of its own beyond layout (all values from tokens).
 * - Renders: IntentInput, suggestion chips, RecentAssets.
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
import { RecentAssets } from '../RecentAssets/RecentAssets';
import styles from './HomePage.module.css';

/* ─── Component ─────────────────────────────────────────────────────── */

export function HomePage(): ReactNode {
  const navigate = useNavigate();

  /* Store selectors */
  const intentDraft     = useHomeStore((s) => s.intentDraft);
  const isCreating      = useHomeStore((s) => s.isCreating);
  const assetsStatus    = useHomeStore((s) => s.assetsStatus);
  const recentAssets    = useHomeStore((s) => s.recentAssets);
  const setIntentDraft  = useHomeStore((s) => s.setIntentDraft);
  const loadRecentAssets = useHomeStore((s) => s.loadRecentAssets);

  /* Fetch recent assets on mount. */
  useEffect(() => {
    loadRecentAssets();
  }, [loadRecentAssets]);

  const handleSubmit = () => {
    if (intentDraft.trim().length > 0) {
      // Transition to Create view to process the intent
      navigate('/create');
    }
  };

  /* Suggestion chips are an idle-state affordance: they disappear
     once the user has typed something or assets have loaded. */
  const showSuggestions =
    assetsStatus === 'idle' && intentDraft.trim().length === 0;

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

      {/* Recent assets grid */}
      <div className={styles.recentSection}>
        <RecentAssets
          status={assetsStatus}
          assets={recentAssets}
          onRetry={loadRecentAssets}
        />
      </div>
    </div>
  );
}
