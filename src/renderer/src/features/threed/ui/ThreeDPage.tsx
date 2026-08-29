import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { WorkspaceFlow } from '../../studio/ui/WorkspaceFlow';
import { useWorkspaceBridgeStore } from '../../studio/store/workspaceBridgeStore';
import ui from '../../video/ui/VideoPage.module.css';

export function ThreeDPage(): ReactNode {
  const { t } = useTranslation();
  const lastImagePath = useWorkspaceBridgeStore((s) => s.lastImagePath);
  const setLastImagePath = useWorkspaceBridgeStore((s) => s.setLastImagePath);
  const [prompt, setPrompt] = useState('');
  const [referencePath, setReferencePath] = useState<string | null>(lastImagePath);

  useEffect(() => {
    if (lastImagePath && !referencePath) setReferencePath(lastImagePath);
  }, [lastImagePath, referencePath]);

  const handlePick = async () => {
    const picked = await window.api?.pickImage?.();
    if (picked) {
      setReferencePath(picked);
      setLastImagePath(picked);
    }
  };

  return (
    <div className={ui.container}>
      <header className={ui.header}>
        <div>
          <h1 className={ui.title}>{t('threed.title')}</h1>
          <p className={ui.lead}>{t('threed.lead')}</p>
        </div>
      </header>

      <WorkspaceFlow kind="threed" />

      <section className={ui.card}>
        <label className={ui.label} htmlFor="threed-prompt">{t('threed.prompt')}</label>
        <textarea
          id="threed-prompt"
          className={ui.textarea}
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('threed.prompt_placeholder')}
        />
        <div className={ui.actions}>
          <button type="button" className={ui.secondary} onClick={() => { void handlePick(); }}>
            {t('threed.pick_image')}
          </button>
        </div>
        {referencePath ? <p className={ui.output}>{referencePath}</p> : <p className={ui.output}>{t('threed.no_reference')}</p>}
        <button type="button" className={ui.primary} disabled>
          {t('threed.generate')}
        </button>
        <p className={ui.lead}>{t('threed.pipeline_pending')}</p>
      </section>
    </div>
  );
}
