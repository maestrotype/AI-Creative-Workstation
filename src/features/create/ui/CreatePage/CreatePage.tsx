/**
 * CreatePage — the core generation flow.
 *
 * Architecture: Container component.
 * Orchestrates the 3 steps of creation: intent, generating, result.
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { useHomeStore } from '../../../home/store/homeStore';
import { useCreateStore } from '../../store/createStore';
import { IntentStep } from '../IntentStep/IntentStep';
import { GeneratingStep } from '../GeneratingStep/GeneratingStep';
import { ResultStep } from '../ResultStep/ResultStep';
import { ChevronLeftIcon } from '../../../../shared/ui/icons';
import styles from './CreatePage.module.css';

export function CreatePage(): ReactNode {
  const navigate = useNavigate();
  const step = useCreateStore((s) => s.step);
  const reset = useCreateStore((s) => s.reset);
  const setPrompt = useCreateStore((s) => s.setPrompt);
  const setOnResultReady = useCreateStore((s) => s.setOnResultReady);
  
  // Need to read from home store and write back to it
  const homeDraft = useHomeStore((s) => s.intentDraft);
  const addGeneratedAsset = useHomeStore((s) => s.addGeneratedAsset);
  const setIntentDraft = useHomeStore((s) => s.setIntentDraft);

  // Initialize on mount
  useEffect(() => {
    // If the user came from Home page with a draft, seed the prompt
    if (homeDraft) {
      setPrompt(homeDraft);
      setIntentDraft(''); // clear it so we don't carry it around forever
    }
    
    // Tell createStore how to save results globally
    setOnResultReady(addGeneratedAsset);

    return () => {
      // Clean up when unmounting (e.g. user navigates away)
      reset();
    };
  }, [homeDraft, setPrompt, setIntentDraft, setOnResultReady, addGeneratedAsset, reset]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.backButton}
          onClick={() => navigate('/')}
        >
          <ChevronLeftIcon size={20} />
          Back to Home
        </button>
      </header>

      <div className={styles.content}>
        {step === 'intent' && <IntentStep />}
        {step === 'generating' && <GeneratingStep />}
        {step === 'result' && <ResultStep />}
      </div>
    </div>
  );
}
