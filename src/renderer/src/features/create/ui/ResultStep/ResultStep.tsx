import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCreateStore } from '../../store/createStore';
import { useHomeStore } from '../../../home/store/homeStore';
import { filePathFromAssetUrl, useWorkspaceBridgeStore } from '../../../studio/store/workspaceBridgeStore';
import { attachGeneratedToFilm } from '../../../projects/model/attachToFilm';
import { DownloadIcon, ImageIcon, RefreshIcon, TrashIcon } from '../../../../shared/ui/icons';
import styles from './ResultStep.module.css';
import { cx } from '../../../../shared/lib/cx';

function ResultVideo({ src, label }: { src: string; label: string }): ReactNode {
  const ref = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
    } else {
      el.pause();
    }
  };

  return (
    <button type="button" className={styles.videoHit} onClick={toggle} aria-label={label}>
      <video
        ref={ref}
        src={src}
        className={styles.generatedImage}
        preload="auto"
        playsInline
        autoPlay
        loop
        muted
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
      />
      {paused ? <span className={styles.playMark} aria-hidden="true" /> : null}
    </button>
  );
}

export function ResultStep(): ReactNode {
  const { t } = useTranslation();
  const result = useCreateStore((s) => s.result);
  const job = useCreateStore((s) => s.job);
  const prompt = useCreateStore((s) => s.prompt);
  const referenceImages = useCreateStore((s) => s.referenceImages);
  const tryVariation = useCreateStore((s) => s.tryVariation);
  const startOver = useCreateStore((s) => s.startOver);
  const makeClipFromResult = useCreateStore((s) => s.makeClipFromResult);
  const animateFromResult = useCreateStore((s) => s.animateFromResult);
  const removeAssetByUrl = useHomeStore((s) => s.removeAssetByUrl);
  const setLastImagePath = useWorkspaceBridgeStore((s) => s.setLastImagePath);
  const setPendingTitleCard = useWorkspaceBridgeStore((s) => s.setPendingTitleCard);
  const navigate = useNavigate();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [gradeBusy, setGradeBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [filmBusy, setFilmBusy] = useState(false);
  const [filmStatus, setFilmStatus] = useState<string | null>(null);
  const [filmId, setFilmId] = useState<string | null>(null);

  const videoRef = referenceImages.find((ref) => ref.kind === 'video' && ref.sourcePath);

  useEffect(() => {
    const path = filePathFromAssetUrl(result?.thumbnailUrl);
    if (path) setLastImagePath(path);
  }, [result, setLastImagePath]);

  if (!result) return null;
  const resultPath = filePathFromAssetUrl(result.thumbnailUrl);
  const isVideoResult = result.kind === 'video' || Boolean(resultPath && /\.(mp4|mov|m4v|webm|mkv)$/i.test(resultPath));
  const promptIsJobId = /^vid_[a-f0-9]+$/i.test(result.prompt.trim());
  const isSvd = result.capability === 'IMAGE_ANIMATION' || result.promptConsumed === false;
  const isAiVideo = result.capability === 'IMAGE_TO_VIDEO' || result.promptConsumed === true;

  const sendToVideo = async () => {
    const path = filePathFromAssetUrl(result.thumbnailUrl);
    if (!path) {
      setDownloadError(t('create.error.need_still'));
      return;
    }
    setFilmBusy(true);
    setDownloadError(null);
    try {
      const film = await attachGeneratedToFilm({
        path,
        kind: isVideoResult ? 'video' : 'image',
        prompt: result.prompt,
        quality: result.quality,
        status: result.videoStatus,
      });
      setFilmId(film.projectId);
      if (!isVideoResult) {
        setLastImagePath(path);
        setPendingTitleCard(path);
      }
      navigate(`/video?project=${encodeURIComponent(film.projectId)}&voice=1`);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setFilmBusy(false);
    }
  };

  const addToFilm = async () => {
    const path = filePathFromAssetUrl(result.thumbnailUrl);
    if (!path) return;
    setFilmBusy(true);
    setFilmStatus(null);
    setDownloadError(null);
    try {
      const film = await attachGeneratedToFilm({
        path,
        kind: isVideoResult ? 'video' : 'image',
        prompt: result.prompt,
        quality: result.quality,
        status: result.videoStatus,
      });
      setFilmId(film.projectId);
      setFilmStatus(t('create.added_to_film', { name: film.name }));
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setFilmBusy(false);
    }
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
      <p className={styles.jobTag}>
        {t(
          isVideoResult
            ? (result.capability === 'IMAGE_ANIMATION' ? 'create.medium_animate' : 'create.medium_video')
            : `create.job_${job}`,
        )}
      </p>
      <div className={styles.imageArea}>
        {result.thumbnailUrl ? (
          isVideoResult ? (
            <ResultVideo
              key={result.id}
              src={result.thumbnailUrl}
              label={t('create.preview_toggle')}
            />
          ) : (
            <img
              key={result.id}
              src={result.thumbnailUrl}
              alt={result.prompt}
              className={styles.generatedImage}
            />
          )
        ) : (
          <div className={styles.placeholderContent}>
            <ImageIcon size={48} />
            <span>{t('create.status.generation_successful')}</span>
          </div>
        )}
      </div>

      <p className={styles.prompt}>
        {isVideoResult && promptIsJobId
          ? t('create.clip_unnamed')
          : `"${result.prompt}"`}
      </p>
      {isVideoResult ? (
        <>
          <p className={styles.hint}>
            {isSvd
              ? t('create.clip_animation_hint')
              : isAiVideo
                ? t('create.clip_ai_hint')
                : t('create.clip_library_hint')}
          </p>
          <p className={styles.quality}>
            {t('create.quality_ok', {
              provider: result.providerId
                ? (result.providerId.split('/').pop() || result.providerId)
                : t('create.provider_unknown'),
              duration: result.quality?.duration_sec ?? '—',
              motion: result.quality?.motion_score == null
                ? t('create.quality_motion_unknown')
                : t('create.quality_motion_good'),
            })}
          </p>
          {result.quality?.identity_warning ? (
            <p className={styles.warn}>{t('create.quality_identity')}</p>
          ) : null}
          {result.quality?.low_motion || result.videoStatus === 'low_motion' ? (
            <p className={styles.warn}>{t('create.quality_low_motion')}</p>
          ) : null}
          {result.quality?.prompt_intent ? (
            <p className={styles.hint}>{t(`create.intent_${result.quality.prompt_intent}`)}</p>
          ) : null}
          <p className={styles.hint}>{t('create.preview_click')}</p>
          {(result.quality?.duration_sec ?? 0) > 0 && (result.quality?.duration_sec ?? 0) < 4 ? (
            <p className={styles.hint}>{t('create.clip_short_local')}</p>
          ) : null}
          {filmStatus ? (
            <p className={styles.hint}>
              {filmStatus}
              {filmId ? (
                <>
                  {' '}
                  <button type="button" className={styles.actionButton} onClick={() => navigate(`/projects/${filmId}`)}>
                    {t('create.btn_open_film')}
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
          <details className={styles.details}>
            <summary>{t('create.quality_details')}</summary>
            <pre>
              {JSON.stringify(
                {
                  capability: result.capability,
                  providerId: result.providerId,
                  promptConsumed: result.promptConsumed,
                  ...result.quality,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </>
      ) : null}
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

        {!isVideoResult ? (
          <>
            <button type="button" className={styles.actionButton} onClick={makeClipFromResult}>
              {t('create.btn_make_clip')}
            </button>
            <button type="button" className={styles.actionButton} onClick={animateFromResult}>
              {t('create.btn_animate')}
            </button>
          </>
        ) : null}

        {isVideoResult ? (
          <button
            type="button"
            className={styles.actionButton}
            disabled={filmBusy}
            onClick={() => { void addToFilm(); }}
          >
            {t('create.btn_add_to_film')}
          </button>
        ) : (
          <button
            type="button"
            className={styles.actionButton}
            disabled={filmBusy}
            onClick={() => { void addToFilm(); }}
          >
            {t('home.use_as_product')}
          </button>
        )}

        <button type="button" className={styles.actionButton} onClick={() => { void downloadStill(); }}>
          <DownloadIcon size={18} />
            {t(isVideoResult ? 'create.btn_download_video_file' : 'create.btn_download_image')}
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
            <button type="button" className={styles.actionButton} disabled={filmBusy} onClick={() => { void sendToVideo(); }}>
              {t('create.btn_send_video_insert')}
            </button>
          </>
        ) : (
          <>
            <button type="button" className={styles.actionButton} disabled={filmBusy} onClick={() => { void sendToVideo(); }}>
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
