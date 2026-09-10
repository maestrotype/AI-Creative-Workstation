import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import type { Asset } from '../../../core/types';
import { filePathFromAssetUrl } from '../../studio/store/workspaceBridgeStore';
import { fetchRecentAssets } from '../../home/api/assetApi';
import { AssetCard } from '../../home/ui/AssetCard/AssetCard';
import { useHomeStore } from '../../home/store/homeStore';
import { attachGeneratedToFilm } from '../../projects/model/attachToFilm';
import { useCreateStore } from '../../create/store/createStore';
import styles from './AssetsPage.module.css';

export function MediaLibrary(): ReactNode {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const deleteRecentAsset = useHomeStore((s) => s.deleteRecentAsset);
  const openFromAsset = useCreateStore((s) => s.openFromAsset);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [filter, setFilter] = useState<'all' | 'video' | 'image'>('all');
  const [note, setNote] = useState<string | null>(null);
  const [filmOpenId, setFilmOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = async () => {
    setStatus('loading');
    try {
      const rows = await fetchRecentAssets(80);
      setAssets(rows);
      setStatus('ready');
    } catch {
      setAssets([]);
      setStatus('error');
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const shown = assets.filter((asset) => (filter === 'all' ? true : asset.kind === filter));
  const clips = assets.filter((asset) => asset.kind === 'video').length;
  const stills = assets.filter((asset) => asset.kind === 'image').length;

  const pathOf = (asset: Asset) => (
    asset.id.startsWith('/') ? asset.id : filePathFromAssetUrl(asset.thumbnailUrl)
  );

  const addToFilm = async (asset: Asset) => {
    const path = pathOf(asset);
    if (!path) return;
    setBusyId(asset.id);
    try {
      const film = await attachGeneratedToFilm({
        path,
        kind: asset.kind === 'video' ? 'video' : 'image',
        prompt: asset.prompt || asset.name,
      });
      setFilmOpenId(film.projectId);
      setNote(
        asset.kind === 'video'
          ? t('assets.media_added_clip', { name: film.name })
          : t('assets.media_added_still', { name: film.name }),
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const download = (asset: Asset) => {
    const path = pathOf(asset);
    if (!path || !window.api?.saveMediaAs) return;
    void window.api.saveMediaAs(path).catch(() => undefined);
  };

  return (
    <section className={styles.mediaSection}>
      <div className={styles.mediaHead}>
        <div>
          <h2 className={styles.mediaTitle}>{t('assets.media_title')}</h2>
          <p className={styles.mediaLead}>{t('assets.media_lead')}</p>
        </div>
        <Link className={styles.mediaLink} to="/projects">{t('assets.media_open_films')}</Link>
      </div>

      <p className={styles.how}>{t('assets.media_how')}</p>

      <div className={styles.mediaFilters}>
        {([
          ['all', t('assets.media_filter_all', { count: assets.length })],
          ['video', t('assets.media_filter_clips', { count: clips })],
          ['image', t('assets.media_filter_stills', { count: stills })],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={styles.filter}
            data-on={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {note ? (
        <p className={styles.mediaNote}>
          {note}
          {filmOpenId ? (
            <>
              {' '}
              <Link className={styles.mediaLink} to={`/projects/${filmOpenId}`}>
                {t('assets.media_open_this_film')}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      {status === 'loading' ? <p className={styles.mediaEmpty}>{t('assets.media_loading')}</p> : null}
      {status === 'error' ? (
        <p className={styles.mediaEmpty}>
          {t('home.could_not_load_assets')}{' '}
          <button type="button" className={styles.filter} onClick={() => { void reload(); }}>
            {t('home.try_again')}
          </button>
        </p>
      ) : null}
      {status === 'ready' && shown.length === 0 ? (
        <p className={styles.mediaEmpty}>{t('assets.media_empty')}</p>
      ) : null}

      {status === 'ready' && shown.length > 0 ? (
        <ul className={styles.mediaGrid}>
          {shown.map((asset) => (
            <li key={asset.id}>
              <AssetCard
                asset={asset}
                autoPlay={false}
                onOpen={(item) => {
                  openFromAsset(item);
                  navigate('/create');
                }}
                onUse={busyId === asset.id ? undefined : (item) => { void addToFilm(item); }}
                useLabel={
                  asset.kind === 'video' ? t('home.use_in_film') : t('home.use_as_product')
                }
                onDownload={download}
                onDelete={(item) => {
                  void deleteRecentAsset(item).then(() => reload());
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
