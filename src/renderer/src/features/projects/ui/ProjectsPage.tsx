import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { toAssetUrl } from '../../video/model/directorMedia';
import { templateChapters, type ProjectSummary } from '../model/project';
import { clearLastProjectId, readLastProjectId, writeLastProjectId } from '../model/handoff';
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
  }, []);

  const create = async () => {
    if (!window.api?.createProject) return;
    setCreating(true);
    setError(null);
    try {
      const doc = await window.api.createProject({
        name: t('projects.untitled'),
        preset: 'marketplace',
      });
      const seeded = {
        ...doc,
        brief: t('projects.brief_default'),
        scenes: templateChapters(t),
      };
      await window.api.saveProject(seeded);
      writeLastProjectId(doc.id);
      navigate(`/projects/${doc.id}`);
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
          onClick={() => navigate(`/projects/${lastItem.id}`)}
        >
          <strong>{t('projects.continue', { name: lastItem.name })}</strong>
          <span>{t('projects.continue_hint')}</span>
        </button>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}

      {items.length === 0 ? (
        <div className={styles.placeholder}>
          <p>{t('projects.empty')}</p>
          <button type="button" className={styles.newButton} onClick={() => void create()} disabled={creating}>
            {t('projects.new_project')}
          </button>
        </div>
      ) : (
        <ul className={styles.grid}>
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className={styles.card} onClick={() => navigate(`/projects/${item.id}`)}>
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
