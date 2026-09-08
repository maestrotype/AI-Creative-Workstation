import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCreateStore } from '../../store/createStore';
import { useHomeStore } from '../../../home/store/homeStore';
import { filePathFromAssetUrl, useWorkspaceBridgeStore } from '../../../studio/store/workspaceBridgeStore';
import { DownloadIcon, ImageIcon, RefreshIcon, TrashIcon } from '../../../../shared/ui/icons';
import styles from './ResultStep.module.css';
import { cx } from '../../../../shared/lib/cx';

export function ResultStep(): ReactNode {
  const { t } = useTranslation();
  const result = useCreateStore((s) => s.result);
  const job = useCreateStore((s) => s.job);
  const prompt = useCreateStore((s) => s.prompt);
  const referenceImages = useCreateStore((s) => s.referenceImages);
  const tryVariation = useCreateStore((s) => s.tryVariation);
  const startOver = useCreateStore((s) => s.startOver);
  const removeAssetByUrl = useHomeStore((s) => s.removeAssetByUrl);
  const setLastImagePath = useWorkspaceBridgeStore((s) => s.setLastImagePath);
  const setPendingTitleCard = useWorkspaceBridgeStore((s) => s.setPendingTitleCard);
  const navigate = useNavigate();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [gradeBusy, setGradeBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const videoRef = referenceImages.find((ref) => ref.kind === 'video' && ref.sourcePath);

  useEffect(() => {
    const path = filePathFromAssetUrl(result?.thumbnailUrl);
    if (path) setLastImagePath(path);
  }, [result, setLastImagePath]);

  if (!result) return null;

  const sendToVideo = () => {
    const path = filePathFromAssetUrl(result.thumbnailUrl);
    if (path) {
      setLastImagePath(path);
      setPendingTitleCard(path);
    }
    navigate('/video');
  };

  const downloadStill = async () => {
    const path = filePathFromAssetUrl(result.thumbnailUrl);
    if (!path || !window.api?.saveMediaAs) return;
    setDownloadError(null);
    try {
      await window.api.saveMediaAs(path);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    }
  };

  const downloadGradedVideo = async () => {
    const videoPath = videoRef?.sourcePath;
    if (!videoPath || !window.api?.gradeVideo) return;
    setGradeBusy(true);
    setDownloadError(null);
    try {
      await window.api.rememberDroppedMedia?.(videoPath);
      const still = filePathFromAssetUrl(result.thumbnailUrl);
      const out = await window.api.gradeVideo({
        video_path: videoPath,
        prompt,
        overlay_path: still,
      });
      if (out.file_path) await window.api.saveMediaAs(out.file_path);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setGradeBusy(false);
    }
  };

  const discardResult = async () => {
    const path = filePathFromAssetUrl(result.thumbnailUrl);
    setDeleteBusy(true);
    setDownloadError(null);
    try {
      if (path && window.api?.deleteGeneratedStill) {
        await window.api.deleteGeneratedStill(path);
      }
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      removeAssetByUrl(result.thumbnailUrl);
      if (path) setLastImagePath(null);
      setDeleteBusy(false);
      startOver();
    }
  };

  return (
    <div className={styles.container}>
      <p className={styles.jobTag}>{t(`create.job_${job}`)}</p>
      <div className={styles.imageArea}>
        {result.thumbnailUrl ? (
          <img
            key={result.id}
            src={result.thumbnailUrl}
            alt={result.prompt}
            className={styles.generatedImage}
          />
        ) : (
          <div className={styles.placeholderContent}>
            <ImageIcon size={48} />
            <span>{t('create.status.generation_successful')}</span>
          </div>
        )}
      </div>

      <p className={styles.prompt}>
        "{result.prompt}"
      </p>
      {downloadError ? <p className={styles.error}>{downloadError}</p> : null}

      <div className={styles.actions}>
        <button
          type="button"
          className={cx(styles.actionButton, styles.primaryAction)}
          onClick={tryVariation}
        >
          <RefreshIcon size={18} />
          {t('create.btn_try_variations')}
        </button>

        <button type="button" className={styles.actionButton} onClick={() => { void downloadStill(); }}>
          <DownloadIcon size={18} />
          {t('create.btn_download_image')}
        </button>

        {videoRef ? (
          <button
            type="button"
            className={styles.actionButton}
            disabled={gradeBusy}
            onClick={() => { void downloadGradedVideo(); }}
          >
            <DownloadIcon size={18} />
            {gradeBusy ? t('create.btn_grading_video') : t('create.btn_download_video')}
          </button>
        ) : null}

        {job === 'product' ? (
          <>
            <Link to="/threed" className={styles.actionButton}>
              {t('create.btn_send_3d')}
            </Link>
            <Link to="/assets" className={styles.actionButton}>
              {t('create.btn_open_assets')}
            </Link>
            <button type="button" className={styles.actionButton} onClick={sendToVideo}>
              {t('create.btn_send_video_insert')}
            </button>
          </>
        ) : (
          <>
            <button type="button" className={styles.actionButton} onClick={sendToVideo}>
              {job === 'frame' ? t('create.btn_send_video_frame') : t('create.btn_send_video')}
            </button>
            <Link to="/threed" className={styles.actionButton}>
              {t('create.btn_send_3d')}
            </Link>
            <Link to="/assets" className={styles.actionButton}>
              {t('create.btn_open_assets')}
            </Link>
          </>
        )}
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.actionButton} onClick={startOver}>
          {t('create.btn_start_over')}
        </button>
        <button
          type="button"
          className={cx(styles.actionButton, styles.dangerAction)}
          disabled={deleteBusy}
          onClick={() => { void discardResult(); }}
        >
          <TrashIcon size={18} />
          {t('create.btn_delete_result')}
        </button>
      </div>
    </div>
  );
}
