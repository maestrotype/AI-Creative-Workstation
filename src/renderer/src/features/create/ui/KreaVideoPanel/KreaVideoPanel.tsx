import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, DragEvent, ReactNode } from 'react';

import {
  VIDEO_PROVIDERS,
  sortProviders,
  type ModelSortKey,
  type VideoProviderSpec,
} from '../../model/videoCapability';
import type { ReferenceImage } from '../../../../shared/ui/IntentInput/IntentInput';
import { videoToFrame } from '../../../../shared/ui/IntentInput/IntentInput';
import type { GenerationFormat } from '../../api/generationApi';
import { toAssetUrl } from '../../../video/model/directorMedia';
import styles from './KreaVideoPanel.module.css';

interface KreaVideoPanelProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  activeModelId: string;
  onModelChange: (modelId: string) => void;
  referenceImages: readonly ReferenceImage[];
  onReferencesChange: (images: ReferenceImage[]) => void;
  durationSec: number;
  onDurationChange: (duration: number) => void;
  format: GenerationFormat;
  onFormatChange: (format: GenerationFormat) => void;
  onGenerate: () => void;
  canGenerate: boolean;
  readyModelIds: readonly string[];
}

const ELO_RATINGS: Record<string, number> = {
  'tencent/HunyuanVideo': 1195,
  'alibaba/wan3.0-video': 1190,
  'seedance/seedance-2.5': 1184,
  'kling-ai/kling-4.0': 1178,
  'runwayml/gen4.5': 1172,
  'MiniMaxAI/MiniMax-H3': 1162,
  'Lightricks/LTX-Video': 1152,
  'THUDM/CogVideoX-5B': 1148,
  'Anes1032/Wan2.2-TI2V-5B-mlx-q8': 1145,
  'luma/dream-machine-1.6': 1138,
  'Wan-AI/Wan2.1-T2V-1.3B-Diffusers': 1090,
  'stabilityai/stable-video-diffusion-img2vid-xt': 1050,
};

const MODEL_ICONS: Record<string, string> = {
  'tencent/HunyuanVideo': '🐉',
  'alibaba/wan3.0-video': '☁️',
  'Lightricks/LTX-Video': '⚡',
  'THUDM/CogVideoX-5B': '🤖',
  'seedance/seedance-2.5': '✨',
  'kling-ai/kling-4.0': '🎬',
  'MiniMaxAI/MiniMax-H3': '🌀',
  'Anes1032/Wan2.2-TI2V-5B-mlx-q8': '💻',
  'runwayml/gen4.5': '🌟',
  'luma/dream-machine-1.6': '🔮',
  'Wan-AI/Wan2.1-T2V-1.3B-Diffusers': '🎞️',
  'stabilityai/stable-video-diffusion-img2vid-xt': '🌊',
};

const API_KEY_NAMES: Record<string, { key: string; label: string }> = {
  'kling-ai/kling-4.0': { key: 'KLING_API_KEY', label: 'Kling API Key' },
  'seedance/seedance-2.5': { key: 'SEEDANCE_API_KEY', label: 'Seedance / fal.ai Key' },
  'alibaba/wan3.0-video': { key: 'DASHSCOPE_API_KEY', label: 'DashScope / Qwen Cloud Key' },
  'runwayml/gen4.5': { key: 'RUNWAY_API_SECRET', label: 'Runway API Secret' },
  'luma/dream-machine-1.6': { key: 'LUMA_API_KEY', label: 'Luma API Key' },
};

/**
 * Local models that freeze Apple Silicon during weight load.
 * Hunyuan 13B was briefly unlocked with “compact” settings — load still hangs the Mac.
 */
function isCudaOnlyLocal(modelId: string): boolean {
  return /hunyuan|cogvideo/i.test(modelId);
}

const MAX_REF_EDGE = 1280;
const IMAGE_DECODE_TIMEOUT_MS = 8_000;
const MAX_FACE_SWAP_DATA_URL_CHARS = 1_800_000; // ~1.3 MB — larger freezes IPC

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Downscale for UI + IPC — never FileReader the full camera JPEG into React state. */
async function imageFileToDataUrl(file: File): Promise<string> {
  const bitmap = await withTimeout(
    createImageBitmap(file),
    IMAGE_DECODE_TIMEOUT_MS,
    'Фото слишком тяжёлое или повреждено. Сожмите JPEG и попробуйте снова.',
  );
  try {
    const scale = Math.min(1, MAX_REF_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not read image');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.88);
  } finally {
    bitmap.close();
  }
}

function isUsableImageRef(ref: ReferenceImage): boolean {
  if (ref.kind === 'video') return false;
  if (ref.sourcePath && ref.sourcePath.length > 1) return true;
  return Boolean(ref.dataUrl?.startsWith('data:image/') && ref.dataUrl.length > 32);
}

export function KreaVideoPanel({
  prompt,
  onPromptChange,
  activeModelId,
  onModelChange,
  referenceImages,
  onReferencesChange,
  durationSec,
  onDurationChange,
  format,
  onFormatChange,
  onGenerate,
  canGenerate,
  readyModelIds,
}: KreaVideoPanelProps): ReactNode {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [sortKey, setSortKey] = useState<ModelSortKey>('default');
  const [search, setSearch] = useState('');
  const [apiKeyModal, setApiKeyModal] = useState<{ modelId: string; keyName: string; label: string } | null>(null);
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [faceSwapBusy, setFaceSwapBusy] = useState(false);
  const [faceSwapSuccess, setFaceSwapSuccess] = useState<string | null>(null);
  const [faceSwapError, setFaceSwapError] = useState<string | null>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const activeSpec = useMemo(
    () => VIDEO_PROVIDERS.find((p) => p.id === activeModelId) ?? VIDEO_PROVIDERS[0],
    [activeModelId],
  );

  const filteredModels = useMemo(() => {
    let list = [...VIDEO_PROVIDERS].filter((p) => p.capability === 'IMAGE_TO_VIDEO');
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
    }
    return sortProviders(list, sortKey);
  }, [search, sortKey]);

  // Close popover when clicking outside
  useEffect(() => {
    if (!modelMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [modelMenuOpen]);

  // If a previous session left Hunyuan/CogVideo selected, fall back to Wan on Mac.
  useEffect(() => {
    if (!isCudaOnlyLocal(activeModelId)) return;
    const wan = VIDEO_PROVIDERS.find((p) => /ti2v|anes1032/i.test(p.id))
      ?? VIDEO_PROVIDERS.find((p) => /wan3|alibaba\/wan3/i.test(p.id));
    if (wan) onModelChange(wan.id);
  }, [activeModelId, onModelChange]);

  const handleSelectModel = (model: VideoProviderSpec) => {
    if (isCudaOnlyLocal(model.id)) return;
    const isReady = readyModelIds.includes(model.id);
    if (!isReady && model.apiKeyRequired) {
      const info = API_KEY_NAMES[model.id] ?? { key: `${model.id.toUpperCase()}_KEY`, label: `${model.name} API Key` };
      setApiKeyModal({ modelId: model.id, keyName: info.key, label: info.label });
      setApiKeyValue('');
      return;
    }
    setAttachError(null);
    onModelChange(model.id);
    setModelMenuOpen(false);
  };

  const toggleModelMenu = () => {
    setModelMenuOpen((prev) => {
      const next = !prev;
      if (next) setAttachError(null);
      return next;
    });
  };

  const saveApiKey = async () => {
    if (!apiKeyModal) return;
    const val = apiKeyValue.trim();
    if (val && window.api?.setSetting) {
      await window.api.setSetting(apiKeyModal.keyName, val);
      onModelChange(apiKeyModal.modelId);
    }
    setApiKeyModal(null);
    setModelMenuOpen(false);
  };

  // Add files — never FileReader whole videos or multi‑MB camera JPEGs (hangs Electron).
  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
      if (!list.length) return;

      setAttachBusy(true);
      setAttachError(null);
      const newRefs: ReferenceImage[] = [];
      try {
        for (const file of list) {
          const diskPath = window.api?.getPathForFile?.(file)
            || (file as File & { path?: string }).path
            || undefined;
          if (diskPath) {
            await window.api?.rememberDroppedMedia?.(diskPath);
          }
          const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name);
          if (isVideo) {
            let poster = '';
            try {
              poster = await videoToFrame(file, 10_000);
            } catch {
              poster = '';
            }
            if (!diskPath && !poster) {
              setAttachError('Не удалось открыть видео. Перетащите файл с диска (не из браузера).');
              continue;
            }
            newRefs.push({
              name: file.name,
              dataUrl: poster,
              sourcePath: diskPath,
              kind: 'video',
            });
            continue;
          }

          let dataUrl = '';
          try {
            dataUrl = await imageFileToDataUrl(file);
          } catch {
            dataUrl = '';
          }
          if (!diskPath && !dataUrl) {
            setAttachError('Не удалось открыть фото. Добавьте JPEG/PNG с диска.');
            continue;
          }
          newRefs.push({
            name: file.name,
            dataUrl,
            sourcePath: diskPath,
            kind: 'image',
          });
        }
        if (newRefs.length) {
          onReferencesChange([...referenceImages, ...newRefs]);
        }
      } catch (err) {
        setAttachError(err instanceof Error ? err.message : String(err));
      } finally {
        setAttachBusy(false);
      }
    },
    [onReferencesChange, referenceImages],
  );

  const removeReference = (idx: number) => {
    const next = [...referenceImages];
    next.splice(idx, 1);
    onReferencesChange(next);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer?.files) void addFiles(e.dataTransfer.files);
  };

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (e.clipboardData?.files) void addFiles(e.clipboardData.files);
  };

  const imageRefs = useMemo(
    () => referenceImages.filter(isUsableImageRef),
    [referenceImages],
  );

  const videoRefs = useMemo(
    () => referenceImages.filter((ref) => ref.kind === 'video' && Boolean(ref.sourcePath)),
    [referenceImages],
  );

  const hasVideoRef = videoRefs.length > 0;
  /** Photo→video OR two photos. */
  const canFaceSwap = (
    (imageRefs.length >= 1 && videoRefs.length >= 1)
    || imageRefs.length >= 2
  ) && !faceSwapBusy && !attachBusy;

  const resolveRefPayload = (ref: ReferenceImage): string | null => {
    if (ref.sourcePath && ref.sourcePath.length > 1) return ref.sourcePath;
    if (
      ref.dataUrl?.startsWith('data:image/')
      && ref.dataUrl.length > 32
      && ref.dataUrl.length <= MAX_FACE_SWAP_DATA_URL_CHARS
    ) {
      return ref.dataUrl;
    }
    if (ref.dataUrl && ref.dataUrl.length > MAX_FACE_SWAP_DATA_URL_CHARS) {
      return null;
    }
    return null;
  };

  // Drop broken black slots (empty image / unreadable paste) so UI does not look stuck.
  useEffect(() => {
    const cleaned = referenceImages.filter((ref) => {
      if (ref.kind === 'video') return Boolean(ref.sourcePath) || Boolean(ref.dataUrl);
      return isUsableImageRef(ref);
    });
    if (cleaned.length !== referenceImages.length) {
      onReferencesChange(cleaned);
    }
  }, [referenceImages, onReferencesChange]);

  const handleFaceSwap = async () => {
    if (!window.api?.faceSwap) return;

    let target: string | null = null;
    let face: string | null = null;
    let mode: 'video' | 'image' = 'image';

    if (videoRefs.length >= 1 && imageRefs.length >= 1) {
      // Video = scene (Шариков); photo = face to paste.
      target = videoRefs[0].sourcePath || null;
      face = resolveRefPayload(imageRefs[0]);
      mode = 'video';
    } else if (imageRefs.length >= 2) {
      target = resolveRefPayload(imageRefs[0]);
      face = resolveRefPayload(imageRefs[1]);
      mode = 'image';
    } else {
      setFaceSwapError(
        'Нужны: видео со сценой + фото лица — или два фото (сцена + лицо).',
      );
      setFaceSwapSuccess(null);
      return;
    }

    if (!target || !face) {
      setFaceSwapError(
        mode === 'video'
          ? 'Нужен путь к видео на диске и фото лица (JPEG/PNG).'
          : 'Не удалось прочитать фото. Добавьте JPEG/PNG с диска.',
      );
      return;
    }

    setFaceSwapBusy(true);
    setFaceSwapError(null);
    setFaceSwapSuccess(null);
    try {
      const res = await window.api.faceSwap({
        targetImage: target,
        sourceFace: face,
        selector: 'center',
      });
      if (res.success && (res.output_path || res.data_url)) {
        const preview = res.data_url && res.data_url.length <= MAX_FACE_SWAP_DATA_URL_CHARS
          ? res.data_url
          : '';
        const isVideoOut = res.kind === 'video' || mode === 'video';
        const swappedRef: ReferenceImage = {
          name: isVideoOut ? 'Лицо в видео' : 'Лицо интегрировано в сцену',
          dataUrl: preview,
          sourcePath: res.output_path,
          kind: isVideoOut ? 'video' : 'image',
        };
        if (isVideoOut) {
          const rest = referenceImages.filter((ref) => ref !== videoRefs[0] && ref !== imageRefs[0]);
          onReferencesChange([swappedRef, imageRefs[0], ...rest]);
          setFaceSwapSuccess(
            res.duration_sec
              ? `Лицо перенесено в ролик (${res.duration_sec.toFixed(1)} с). Дальше можно Generate.`
              : 'Лицо перенесено в ролик. Дальше можно Generate.',
          );
        } else {
          const rest = referenceImages.filter((ref) => ref !== imageRefs[0] && ref !== imageRefs[1]);
          onReferencesChange([swappedRef, imageRefs[1], ...rest]);
          setFaceSwapSuccess('Лицо успешно перенесено на кадр!');
        }
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const friendly = /decode base64|video data URL|Image load error|too large|too long/i.test(raw)
        ? raw.slice(0, 280)
        : raw;
      setFaceSwapError(friendly);
    } finally {
      setFaceSwapBusy(false);
    }
  };

  // Duration stepping
  const minDur = activeSpec.minDurationSec ?? 2;
  const maxDur = activeSpec.maxDurationSec ?? 15;
  const adjustDuration = (delta: number) => {
    onDurationChange(Math.min(maxDur, Math.max(minDur, durationSec + delta)));
  };

  const heroRef = referenceImages[0];
  const heroImage = heroRef?.kind === 'video'
    ? (heroRef.sourcePath ? toAssetUrl(heroRef.sourcePath) : '')
    : (heroRef?.dataUrl || (heroRef?.sourcePath ? toAssetUrl(heroRef.sourcePath) : ''));
  const heroIsVideo = heroRef?.kind === 'video';

  return (
    <div className={styles.studioContainer} onPaste={handlePaste}>
      {/* ── Left Area: Large Canvas / Reference View ───────────────── */}
      <div className={styles.canvasArea} onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
        <div className={styles.canvasHeader}>
          <span className={styles.canvasTitle}>Кадр & Референс</span>
          {referenceImages.length > 0 ? (
            <span style={{ fontSize: '11px', color: '#8e90a0' }}>
              {referenceImages.length} {referenceImages.length === 1 ? 'референс' : 'референса'}
            </span>
          ) : null}
        </div>

        <div
          className={styles.canvasPreview}
          data-has-media={Boolean(heroImage)}
          onClick={() => {
            if (!heroImage) fileInputRef.current?.click();
          }}
        >
          {heroImage ? (
            heroIsVideo ? (
              <video src={heroImage} className={styles.previewImage} muted playsInline controls={false} />
            ) : (
              <img src={heroImage} alt="Main reference" className={styles.previewImage} />
            )
          ) : (
            <div className={styles.dropPlaceholder}>
              <span className={styles.dropIcon}>🖼️</span>
              <span className={styles.dropText}>Перетащите кадр или фото сюда</span>
              <span className={styles.dropSubtext}>
                Или нажмите «+» в карточке References справа, чтобы добавить кадр из фильма и фото лица
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Right Area: Krea.ai Control Panel ───────────────────────── */}
      <div className={styles.kreaPanel}>
        {/* Mode Card */}
        <div className={styles.clickableCard}>
          <div className={styles.cardIconBox}>🎬</div>
          <div className={styles.cardMeta}>
            <div className={styles.cardSublabel}>Mode</div>
            <div className={styles.cardValue}>Generate Video</div>
          </div>
          <span className={styles.cardChevron}>›</span>
        </div>

        {/* Model Card (Clickable to open popover) */}
        <div
          className={styles.clickableCard}
          data-active={modelMenuOpen}
          onClick={toggleModelMenu}
        >
          <div className={styles.cardIconBox}>{MODEL_ICONS[activeSpec.id] ?? '⚡'}</div>
          <div className={styles.cardMeta}>
            <div className={styles.cardSublabel}>Model</div>
            <div className={styles.cardValue}>{activeSpec.name}</div>
          </div>
          <span className={styles.cardChevron}>{modelMenuOpen ? '▴' : '▾'}</span>
        </div>

        {/* ── Krea Popover Model Selector ──────────────────────────── */}
        {modelMenuOpen && (
          <div className={styles.modelPopover} ref={popoverRef}>
            <div className={styles.popoverHeader}>
              <div className={styles.popoverTabs}>
                {(['default', 'speed', 'price', 'quality'] as ModelSortKey[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={styles.popoverTab}
                    data-active={sortKey === tab}
                    onClick={() => setSortKey(tab)}
                  >
                    {tab === 'default'
                      ? 'Default'
                      : tab === 'speed'
                        ? 'Speed'
                        : tab === 'price'
                          ? 'Price'
                          : 'Quality ⇅'}
                  </button>
                ))}
              </div>

              <div className={styles.popoverSearchBox}>
                <input
                  type="text"
                  className={styles.popoverSearchInput}
                  placeholder="Search models..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
                <span className={styles.popoverFilterIcon}>🔍</span>
              </div>
            </div>

            <div className={styles.popoverList}>
              {filteredModels.map((m) => {
                const isSelected = activeModelId === m.id;
                const isReady = readyModelIds.includes(m.id);
                const cudaOnly = isCudaOnlyLocal(m.id);
                const elo = ELO_RATINGS[m.id] ?? 1150;
                const eloPct = Math.min(100, Math.max(10, ((elo - 1000) / 250) * 100));

                return (
                  <button
                    key={m.id}
                    type="button"
                    className={styles.popoverItem}
                    data-selected={isSelected || undefined}
                    data-disabled={cudaOnly || undefined}
                    disabled={cudaOnly}
                    title={cudaOnly ? 'Только NVIDIA GPU — на Mac недоступно' : undefined}
                    onClick={() => handleSelectModel(m)}
                  >
                    <span className={styles.popoverItemIcon}>{MODEL_ICONS[m.id] ?? '⚡'}</span>
                    <div className={styles.popoverItemBody}>
                      <div className={styles.popoverItemTop}>
                        <span className={styles.popoverItemName}>{m.name}</span>
                        {cudaOnly ? (
                          <span className={styles.popoverItemBadge} data-badge="nvidia">
                            NVIDIA
                          </span>
                        ) : m.badge ? (
                          <span className={styles.popoverItemBadge} data-badge={m.badge}>
                            {m.badge}
                          </span>
                        ) : null}
                      </div>
                      <div className={styles.popoverItemRatingRow}>
                        <div className={styles.eloBarContainer}>
                          <div
                            className={styles.eloBarFill}
                            style={{
                              width: `${eloPct}%`,
                              background: cudaOnly
                                ? '#52525b'
                                : m.runtime === 'local' ? '#10b981' : '#e5a93b',
                            }}
                          />
                        </div>
                        <span className={styles.eloText}>
                          {cudaOnly ? 'Mac ✕' : m.runtime === 'local' ? 'Local' : `${elo} Elo`}
                        </span>
                        {!isReady && m.apiKeyRequired && !cudaOnly ? (
                          <span style={{ fontSize: '9px', color: '#f6c043' }}>🔑 Key</span>
                        ) : null}
                      </div>
                    </div>
                    <span className={styles.popoverItemCheck}>{isSelected ? '✓' : ''}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* References Card */}
        <div className={styles.panelCard}>
          <div className={styles.cardHeader}>
            <span className={styles.cardLabel}>References</span>
          </div>

          <div className={styles.refList}>
            {referenceImages.map((ref, idx) => (
              <div
                key={`${ref.kind ?? 'image'}-${ref.sourcePath || ref.name}-${idx}`}
                className={styles.refThumbBox}
                title={ref.kind === 'video' ? `${ref.name} (видео — не для Face Swap)` : ref.name}
              >
                {ref.kind === 'video' ? (
                  ref.dataUrl ? (
                    <img src={ref.dataUrl} alt="" className={styles.refThumb} />
                  ) : (
                    <div
                      className={styles.refThumb}
                      style={{
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 10,
                        color: '#a1a1aa',
                        background: '#18181b',
                      }}
                    >
                      ▶ видео
                    </div>
                  )
                ) : (
                  <img
                    src={
                      ref.dataUrl?.startsWith('data:image/')
                        ? ref.dataUrl
                        : (ref.sourcePath ? toAssetUrl(ref.sourcePath) : '')
                    }
                    alt={ref.name || `Ref ${idx + 1}`}
                    className={styles.refThumb}
                  />
                )}
                <button
                  type="button"
                  className={styles.refRemoveBtn}
                  onClick={() => removeReference(idx)}
                  title="Удалить"
                >
                  ✕
                </button>
              </div>
            ))}

            <button
              type="button"
              className={styles.addRefBtn}
              onClick={() => fileInputRef.current?.click()}
              title="Добавить фото или видео"
            >
              +
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
              }}
            />
          </div>

          {attachBusy ? (
            <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#a1a1aa', textAlign: 'center' }}>
              Открываю файл…
            </p>
          ) : null}
          {attachError ? (
            <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#ef4444', textAlign: 'center' }}>
              ⚠ {attachError}
            </p>
          ) : null}

          {referenceImages.length >= 1 && (
            <div style={{ marginTop: '10px' }}>
              <button
                type="button"
                className={styles.faceSwapBtn}
                data-busy={faceSwapBusy || undefined}
                onClick={() => { void handleFaceSwap(); }}
                disabled={!canFaceSwap}
                title={
                  canFaceSwap
                    ? (hasVideoRef
                      ? 'Вставить лицо с фото в видео (покадрово)'
                      : 'Перенести лицо со 2-го фото на 1-е')
                    : 'Нужны видео+фото лица или два фото'
                }
              >
                {faceSwapBusy
                  ? (hasVideoRef ? 'Вставляю лицо в видео…' : 'Интегрируем лицо…')
                  : 'Интегрировать лицо (Face Swap)'}
              </button>
              {!canFaceSwap && !faceSwapBusy ? (
                <p style={{ margin: '5px 0 0', fontSize: '11px', color: '#a1a1aa', textAlign: 'center' }}>
                  {hasVideoRef && imageRefs.length < 1
                    ? 'Есть видео — добавьте фото лица (JPEG/PNG).'
                    : 'Нужны: видео сцены + фото лица, либо два фото (сцена + лицо).'}
                </p>
              ) : null}
              {canFaceSwap && hasVideoRef ? (
                <p style={{ margin: '5px 0 0', fontSize: '11px', color: '#a1a1aa', textAlign: 'center' }}>
                  Режим: фото лица → видео (до 45 с). Промпт Wan для этого не нужен.
                </p>
              ) : null}
              {faceSwapSuccess && (
                <p style={{ margin: '5px 0 0', fontSize: '11px', color: '#10b981', textAlign: 'center' }}>
                  ✓ {faceSwapSuccess}
                </p>
              )}
              {faceSwapError && (
                <p style={{ margin: '5px 0 0', fontSize: '11px', color: '#ef4444', textAlign: 'center' }}>
                  ⚠ {faceSwapError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Prompt Card */}
        <div className={styles.panelCard}>
          <div className={styles.cardHeader}>
            <span className={styles.cardLabel}>Prompt</span>
          </div>
          <textarea
            className={styles.promptTextarea}
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            placeholder="Очисти от мусора. Интегрируй лицо на скрине в персонажа Шарикова который сидит по центру"
          />
        </div>

        {/* Controls Row: Duration & Aspect Ratio */}
        <div className={styles.controlsRow}>
          {/* Duration Card */}
          <div className={styles.panelCard}>
            <div className={styles.cardHeader}>
              <span className={styles.cardLabel}>Duration</span>
            </div>
            <div className={styles.stepper}>
              <button
                type="button"
                className={styles.stepperBtn}
                onClick={() => adjustDuration(-1)}
                disabled={durationSec <= minDur}
              >
                −
              </button>
              <span className={styles.stepperValue}>{durationSec}s</span>
              <button
                type="button"
                className={styles.stepperBtn}
                onClick={() => adjustDuration(1)}
                disabled={durationSec >= maxDur}
              >
                +
              </button>
            </div>
          </div>

          {/* Aspect Ratio Card */}
          <div className={styles.panelCard}>
            <div className={styles.cardHeader}>
              <span className={styles.cardLabel}>Aspect ratio</span>
            </div>
            <div className={styles.aspectSelector}>
              {(['wide', 'square', 'portrait'] as GenerationFormat[]).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  className={styles.aspectPill}
                  data-selected={format === fmt}
                  onClick={() => onFormatChange(fmt)}
                >
                  {fmt === 'wide' ? '16:9' : fmt === 'square' ? '1:1' : '9:16'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Generate Button */}
        <button
          type="button"
          className={styles.generateBtn}
          onClick={() => {
            if (isCudaOnlyLocal(activeModelId)) {
              setAttachError(
                'Эта модель на Mac зависает при загрузке. Выберите Wan 2.2 TI2V или облако (Wan 3.0 / Kling / Seedance).',
              );
              return;
            }
            onGenerate();
          }}
          disabled={!canGenerate || attachBusy}
        >
          <span>{attachBusy ? 'Файл…' : 'Generate'}</span>
          <span className={styles.generateArrow}>↑</span>
        </button>
      </div>

      {/* ── API Key Input Modal ────────────────────────────────────── */}
      {apiKeyModal && (
        <div className={styles.apiKeyBackdrop} onClick={() => setApiKeyModal(null)}>
          <div className={styles.apiKeyModal} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.apiKeyTitle}>Введите {apiKeyModal.label}</h3>
            <p className={styles.apiKeyDesc}>
              Для генерации на этой облачной модели требуется API ключ. Он будет безопасно сохранён в ваших настройках.
            </p>
            <input
              type="password"
              className={styles.apiKeyInput}
              placeholder="Вставьте ваш API ключ..."
              value={apiKeyValue}
              onChange={(e) => setApiKeyValue(e.target.value)}
              autoFocus
            />
            <div className={styles.apiKeyActions}>
              <button
                type="button"
                className={styles.apiKeyCancelBtn}
                onClick={() => setApiKeyModal(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className={styles.apiKeySaveBtn}
                onClick={() => { void saveApiKey(); }}
                disabled={!apiKeyValue.trim()}
              >
                Сохранить и выбрать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
