/**
 * HomePage — container component for the Canvas start page.
 *
 * Architecture: Container / Smart component.
 * - Wires Zustand store slices to presentational children.
 * - No visual styling of its own beyond layout (all values from tokens).
 * - Renders: SideNavigation, IntentInput, suggestion chips, RecentAssets.
 *
 * This is the first screen the user sees. It must feel cinematic and inviting,
 * encouraging creation from the moment of arrival.
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { IntentInput } from '../../../../shared/ui/IntentInput/IntentInput';
import { QUICK_SUGGESTIONS } from '../../api/assetApi';
import { NAVIGATION_ITEMS } from '../../model/navigation';
import { useHomeStore } from '../../store/homeStore';
import { RecentAssets } from '../RecentAssets/RecentAssets';
import { SideNavigation } from '../SideNavigation/SideNavigation';
import styles from './HomePage.module.css';

/* ─── Component ─────────────────────────────────────────────────────── */

export function HomePage(): ReactNode {
  /* Store selectors — each selector returns a stable reference to avoid
     unnecessary re-renders (Zustand best practice). */
  const intentDraft     = useHomeStore((s) => s.intentDraft);
  const isCreating      = useHomeStore((s) => s.isCreating);
  const assetsStatus    = useHomeStore((s) => s.assetsStatus);
  const recentAssets    = useHomeStore((s) => s.recentAssets);
  const activeNavId     = useHomeStore((s) => s.activeNavId);
  const setActiveNavId  = useHomeStore((s) => s.setActiveNavId);
  const setIntentDraft  = useHomeStore((s) => s.setIntentDraft);
  const submitIntent    = useHomeStore((s) => s.submitIntent);
  const loadRecentAssets = useHomeStore((s) => s.loadRecentAssets);

  /* Fetch recent assets on mount. */
  useEffect(() => {
    loadRecentAssets();
  }, [loadRecentAssets]);

  /* Suggestion chips are an idle-state affordance: they disappear
     once the user has typed something or assets have loaded. */
  const showSuggestions =
    assetsStatus === 'idle' && intentDraft.trim().length === 0;

  return (
    <div className={styles.page}>
      <SideNavigation
        items={NAVIGATION_ITEMS}
        activeId={activeNavId}
        onSelect={setActiveNavId}
      />

      <main className={styles.main}>
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
              onSubmit={submitIntent}
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
      </main>
    </div>
  );
}
