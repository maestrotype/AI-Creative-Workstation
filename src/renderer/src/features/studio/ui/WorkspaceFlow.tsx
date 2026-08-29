import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import styles from './WorkspaceFlow.module.css';

type FlowKind = 'create' | 'video' | 'threed' | 'assets';

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

  const links: { to: string; label: string }[] = {
    create: [
      { to: '/studio?family=image', label: t('flow.to_studio_image') },
      { to: '/video', label: t('flow.to_video') },
      { to: '/threed', label: t('flow.to_threed') },
      { to: '/assets', label: t('flow.to_assets') },
    ],
    video: [
      { to: '/studio?family=image', label: t('flow.to_studio_image') },
      { to: '/studio?family=video', label: t('flow.to_studio_video') },
      { to: '/create', label: t('flow.to_create') },
      { to: '/assets', label: t('flow.to_assets') },
      { to: '/threed', label: t('flow.to_threed') },
    ],
    threed: [
      { to: '/studio?family=3d', label: t('flow.to_studio_3d') },
      { to: '/create', label: t('flow.to_create') },
      { to: '/assets', label: t('flow.to_assets') },
      { to: '/video', label: t('flow.to_video') },
    ],
    assets: [
      { to: '/create', label: t('flow.to_create') },
      { to: '/threed', label: t('flow.to_threed') },
      { to: '/video', label: t('flow.to_video') },
      { to: '/studio', label: t('flow.to_studio') },
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
