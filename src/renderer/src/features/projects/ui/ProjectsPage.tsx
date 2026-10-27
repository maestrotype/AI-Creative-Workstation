import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { toAssetUrl } from '../../video/model/directorMedia';
import { fileName } from '../../video/model/directorTimeline';
import {
  marketplaceFilmSeed,
  newScene,
  timelineFromScenes,
  type ProjectDoc,
  type ProjectSummary,
} from '../model/project';
import { ECOMMERCE_TEMPLATE_ID, scenesFromTemplate } from '../model/filmTemplate';
import { clearLastProjectId, editorHref, readLastProjectId, scriptHref, writeLastProjectId } from '../model/handoff';
import type { FilmTemplate } from '../../../../../shared/filmTemplate';
import styles from './ProjectsPage.module.css';

function ipcMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').trim();
}

function formatAgo(ts: number, locale: string): string {
  const delta = Date.now() - ts;
  const min = Math.round(delta / 60000);
  if (min < 1) return locale.startsWith('ru') ? 'только что' : 'just now';
  if (min < 60) return locale.startsWith('ru') ? `${min} мин назад` : `${min}m ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return locale.startsWith('ru') ? `${hrs} ч назад` : `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return locale.startsWith('ru') ? `${days} дн назад` : `${days}d ago`;
}

export function ProjectsPage(): ReactNode {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<ProjectSummary[]>([]);
  const [templates, setTemplates] = useState<FilmTemplate[]>([]);
  const [templateId, setTemplateId] = useState(ECOMMERCE_TEMPLATE_ID);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = async () => {
    if (!window.api?.listProjects) return;
    try {
      const list = await window.api.listProjects();
      setItems(list);
    } catch (err) {
      setError(ipcMessage(err));
    }
  };

  useEffect(() => {
    void refresh();
    if (!window.api?.listFilmTemplates) return;
    void window.api.listFilmTemplates().then(setTemplates).catch((err) => setError(ipcMessage(err)));
  }, []);

  const create = async () => {
    if (!window.api?.createProject) return;
    setCreating(true);
    setError(null);
    try {
      const doc = await window.api.createProject({
        name: t('projects.untitled'),
        format: 'landscape',
        preset: 'youtube',
        templateId: null,
      });
      writeLastProjectId(doc.id);
      navigate(editorHref(doc.id));
    } catch (err) {
      setError(ipcMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const importVideo = async () => {
    if (!window.api?.pickVideo || !window.api.createProject || !window.api.importIntoProject) return;
    const picked = await window.api.pickVideo();
    if (!picked) return;
    setCreating(true);
    setError(null);
    let createdId: string | null = null;
    try {
      const sourceName = fileName(picked);
      const name = sourceName.replace(/\.[^.]+$/, '') || t('projects.untitled');
      const doc = await window.api.createProject({
        name,
        format: 'landscape',
        preset: 'youtube',
        templateId: null,
      });
      createdId = doc.id;
      const copied = await window.api.importIntoProject({ projectId: doc.id, path: picked });
      const duration = await window.api.probeMediaDuration(copied.file_path).catch(() => 12);
      const scene = {
        ...newScene(t('projects.imported_video_chapter')),
        clipPath: copied.file_path,
        stillPath: copied.poster_path ?? null,
        durationSec: Math.max(0.5, Math.round(duration * 10) / 10),
        motion: 'import' as const,
      };
      const next = {
        ...doc,
        templateId: null,
        brief: '',
        scenes: [scene],
      } as ProjectDoc;
      await window.api.saveProject({
        ...next,
        timeline: timelineFromScenes(next),
      });
      writeLastProjectId(doc.id);
      navigate(editorHref(doc.id));
    } catch (err) {
      if (createdId) await window.api.deleteProject?.(createdId).catch(() => undefined);
      setError(ipcMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const createTemplate = async () => {
    if (!window.api?.createProject || !window.api.saveProject) return;
    setCreating(true);
    setError(null);
    try {
      const seed = marketplaceFilmSeed();
      const doc = await window.api.createProject({
        name: seed.name,
        preset: 'marketplace',
      });
      await window.api.saveProject({
        ...doc,
        name: seed.name,
        preset: 'marketplace',
        format: 'landscape',
        templateId: ECOMMERCE_TEMPLATE_ID,
        brief: seed.brief,
        scenes: seed.scenes,
        voiceover: seed.voiceover,
      });
      writeLastProjectId(doc.id);
      navigate(scriptHref(doc.id));
    } catch (err) {
      setError(ipcMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const createFromTemplate = async () => {
    if (templateId === ECOMMERCE_TEMPLATE_ID) {
      await createTemplate();
      return;
    }
    const template = templates.find((row) => row.id === templateId);
    if (!template || !window.api?.createProject || !window.api.saveProject) return;
    setCreating(true);
    setError(null);
    try {
      const doc = await window.api.createProject({
        name: template.name,
        format: template.format,
        preset: template.format === 'shorts' ? 'shorts' : 'youtube',
        templateId: template.id,
      });
      await window.api.saveProject({
        ...doc,
        name: template.name,
        preset: template.format === 'shorts' ? 'shorts' : 'youtube',
        format: template.format,
        templateId: template.id,
        brief: template.brief,
        scenes: scenesFromTemplate(template.chapters),
        voiceover: null,
      });
      writeLastProjectId(doc.id);
      navigate(scriptHref(doc.id));
    } catch (err) {
      setError(ipcMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.api?.deleteProject) return;
    if (!window.confirm(t('projects.delete_confirm', { name }))) return;
    await window.api.deleteProject(id);
    clearLastProjectId(id);
    await refresh();
  };

  const lastId = readLastProjectId();
  const lastItem = lastId ? items.find((item) => item.id === lastId) : undefined;

  const templateStart = () => (
    <>
      <label className={styles.headSelect}>
        <span>{t('projects.template_label')}</span>
        <select
          className={styles.select}
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          disabled={creating}
        >
          <option value={ECOMMERCE_TEMPLATE_ID}>{t('projects.template_ecommerce')}</option>
          {templates.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
      </label>
      <button type="button" className={styles.ghostBtn} onClick={() => void createFromTemplate()} disabled={creating}>
        {t('projects.create_from_template')}
      </button>
    </>
  );

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('projects.title')}</h1>
          <p className={styles.lead}>{t('projects.lead')}</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.ghostBtn} to="/video">
            {t('projects.dub_existing')}
          </Link>
          <button type="button" className={styles.newButton} onClick={() => void create()} disabled={creating}>
            {creating ? t('projects.creating') : t('projects.new_project')}
          </button>
        </div>
      </header>

      {lastItem ? (
        <button
          type="button"
          className={styles.continueBar}
          onClick={() => navigate(editorHref(lastItem.id))}
        >
          <strong>{t('projects.continue', { name: lastItem.name })}</strong>
          <span>{t('projects.continue_hint')}</span>
        </button>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.startOptions}>
        <button type="button" className={styles.startOption} onClick={() => void create()} disabled={creating}>
          <strong>{t('projects.start_blank')}</strong>
          <span>{t('projects.start_blank_hint')}</span>
        </button>
        <button type="button" className={styles.startOption} onClick={() => void importVideo()} disabled={creating}>
          <strong>{t('projects.start_import')}</strong>
          <span>{t('projects.start_import_hint')}</span>
        </button>
        <div className={styles.startOption}>
          <strong>{t('projects.start_template')}</strong>
          <span>{t('projects.start_template_hint')}</span>
          <div className={styles.startTemplateControls}>{templateStart()}</div>
        </div>
      </section>

      {items.length === 0 ? (
        <div className={styles.placeholder}>
          <p>{t('projects.empty')}</p>
        </div>
      ) : (
        <ul className={styles.grid}>
          <li>
            <button
              type="button"
              className={styles.createCard}
              onClick={() => void create()}
              disabled={creating}
            >
              <div className={styles.createCardIcon}>+</div>
              <span className={styles.createCardTitle}>{t('projects.new_project')}</span>
              <span className={styles.createCardHint}>{t('projects.create_card_hint')}</span>
            </button>
          </li>
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className={styles.card} onClick={() => navigate(editorHref(item.id))}>
                <div className={styles.cover}>
                  {item.coverPath ? (
                    /\.(mp4|mov|m4v|webm|mkv)$/i.test(item.coverPath) ? (
                      <video src={toAssetUrl(item.coverPath)} muted playsInline />
                    ) : (
                      <img src={toAssetUrl(item.coverPath)} alt="" />
                    )
                  ) : (
                    <span>{t('projects.no_cover')}</span>
                  )}
                </div>
                <div className={styles.cardBody}>
                  <strong>{item.name}</strong>
                  <span>
                    {item.format === 'shorts' ? t('projects.format_shorts') : t('projects.format_landscape')}
                    {' · '}
                    {t('projects.scene_count', { count: item.sceneCount })}
                    {' · '}
                    {formatAgo(item.updatedAt, i18n.language)}
                  </span>
                </div>
              </button>
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    writeLastProjectId(item.id);
                    navigate(scriptHref(item.id));
                  }}
                >
                  {t('projects.open_in_editor')}
                </button>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    writeLastProjectId(item.id);
                    navigate(editorHref(item.id, true));
                  }}
                >
                  {t('projects.narrate_film')}
                </button>
                <button
                  type="button"
                  className={styles.cardDelete}
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(item.id, item.name);
                  }}
                >
                  {t('projects.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
