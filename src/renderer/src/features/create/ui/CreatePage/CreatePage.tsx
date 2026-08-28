/**
 * CreatePage — the core generation flow.
 *
 * Architecture: Container component.
 * Orchestrates the 3 steps of creation: intent, generating, result.
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useHomeStore } from '../../../home/store/homeStore';
import { useCreateStore } from '../../store/createStore';
import { IntentStep } from '../IntentStep/IntentStep';
import { GeneratingStep } from '../GeneratingStep/GeneratingStep';
import { ResultStep } from '../ResultStep/ResultStep';
import { ErrorStep } from '../ErrorStep/ErrorStep';
import { ChevronLeftIcon } from '../../../../shared/ui/icons';
import styles from './CreatePage.module.css';

export function CreatePage(): ReactNode {
  const navigate = useNavigate();
  const { t } = useTranslation();
  
  const step = useCreateStore((s) => s.step);
  const reset = useCreateStore((s) => s.reset);
  const setPrompt = useCreateStore((s) => s.setPrompt);
  const setReferenceImage = useCreateStore((s) => s.setReferenceImage);
  const setOnResultReady = useCreateStore((s) => s.setOnResultReady);
  
  const homeDraft = useHomeStore((s) => s.intentDraft);
  const homeReference = useHomeStore((s) => s.referenceDraft);
  const addGeneratedAsset = useHomeStore((s) => s.addGeneratedAsset);
  const setIntentDraft = useHomeStore((s) => s.setIntentDraft);
  const setReferenceDraft = useHomeStore((s) => s.setReferenceDraft);

  useEffect(() => {
    if (homeDraft) {
      setPrompt(homeDraft);
      setIntentDraft('');
    }
    if (homeReference) {
      setReferenceImage(homeReference);
      setReferenceDraft(null);
    }
    
    // Tell createStore how to save results globally
    setOnResultReady(addGeneratedAsset);

    return () => {
      // Clean up when unmounting (e.g. user navigates away)
      reset();
    };
  }, [homeDraft, homeReference, setPrompt, setIntentDraft, setReferenceImage, setReferenceDraft, setOnResultReady, addGeneratedAsset, reset]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.backButton}
          onClick={() => navigate('/')}
        >
          <ChevronLeftIcon size={20} />
          {t('create.back_to_home')}
        </button>
      </header>

      <div className={styles.content}>
        {step === 'intent' && <IntentStep />}
        {step === 'generating' && <GeneratingStep />}
        {step === 'result' && <ResultStep />}
        {step === 'error' && <ErrorStep />}
      </div>
    </div>
  );
}
