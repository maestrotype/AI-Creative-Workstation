import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { studioHref } from '../../studio/model/studioReturn';
import { useDirector } from './DirectorBoard';
import vp from './VideoPage.module.css';

type OllamaStatus = Awaited<ReturnType<NonNullable<Window['api']>['getOllamaEngineStatus']>>;

export function LlmEngineNotice(): ReactNode {
  const d = useDirector();
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const studio = studioHref('llm', '/video');

  useEffect(() => {
    void window.api?.getOllamaEngineStatus?.().then(setStatus).catch(() => setStatus(null));
    const cleanup = window.api?.onOllamaEngineUpdated?.(setStatus);
    return () => { cleanup?.(); };
  }, []);

  const startServer = async () => {
    if (!window.api?.startOllamaServe) return;
    setStarting(true);
    try {
      await window.api.startOllamaServe();
      const next = await window.api.getOllamaEngineStatus();
      setStatus(next);
    } finally {
      setStarting(false);
    }
  };

  if (!status) return null;
  if (status.model_ready) {
    return <p className={vp.hintTight}>{d.t('video.vo_llm_ready')}</p>;
  }
  if (status.model_on_disk) {
    return (
      <p className={vp.voScriptNotice}>
        {d.t('video.vo_llm_needs_server')}{' '}
        <button
          type="button"
          className={vp.voStudioLink}
          disabled={starting}
          onClick={() => { void startServer(); }}
        >
          {starting ? d.t('video.vo_llm_starting') : d.t('video.vo_llm_start')}
        </button>
        {' · '}
        <Link className={vp.voStudioLink} to={studio}>{d.t('video.vo_script_open_studio')}</Link>
      </p>
    );
  }
  return (
    <p className={vp.voScriptNotice}>
      {d.t('video.vo_script_fallback_note')}{' '}
      <Link className={vp.voStudioLink} to={studio}>{d.t('video.vo_script_open_studio')}</Link>
    </p>
  );
}
