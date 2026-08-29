import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { runGeneration } from '../../create/api/generationApi';
import { WorkspaceFlow } from '../../studio/ui/WorkspaceFlow';
import { filePathFromAssetUrl, useWorkspaceBridgeStore } from '../../studio/store/workspaceBridgeStore';
import ui from '../../video/ui/VideoPage.module.css';
import { MeshProgress, type MeshProgressState } from './MeshProgress';
import styles from './ThreeDPage.module.css';

const TRIPOSR_ID = 'stabilityai/TripoSR';

type MeshMode = 'photo' | 'prompt' | 'photos';
type BusyKind = 'idle' | 'still' | 'mesh';

export function ThreeDPage(): ReactNode {
  const { t } = useTranslation();
  const lastImagePath = useWorkspaceBridgeStore((s) => s.lastImagePath);
  const setLastImagePath = useWorkspaceBridgeStore((s) => s.setLastImagePath);

  const [mode, setMode] = useState<MeshMode>('photo');
  const [prompt, setPrompt] = useState('');
  const [referencePath, setReferencePath] = useState<string | null>(lastImagePath);
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [outputFormat, setOutputFormat] = useState<'glb' | 'obj'>('glb');
  const [removeBg, setRemoveBg] = useState(true);
  const [busy, setBusy] = useState<BusyKind>('idle');
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [engineReady, setEngineReady] = useState<boolean | null>(null);
  const [weightsLocal, setWeightsLocal] = useState(false);
  const [engineDetail, setEngineDetail] = useState<string | null>(null);
  const [modelInstalled, setModelInstalled] = useState(false);
  const [hasImageEngine, setHasImageEngine] = useState(false);
  const [meshProgress, setMeshProgress] = useState<MeshProgressState | null>(null);
  const [stillPercent, setStillPercent] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (lastImagePath && !referencePath) setReferencePath(lastImagePath);
  }, [lastImagePath, referencePath]);

  useEffect(() => {
    const load = async () => {
      if (!window.api) return;
      try {
        const [status, models] = await Promise.all([
          window.api.get3dStatus(),
          window.api.getModels(),
        ]);
        setEngineReady(status.ready);
        setEngineDetail(status.detail ?? null);
        setWeightsLocal(Boolean(status.weights_local));
        setModelInstalled(models.some((m: { id: string; status: string }) => m.id === TRIPOSR_ID && m.status === 'ready'));
        setHasImageEngine(models.some((m: { type: string; status: string }) => m.type === 'image' && m.status === 'ready'));
      } catch {
        setEngineReady(false);
      }
    };
    void load();
    return window.api?.onModelsUpdated(() => { void load(); }) ?? (() => {});
  }, []);

  useEffect(() => {
    if (busy === 'idle') {
      setElapsedSec(0);
      return;
    }
    const started = Date.now();
    const tick = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(tick);
  }, [busy]);

  useEffect(() => {
    if (busy !== 'mesh' || !window.api?.get3dProgress) return;
    const pull = () => {
      void window.api.get3dProgress().then(setMeshProgress).catch(() => {});
    };
    pull();
    const timer = window.setInterval(pull, 400);
    return () => window.clearInterval(timer);
  }, [busy]);

  const setReference = (path: string) => {
    setReferencePath(path);
    setLastImagePath(path);
    setError(null);
    setOutputPath(null);
  };

  const handlePickOne = async () => {
    const picked = await window.api?.pickImage?.();
    if (picked) setReference(picked);
  };

  const handlePickMany = async () => {
    const picked = await window.api?.pickImages?.();
    if (!picked || picked.length === 0) return;
    setPhotoPaths(picked);
    setReference(picked[0]);
  };

  const runMesh = async (imagePath: string) => {
    const result = await window.api.generateMesh({
      image_path: imagePath,
      model_id: TRIPOSR_ID,
      output_format: outputFormat,
      remove_background: removeBg,
    });
    if (result.file_path) setOutputPath(result.file_path);
  };

  const handleGenerateFromPhoto = async () => {
    if (!referencePath || !window.api?.generateMesh) return;
    setBusy('mesh');
    setError(null);
    setOutputPath(null);
    setMeshProgress({ stage: 'queued', percent: 3 });
    try {
      await runMesh(referencePath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('idle');
    }
  };

  const handleGenerateFromPrompt = async () => {
    if (!prompt.trim() || !window.api?.generateMesh) return;
    setBusy('still');
    setError(null);
    setOutputPath(null);
    setStillPercent(2);
    setMeshProgress(null);
    try {
      const { promise } = runGeneration(
        { prompt: prompt.trim(), format: 'square', style: 'subtle' },
        (p) => setStillPercent(Math.round(p.progress * 100)),
      );
      const still = await promise;
      const path = filePathFromAssetUrl(still.thumbnailUrl);
      if (!path) throw new Error(t('threed.still_failed'));
      setReference(path);
      setBusy('mesh');
      setMeshProgress({ stage: 'queued', percent: 3 });
      await runMesh(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('idle');
    }
  };

  const meshSource = mode === 'photos' ? (referencePath ?? photoPaths[0] ?? null) : referencePath;
  const canMesh = Boolean(meshSource) && engineReady === true && busy === 'idle';
  const canPrompt = prompt.trim().length > 0 && engineReady === true && hasImageEngine && busy === 'idle';

  return (
    <div className={ui.container}>
      <header className={ui.header}>
        <div>
          <h1 className={ui.title}>{t('threed.title')}</h1>
          <p className={ui.lead}>{t('threed.lead')}</p>
        </div>
      </header>

      <WorkspaceFlow kind="threed" />

      {engineReady === false ? (
        <section className={ui.card}>
          <p className={ui.error}>{engineDetail ?? t('threed.engine_missing')}</p>
          <p className={ui.lead}>{t('threed.engine_setup')}</p>
        </section>
      ) : null}

      {!modelInstalled && !weightsLocal && engineReady ? (
        <section className={ui.card}>
          <p className={ui.lead}>{t('threed.weights_hf_fallback')}</p>
          <Link className={ui.link} to="/studio?family=3d">{t('threed.download_in_studio')}</Link>
        </section>
      ) : null}

      <div className={ui.pills}>
        {(['photo', 'prompt', 'photos'] as const).map((id) => (
          <button key={id} type="button" className={ui.pill} data-on={mode === id} onClick={() => setMode(id)}>
            {t(`threed.mode_${id}`)}
          </button>
        ))}
      </div>
      <p className={ui.lead}>{t(`threed.mode_hint_${mode}`)}</p>

      <section className={ui.card}>
        {mode === 'prompt' ? (
          <>
            <label className={ui.label} htmlFor="threed-prompt">{t('threed.prompt')}</label>
            <textarea
              id="threed-prompt"
              className={ui.textarea}
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('threed.prompt_placeholder')}
              disabled={busy !== 'idle'}
            />
            {!hasImageEngine ? (
              <p className={ui.error}>
                {t('threed.need_image_engine')}{' '}
                <Link className={ui.link} to="/studio?family=image">{t('threed.open_image_studio')}</Link>
              </p>
            ) : null}
          </>
        ) : null}

        {mode === 'photo' ? (
          <>
            <label className={ui.label}>{t('threed.reference')}</label>
            <div className={ui.actions}>
              <button type="button" className={ui.secondary} onClick={() => { void handlePickOne(); }} disabled={busy !== 'idle'}>
                {t('threed.pick_image')}
              </button>
            </div>
          </>
        ) : null}

        {mode === 'photos' ? (
          <>
            <label className={ui.label}>{t('threed.photos_label')}</label>
            <div className={ui.actions}>
              <button type="button" className={ui.secondary} onClick={() => { void handlePickMany(); }} disabled={busy !== 'idle'}>
                {t('threed.pick_photos')}
              </button>
            </div>
            {photoPaths.length > 0 ? (
              <ul className={styles.thumbs}>
                {photoPaths.map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      className={styles.thumbBtn}
                      data-on={path === meshSource}
                      onClick={() => setReference(path)}
                    >
                      <img className={ui.thumb} src={`asset://${path}`} alt="" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}

        {mode !== 'photos' && meshSource ? (
          <>
            <p className={ui.output}>{meshSource}</p>
            <img className={ui.thumb} src={`asset://${meshSource}`} alt="" />
          </>
        ) : null}
        {mode === 'photo' && !meshSource ? <p className={ui.output}>{t('threed.no_reference')}</p> : null}
        {mode === 'photos' && photoPaths.length === 0 ? <p className={ui.output}>{t('threed.no_photos')}</p> : null}

        <div className={ui.row}>
          <div className={ui.field}>
            <span className={ui.label}>{t('threed.format')}</span>
            <div className={ui.pills}>
              {(['glb', 'obj'] as const).map((fmt) => (
                <button key={fmt} type="button" className={ui.pill} data-on={outputFormat === fmt} onClick={() => setOutputFormat(fmt)}>
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className={ui.field}>
            <span className={ui.label}>{t('threed.remove_bg')}</span>
            <div className={ui.pills}>
              <button type="button" className={ui.pill} data-on={removeBg} onClick={() => setRemoveBg(true)}>{t('threed.remove_bg_yes')}</button>
              <button type="button" className={ui.pill} data-on={!removeBg} onClick={() => setRemoveBg(false)}>{t('threed.remove_bg_no')}</button>
            </div>
          </div>
        </div>

        {mode === 'prompt' ? (
          <button type="button" className={ui.primary} onClick={() => { void handleGenerateFromPrompt(); }} disabled={!canPrompt}>
            {busy === 'still' ? t('threed.generating_still') : busy === 'mesh' ? t('threed.generating') : t('threed.generate_from_prompt')}
          </button>
        ) : (
          <button type="button" className={ui.primary} onClick={() => { void handleGenerateFromPhoto(); }} disabled={!canMesh}>
            {busy === 'mesh' ? t('threed.generating') : t('threed.generate')}
          </button>
        )}

        {busy !== 'idle' ? (
          <MeshProgress
            kind={busy === 'still' ? 'still' : 'mesh'}
            elapsedSec={elapsedSec}
            stillPercent={stillPercent}
            mesh={meshProgress}
          />
        ) : null}
        {error ? <p className={ui.error}>{error}</p> : null}
        {outputPath ? (
          <p className={ui.output}>
            {t('threed.saved')}{' '}
            <button type="button" className={ui.link} onClick={() => { void window.api.openPath(outputPath); }}>
              {outputPath}
            </button>
          </p>
        ) : null}
      </section>
    </div>
  );
}
