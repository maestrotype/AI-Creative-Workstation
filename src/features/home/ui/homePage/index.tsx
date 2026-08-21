/**
 * HomePage — container for the Canvas start page (Rule 1).
 * Wires the store to presentational children: SideNavigation, IntentInput,
 * quick-start suggestions and the Recent grid. No visual styling of its own
 * beyond layout; all values come from design tokens (Rule 2).
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { QUICK_CREATE_SUGGESTIONS } from '../../api/assetApi';
import { NAVIGATION_ITEMS } from '../../model/navigation';
import { useHomeStore } from '../../store/homeStore';
import { IntentInput } from '../../../../shared/ui/IntentInput/IntentInput';
import { RecentAssets } from '../recentAssets';
import { SideNavigation } from '../sideNavigation';
import styles from './homePage.module.css';

export function HomePage(): ReactNode {
  const intentDraft = useHomeStore((state) => state.intentDraft);
  const assetsStatus = useHomeStore((state) => state.assetsStatus);
  const recentAssets = useHomeStore((state) => state.recentAssets);
  const activeNavId = useHomeStore((state) => state.activeNavId);
  const setActiveNavId = useHomeStore((state) => state.setActiveNavId);
  const setIntentDraft = useHomeStore((state) => state.setIntentDraft);
  const submitIntent = useHomeStore((state) => state.submitIntent);
  const loadRecentAssets = useHomeStore((state) => state.loadRecentAssets);

  useEffect(() => {
    loadRecentAssets();
  }, [loadRecentAssets]);

  // Quick-start chips are an "idle" affordance (assetApi spec): they disappear
  // once the user has a draft or assets have been loaded.
  const showSuggestions = assetsStatus === 'idle' && intentDraft.trim().length === 0;

  return (
    <div className={styles.page}>
      <SideNavigation items={NAVIGATION_ITEMS} activeId={activeNavId} onSelect={setActiveNavId} />

      <main className={styles.main}>
        <div className={styles.content}>
          <header className={styles.header}>
            <h1 className={styles.heading}>Create something new</h1>
            <p className={styles.subheading}>
              Describe the result you want — Canvas takes care of the rest.
            </p>
          </header>

          <IntentInput
            value={intentDraft}
            onChange={setIntentDraft}
            onSubmit={submitIntent}
            placeholder="Describe what you want to create…"
          />

          {showSuggestions ? (
            <div className={styles.suggestions}>
              {QUICK_CREATE_SUGGESTIONS.map((suggestion) => (
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

          <RecentAssets status={assetsStatus} assets={recentAssets} onRetry={loadRecentAssets} />
        </div>
      </main>
    </div>
  );
}