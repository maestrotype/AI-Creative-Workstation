import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { toAssetUrl } from '../../video/model/directorMedia';
import { assembleShots, planToTimeline, productShotPresets } from '../../video/model/autoAssemble';
import { writeLastProjectId } from '../model/handoff';
import { composeClips, formatForPreset, newScene, normalizePreset, normalizeShotMotion, projectDuration, sceneHasMedia, shotFromGeneration, templateChapters, type FilmPreset, type ProjectDoc, type ProjectScene } from '../model/project';
import styles from './ProjectsPage.module.css';

function ipcMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').trim();
}

function insertStillPrompt(brief: string, scenePrompt: string): string {
  return [
    'Title card or motion-graphic insert for a software template demo video.',
    'Abstract UI glow, typography, product-name card. Do not invent fake screenshots of the admin or store.',
    'The real footage is a screencast the author recorded.',
    brief.trim(),
    scenePrompt.trim(),
  ].filter(Boolean).join('\n\n');
}

function motionErrorMessage(err: unknown, t: (key: string) => string): string {
  const msg = ipcMessage(err);
  if (/CONNECTION_REFUSED|Sidecar unavailable|exited/i.test(msg)) {
    return t('projects.motion_engine_restart');
  }
  if (/H3_REQUIRED|NO_VIDEO_MODEL/i.test(msg)) {
    return t('projects.no_h3');
  }
  if (/H3_NEEDS_CUDA/i.test(msg)) {
    return t('projects.h3_needs_cuda');
  }
  if (/H3_UNREACHABLE|H3_HTTP/i.test(msg)) {
    return t('projects.h3_unreachable');
  }
  if (/H3_MODEL_MISSING/i.test(msg)) {
    return t('projects.h3_missing');
  }
  if (/RUNWAY_KEY_REQUIRED/i.test(msg)) {
    return t('projects.no_runway');
  }
  if (/RUNWAY_AUTH/i.test(msg)) {
    return t('projects.runway_auth');
  }
  if (/IMAGE_REQUIRED/i.test(msg)) {
    return t('projects.need_product_still');
  }
  return msg;
}

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ProjectWorkspace(): ReactNode {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<ProjectDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyScene, setBusyScene] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<'still' | 'video' | 'import' | null>(null);
  const [composing, setComposing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [shotBusy, setShotBusy] = useState(false);
  const [assembleTarget, setAssembleTarget] = useState(10);

  const docRef = useRef<ProjectDoc | null>(null);
  docRef.current = doc;

  const persist = useCallback(async (next: ProjectDoc) => {
    docRef.current = next;
    setDoc(next);
    try {
      await window.api.saveProject(next);
    } catch (err) {
      setError(ipcMessage(err));
    }
  }, []);

  useEffect(() => {
    setDoc(null);
    setError(null);
    if (!projectId || !window.api?.loadProject) return;
    void window.api.loadProject(projectId).then((loaded) => {
      if (!loaded || loaded.id !== projectId) {
        setError(t('projects.missing'));
        return;
      }
      const next = {
        ...loaded,
        preset: normalizePreset(loaded.preset),
        brief: loaded.brief.trim() || t('projects.brief_default'),
        scenes: loaded.scenes.map((scene) => ({
          ...newScene(scene.title),
          ...scene,
          motion: normalizeShotMotion(scene.motion) || (scene.clipPath ? 'import' : scene.stillPath ? 'still_motion' : 'import'),
          prompt: scene.prompt.trim() ? scene.prompt : scene.title,
          effectPrompt: scene.effectPrompt.trim() ? scene.effectPrompt : t('projects.effect_default'),
        })),
        shots: (Array.isArray(loaded.shots) ? loaded.shots : []) as ProjectDoc['shots'],
        timeline: (loaded.timeline ?? null) as ProjectDoc['timeline'],
        productStillPath: loaded.productStillPath ?? null,
        assembledFingerprint: loaded.assembledFingerprint ?? null,
      } as ProjectDoc;
      writeLastProjectId(loaded.id);
      if (!loaded.brief.trim()) {
        void persist(next);
      } else {
        setDoc(next);
      }
    }).catch((err) => setError(ipcMessage(err)));
  }, [projectId, t, persist]);

  if (!doc) {
    return (
      <div className={styles.container}>
        <p className={styles.muted}>{error ?? t('projects.loading')}</p>
        <Link className={styles.backLink} to="/projects">{t('projects.back')}</Link>
      </div>
    );
  }

  const patch = (partial: Partial<ProjectDoc>) => {
    void persist({ ...doc, ...partial });
  };

  const patchScene = (id: string, partial: Partial<ProjectScene>) => {
    void persist({
      ...doc,
      scenes: doc.scenes.map((scene) => (scene.id === id ? { ...scene, ...partial } : scene)),
    });
  };

  const addScene = () => {
    void persist({
      ...doc,
      scenes: [...doc.scenes, newScene(t('projects.scene_n', { n: doc.scenes.length + 1 }))],
    });
  };

  const seedTemplateChapters = () => {
    void persist({
      ...doc,
      brief: doc.brief.trim() || t('projects.brief_default'),
      scenes: templateChapters(t),
    });
  };

  const removeScene = (id: string) => {
    void persist({ ...doc, scenes: doc.scenes.filter((scene) => scene.id !== id) });
  };

  const generateStillFile = async (scene: ProjectScene): Promise<string> => {
    if (!scene.prompt.trim() || !window.api?.generateImage) {
      throw new Error(t('projects.generate_fail'));
    }
    const result = await window.api.generateImage({
      prompt: insertStillPrompt(doc.brief, scene.prompt),
      format: doc.format === 'shorts' ? 'portrait' : 'wide',
      style: 'cinematic',
    });
    if (!result.file_path) throw new Error(t('projects.generate_fail'));
    const latest = docRef.current ?? doc;
    const copied = await window.api.importIntoProject({ projectId: latest.id, path: result.file_path });
    await persist({
      ...latest,
      assembledPath: null,
      scenes: latest.scenes.map((row) => (
        row.id === scene.id ? { ...row, stillPath: copied.file_path, clipPath: null, motion: 'still_motion' } : row
      )),
    });
    return copied.file_path;
  };

  const generateScene = async (scene: ProjectScene) => {
    if (!scene.prompt.trim() && !scene.stillPath) return;
    setBusyScene(scene.id);
    setBusyKind('still');
    setError(null);
    setStatus(t('projects.generating_scene'));
    try {
      await generateStillFile(scene);
      setStatus(t('projects.generated_ok'));
    } catch (err) {
      setError(ipcMessage(err));
    } finally {
      setBusyScene(null);
      setBusyKind(null);
    }
  };

  const generateSceneVideo = async (scene: ProjectScene) => {
    if (!window.api?.importIntoProject || !window.api.generateVideo) return;
    const latest = docRef.current ?? doc;
    const still = scene.stillPath;
    if (!still) {
      setError(t('projects.need_product_still'));
      return;
    }
    const motionModel = await window.api.getActiveVideoModel?.();
    if (!motionModel || !/runway|minimax|h3|ti2v|anes1032/i.test(motionModel)) {
      setError(t('projects.no_ai_video'));
      return;
    }
    const isH3 = /minimax|h3/i.test(motionModel);
    const isTi2v = /ti2v|anes1032/i.test(motionModel);
    setBusyScene(scene.id);
    setBusyKind('video');
    setError(null);
    setStatus(t(isTi2v ? 'projects.generating_motion' : isH3 ? 'projects.generating_h3' : 'projects.generating_runway'));
    try {
      const prompt = [latest.brief, scene.prompt || scene.title].filter(Boolean).join('\n\n');
      const clipSec = Math.max(5, Math.min(10, scene.durationSec || 5));
      const result = await window.api.generateVideo({
        prompt,
        format: latest.format === 'shorts' ? 'portrait' : 'wide',
        duration_sec: clipSec,
        model_id: motionModel,
        image_path: still,
        mode: 'ai_video',
      });
      if (!result.file_path) throw new Error(t('projects.generate_fail'));
      const copied = await window.api.importIntoProject({ projectId: latest.id, path: result.file_path });
      const duration = await window.api.probeMediaDuration(copied.file_path).catch(() => 2);
      const after = docRef.current ?? latest;
      await persist({
        ...after,
        assembledPath: null,
        scenes: after.scenes.map((row) => (
          row.id === scene.id
            ? { ...row, clipPath: copied.file_path, durationSec: duration > 0 ? Math.round(duration * 10) / 10 : 2, motion: 'i2v' }
            : row
        )),
      });
      setStatus(t(isTi2v ? 'projects.generated_motion_ok' : isH3 ? 'projects.generated_h3_ok' : 'projects.generated_runway_ok'));
    } catch (err) {
      setStatus(null);
      setError(motionErrorMessage(err, t));
    } finally {
      setBusyScene(null);
      setBusyKind(null);
    }
  };

  const pickProductStill = async () => {
    const picked = await window.api.pickImage?.();
    if (!picked || !window.api.importIntoProject) return;
    const latest = docRef.current ?? doc;
    try {
      const copied = await window.api.importIntoProject({ projectId: latest.id, path: picked });
      await persist({ ...(docRef.current ?? latest), productStillPath: copied.file_path });
    } catch (err) {
      setError(ipcMessage(err));
    }
  };

  const generateProductShots = async () => {
    if (!window.api?.generateVideo) return;
    const latest = docRef.current ?? doc;
    const still = latest.productStillPath;
    if (!still) {
      setError(t('projects.need_product_photo'));
      return;
    }
    const motionModel = await window.api.getActiveVideoModel?.();
    if (!motionModel || !/runway|minimax|h3|ti2v|anes1032/i.test(motionModel)) {
      setError(t('projects.no_ai_video'));
      return;
    }
    setShotBusy(true);
    setError(null);
    const presets = productShotPresets(latest.brief);
    let current = latest;
    try {
      for (let i = 0; i < presets.length; i += 1) {
        const spec = presets[i];
        setStatus(t('projects.generating_shot', { current: i + 1, total: presets.length }));
        const result = await window.api.generateVideo({
          prompt: spec.prompt,
          format: current.format === 'shorts' ? 'portrait' : 'wide',
          duration_sec: 1.7,
          model_id: motionModel,
          image_path: still,
          mode: 'ai_video',
          shot_index: i + 1,
          shot_total: presets.length,
        });
        if (!result.file_path) throw new Error(t('projects.generate_fail'));
        const duration = result.quality?.duration_sec
          ?? await window.api.probeMediaDuration(result.file_path).catch(() => 1.7);
        const shot = shotFromGeneration({
          path: result.file_path,
          prompt: spec.prompt,
          purpose: spec.purpose,
          provider: result.provider_id || motionModel,
          modelId: result.provider_id || motionModel,
          sourceAsset: still,
          projectId: current.id,
          quality: {
            ...result.quality,
            duration_sec: duration,
          },
          status: result.status,
        });
        current = docRef.current ?? current;
        current = {
          ...current,
          shots: [...(current.shots ?? []), shot],
        };
        await persist(current);
        setStatus(t('projects.shot_ready', { current: i + 1, total: presets.length }));
      }
      setStatus(t('projects.shots_done', { count: presets.length }));
    } catch (err) {
      setError(motionErrorMessage(err, t));
    } finally {
      setShotBusy(false);
    }
  };

  const openEditorFromShots = async (assemble: boolean, voice = false) => {
    const latest = docRef.current ?? doc;
    const usable = (latest.shots ?? []).filter((shot) => shot.validationStatus !== 'failed' && shot.artifactPath);
    if (usable.length < 1) {
      setError(t('projects.need_shots'));
      return;
    }
    let next = latest;
    if (assemble) {
      const plan = assembleShots({
        shots: latest.shots ?? [],
        targetSec: assembleTarget,
        productStillPath: latest.productStillPath,
      });
      const built = planToTimeline(plan);
      next = {
        ...latest,
        timeline: {
          bins: built.bins,
          clips: built.clips,
          trackLayout: plan.trackLayout,
          playhead: 0,
          pxPerSec: 16,
          assembly: {
            targetSec: plan.targetSec,
            style: plan.style,
            rationale: plan.rationale,
            createdAt: Date.now(),
          },
        },
      };
      await persist(next);
    }
    writeLastProjectId(next.id);
    navigate(`/video?project=${encodeURIComponent(next.id)}${voice ? '&voice=1' : ''}`);
  };

  const importStill = async (scene: ProjectScene) => {
    const picked = await window.api.pickImage?.();
    if (!picked || !window.api.importIntoProject) return;
    setBusyScene(scene.id);
    try {
      const latest = docRef.current ?? doc;
      const copied = await window.api.importIntoProject({ projectId: latest.id, path: picked });
      await persist({
        ...latest,
        assembledPath: null,
        scenes: latest.scenes.map((row) => (
          row.id === scene.id ? { ...row, stillPath: copied.file_path, clipPath: null, motion: 'still_motion' } : row
        )),
      });
    } catch (err) {
      setError(ipcMessage(err));
    } finally {
      setBusyScene(null);
    }
  };

  const importClip = async (scene: ProjectScene) => {
    const picked = await window.api.pickVideo?.();
    if (!picked || !window.api.importIntoProject) return;
    setBusyScene(scene.id);
    try {
      const latest = docRef.current ?? doc;
      const copied = await window.api.importIntoProject({ projectId: latest.id, path: picked });
      const duration = await window.api.probeMediaDuration(copied.file_path).catch(() => scene.durationSec);
      await persist({
        ...latest,
        scenes: latest.scenes.map((row) => (
          row.id === scene.id
            ? { ...row, clipPath: copied.file_path, durationSec: duration > 0 ? Math.round(duration * 10) / 10 : row.durationSec, motion: 'import' }
            : row
        )),
      });
    } catch (err) {
      setError(ipcMessage(err));
    } finally {
      setBusyScene(null);
    }
  };

  const compose = async (): Promise<string | null> => {
    const latest = docRef.current ?? doc;
    const clips = composeClips(latest);
    if (!clips.some((c) => c.track === 'v1') || !window.api.renderTimeline) {
      setError(t('projects.compose_need_media'));
      return null;
    }
    setComposing(true);
    setError(null);
    setStatus(t('projects.composing'));
    try {
      const rendered = await window.api.renderTimeline({
        clips,
        width: latest.format === 'shorts' ? 1080 : 1920,
        height: latest.format === 'shorts' ? 1920 : 1080,
        fps: 30,
      });
      const copied = await window.api.importIntoProject({ projectId: latest.id, path: rendered.file_path });
      await persist({ ...(docRef.current ?? latest), assembledPath: copied.file_path });
      setStatus(t('projects.composed_ok'));
      return copied.file_path;
    } catch (err) {
      setError(ipcMessage(err));
      return null;
    } finally {
      setComposing(false);
    }
  };

  const finishInVideo = async () => {
    const latest = docRef.current ?? doc;
    writeLastProjectId(latest.id);
    if ((latest.shots ?? []).some((shot) => shot.artifactPath)) {
      const hasCut = (latest.timeline?.clips ?? []).some((clip) => clip.track === 'v1');
      await openEditorFromShots(!hasCut, true);
      return;
    }
    if (!latest.scenes.some(sceneHasMedia)) {
      setError(t('projects.compose_need_media'));
      return;
    }
    let assembled = await compose();
    if (!assembled) return;
    const fresh = docRef.current ?? latest;
    navigate(`/video?project=${encodeURIComponent(fresh.id)}&voice=1`);
  };

  const useStillMotion = (scene: ProjectScene) => {
    if (!scene.stillPath) {
      setError(t('projects.need_product_still'));
      return;
    }
    patchScene(scene.id, { motion: 'still_motion', clipPath: null });
    setStatus(t('projects.still_motion_ok'));
  };

  const preset = doc.preset ?? 'marketplace';
  const hasShots = (doc.shots ?? []).some((shot) => shot.artifactPath);
  const hasSceneMedia = doc.scenes.some(sceneHasMedia);
  const canFinish = hasShots || hasSceneMedia;
  const filmStep = !doc.scenes.some(sceneHasMedia) ? 'shots' : doc.assembledPath ? 'voice' : 'picture';

  return (
    <div className={styles.container}>
      <header className={styles.workHead}>
        <Link className={styles.backLink} to="/projects">{t('projects.back')}</Link>
        <input
          className={styles.nameInput}
          value={doc.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
        <select
          className={styles.select}
          value={preset}
          onChange={(e) => {
            const next = e.target.value as FilmPreset;
            patch({ preset: next, format: formatForPreset(next) });
          }}
        >
          <option value="marketplace">{t('projects.preset_marketplace')}</option>
          <option value="hero">{t('projects.preset_hero')}</option>
          <option value="youtube">{t('projects.preset_youtube')}</option>
          <option value="shorts">{t('projects.preset_shorts')}</option>
        </select>
      </header>

      <ol className={styles.filmSteps}>
        <li data-on={filmStep === 'shots'}>{t('projects.step_shots')}</li>
        <li data-on={filmStep === 'picture'}>{t('projects.step_picture')}</li>
        <li data-on={filmStep === 'voice'}>{t('projects.step_voice')}</li>
      </ol>
      <p className={styles.lead}>{t(`projects.preset_lead_${preset}`)}</p>

      <section className={styles.productPanel}>
        <h2 className={styles.h2}>{t('projects.product_shots')}</h2>
        <p className={styles.muted}>{t('projects.product_shots_lead')}</p>
        <div className={styles.productRow}>
          <div className={styles.thumb}>
            {doc.productStillPath ? (
              <img src={toAssetUrl(doc.productStillPath)} alt="" />
            ) : (
              <span>📷</span>
            )}
          </div>
          <div className={styles.productActions}>
            <button type="button" className={styles.ghostBtn} onClick={() => void pickProductStill()} disabled={shotBusy}>
              {t('projects.pick_product_still')}
            </button>
            <button
              type="button"
              className={styles.newButton}
              disabled={shotBusy || busyScene !== null || !doc.productStillPath}
              onClick={() => void generateProductShots()}
            >
              {shotBusy ? t('projects.generating') : t('projects.generate_shots')}
            </button>
            <label className={styles.dur}>
              {t('projects.assemble_target')}
              <input
                type="number"
                min={4}
                max={30}
                step={1}
                value={assembleTarget}
                onChange={(e) => setAssembleTarget(Number(e.target.value) || 10)}
              />
            </label>
            <button
              type="button"
              className={styles.ghostBtn}
              disabled={shotBusy || (doc.shots ?? []).length === 0}
              onClick={() => void openEditorFromShots(true)}
            >
              {t('projects.assemble_and_edit')}
            </button>
            <button
              type="button"
              className={styles.textBtn}
              disabled={(doc.shots ?? []).length === 0}
              onClick={() => void openEditorFromShots(false)}
            >
              {t('projects.open_editor')}
            </button>
          </div>
        </div>
        {(doc.shots ?? []).length > 0 ? (
          <ul className={styles.shotChips}>
            {(doc.shots ?? []).map((shot, index) => (
              <li key={shot.id}>
                {index + 1}. {shot.shotPurpose.replaceAll('_', ' ')}
                {' · '}
                {shot.duration ? `${shot.duration.toFixed(1)}s` : '—'}
                {' · '}
                {shot.validationStatus}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <label className={styles.field}>
        <span>{t('projects.brief')}</span>
        <textarea
          rows={4}
          value={doc.brief}
          onChange={(e) => patch({ brief: e.target.value })}
          placeholder={t('projects.brief_ph')}
        />
      </label>

      <div className={styles.sceneHead}>
          <h2 className={styles.h2}>
          {t('projects.shots')}
          <span className={styles.count}>{doc.scenes.length} · {formatClock(projectDuration(doc))}</span>
        </h2>
        {doc.scenes.length === 0 ? (
          <button type="button" className={styles.newButton} onClick={seedTemplateChapters}>
            {t('projects.seed_chapters')}
          </button>
        ) : null}
        <button type="button" className={styles.ghostBtn} onClick={addScene}>
          {t('projects.add_shot')}
        </button>
      </div>

      {doc.scenes.length === 0 ? (
        <p className={styles.emptyHint}>{t('projects.scenes_empty')}</p>
      ) : (
        <ol className={styles.sceneList}>
          {doc.scenes.map((scene, index) => {
            const thumb = scene.stillPath || scene.clipPath;
            return (
              <li key={scene.id} className={styles.sceneCard}>
                <div className={styles.thumb}>
                  {thumb ? (
                    scene.clipPath && !scene.stillPath ? (
                      <video src={toAssetUrl(scene.clipPath)} muted playsInline />
                    ) : (
                      <img src={toAssetUrl(scene.stillPath ?? thumb)} alt="" />
                    )
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </div>
                <div className={styles.sceneBody}>
                  <div className={styles.sceneRow}>
                    <input
                      className={styles.inlineInput}
                      value={scene.title}
                      onChange={(e) => patchScene(scene.id, { title: e.target.value })}
                      placeholder={t('projects.scene_title_ph')}
                    />
                    <label className={styles.dur}>
                      {t('projects.seconds')}
                      <input
                        type="number"
                        min={0.5}
                        step={0.5}
                        value={scene.durationSec}
                        onChange={(e) => patchScene(scene.id, { durationSec: Number(e.target.value) || 5 })}
                      />
                    </label>
                    <button type="button" className={styles.textBtn} onClick={() => removeScene(scene.id)}>
                      {t('projects.remove')}
                    </button>
                  </div>
                  <label className={styles.sceneField}>
                    <span>{t('projects.shot_direction')}</span>
                    <textarea
                      rows={2}
                      value={scene.prompt}
                      onChange={(e) => patchScene(scene.id, { prompt: e.target.value })}
                      placeholder={t('projects.scene_prompt_ph')}
                    />
                  </label>
                  <div className={styles.sceneGrid}>
                    <label className={styles.sceneField}>
                      <span>{t('projects.text_label')}</span>
                      <input
                        className={styles.inlineInput}
                        value={scene.textOverlay}
                        onChange={(e) => patchScene(scene.id, { textOverlay: e.target.value })}
                        placeholder={t('projects.text_ph')}
                      />
                    </label>
                    <label className={styles.sceneField}>
                      <span>{t('projects.effect_label')}</span>
                      <input
                        className={styles.inlineInput}
                        value={scene.effectPrompt}
                        onChange={(e) => patchScene(scene.id, { effectPrompt: e.target.value })}
                        placeholder={t('projects.effect_ph')}
                      />
                    </label>
                  </div>
                  <div className={styles.sceneActions}>
                    <button
                      type="button"
                      className={styles.newButton}
                      disabled={busyScene === scene.id}
                      onClick={() => void importClip(scene)}
                    >
                      {t('projects.import_clip')}
                    </button>
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      disabled={busyScene === scene.id}
                      onClick={() => void importStill(scene)}
                    >
                      {t('projects.import_still')}
                    </button>
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      disabled={busyScene === scene.id || !scene.prompt.trim()}
                      onClick={() => void generateScene(scene)}
                    >
                      {busyScene === scene.id && busyKind === 'still' ? t('projects.generating') : t('projects.generate_still')}
                    </button>
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      disabled={busyScene === scene.id || !scene.stillPath}
                      onClick={() => useStillMotion(scene)}
                    >
                      {t('projects.use_still_motion')}
                    </button>
                    <button
                      type="button"
                      className={styles.textBtn}
                      disabled={busyScene === scene.id || !scene.stillPath}
                      onClick={() => void generateSceneVideo(scene)}
                    >
                      {busyScene === scene.id && busyKind === 'video' ? t('projects.generating') : t('projects.animate_optional')}
                    </button>
                    {scene.clipPath ? (
                      <span className={styles.ok}>{t(`projects.motion_${scene.motion ?? 'import'}`)}</span>
                    ) : scene.stillPath ? (
                      <span className={styles.ok}>{t('projects.motion_still_motion')}</span>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {(() => {
        const hasMedia = hasSceneMedia || hasShots;
        const step = !hasMedia ? 'scene' : 'voice';
        return (
          <aside className={styles.nextBox} data-step={step}>
            <strong>{t('projects.next_title')}</strong>
            <p data-on={step === 'scene'}>{t('projects.next_scene')}</p>
            <p data-on={step === 'voice'}>{t('projects.next_voice')}</p>
          </aside>
        );
      })()}

      <footer className={styles.composeBar}>
        {doc.assembledPath ? (
          <video className={styles.assembled} src={toAssetUrl(doc.assembledPath)} controls playsInline />
        ) : null}
        <button
          type="button"
          className={styles.newButton}
          disabled={composing || busyScene !== null || !canFinish}
          onClick={() => void finishInVideo()}
        >
          {composing ? t('projects.composing') : t('projects.finish_voice')}
        </button>
        <button
          type="button"
          className={styles.ghostBtn}
          disabled={composing || busyScene !== null || !doc.scenes.some(sceneHasMedia)}
          onClick={() => void compose()}
        >
          {t('projects.compose')}
        </button>
      </footer>
      {status ? <p className={styles.status}>{status}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}
