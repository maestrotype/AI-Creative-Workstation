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
  const setPrompt = useCreateStore((s) => s.setPrompt);
  const setReferenceImages = useCreateStore((s) => s.setReferenceImages);
  const setOnResultReady = useCreateStore((s) => s.setOnResultReady);
  const addGeneratedAsset = useHomeStore((s) => s.addGeneratedAsset);
  const setIntentDraft = useHomeStore((s) => s.setIntentDraft);
  const setReferenceDrafts = useHomeStore((s) => s.setReferenceDrafts);

  useEffect(() => {
    setOnResultReady(addGeneratedAsset);
    const { intentDraft, referenceDrafts } = useHomeStore.getState();
    if (intentDraft) {
      setPrompt(intentDraft);
      setIntentDraft('');
    }
    if (referenceDrafts.length > 0) {
      setReferenceImages(referenceDrafts);
      setReferenceDrafts([]);
    } else if (intentDraft) {
      setReferenceImages([]);
    }
  }, [setOnResultReady, addGeneratedAsset, setPrompt, setIntentDraft, setReferenceImages, setReferenceDrafts]);

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
