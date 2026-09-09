import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { studioHref } from '../model/studioReturn';
import styles from './WorkspaceFlow.module.css';

type FlowKind = 'create' | 'video' | 'threed' | 'assets' | 'projects';

interface WorkspaceFlowProps {
  kind: FlowKind;
}

export function WorkspaceFlow({ kind }: WorkspaceFlowProps): ReactNode {
  const { t } = useTranslation();
  const [imageEngine, setImageEngine] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!window.api) return;
      const [models, active] = await Promise.all([window.api.getModels(), window.api.getActiveModel()]);
      const name = models.find((m: { id: string }) => m.id === active)?.name ?? active;
      if (!cancelled) setImageEngine(name);
    };
    void load();
    return window.api?.onModelsUpdated(() => { void load(); }) ?? (() => {});
  }, []);

  const fromPath = {
    create: '/create',
    video: '/video',
    threed: '/threed',
    assets: '/assets',
    projects: '/projects',
  }[kind];

  const links: { to: string; label: string }[] = {
    create: [
      { to: studioHref('image', fromPath), label: t('flow.to_studio_image') },
      { to: studioHref('video', fromPath), label: t('flow.to_studio_video') },
      { to: '/threed', label: t('flow.to_threed') },
      { to: '/assets', label: t('flow.to_assets') },
    ],
    video: [
      { to: '/projects', label: t('flow.to_projects') },
      { to: studioHref('image', fromPath), label: t('flow.to_studio_image') },
      { to: studioHref('video', fromPath), label: t('flow.to_studio_video') },
      { to: '/create', label: t('flow.to_create') },
      { to: '/assets', label: t('flow.to_assets') },
      { to: '/threed', label: t('flow.to_threed') },
    ],
    projects: [
      { to: '/create', label: t('flow.to_create') },
      { to: '/assets', label: t('flow.to_assets') },
      { to: studioHref('image', fromPath), label: t('flow.to_studio_image') },
    ],
    threed: [
      { to: studioHref('3d', fromPath), label: t('flow.to_studio_3d') },
      { to: '/create', label: t('flow.to_create') },
      { to: '/assets', label: t('flow.to_assets') },
      { to: '/video', label: t('flow.to_voiceover') },
    ],
    assets: [
      { to: '/create', label: t('flow.to_create') },
      { to: '/threed', label: t('flow.to_threed') },
      { to: '/video', label: t('flow.to_voiceover') },
      { to: studioHref('image', fromPath), label: t('flow.to_studio') },
    ],
  }[kind];

  return (
    <section className={styles.flow}>
      <p className={styles.uses}>
        {t(`flow.${kind}.uses`, { engine: imageEngine ?? t('flow.no_image_engine') })}
      </p>
      <div className={styles.links}>
        {links.map((link) => (
          <Link key={link.to} className={styles.link} to={link.to}>
            {link.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
