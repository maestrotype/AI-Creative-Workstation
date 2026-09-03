import type { DragEvent, ReactNode } from 'react';
import { useEffect, useState } from 'react';

import {
  BIN_DRAG_MIME,
  canRemoveEmptyTrack,
  clipSpan,
  formatClock,
  audioTracksForBin,
  videoTracksForBin,
  type TrackId,
} from '../model/directorTimeline';
import { DirectorPreview } from './DirectorPreview';
import { useDirector } from './DirectorBoard';
import { VoiceoverSection } from './VoiceoverSection';
import styles from './VideoPage.module.css';

const LABEL_W = 118;

function trackLabelText(
  t: (key: string, opts?: Record<string, string | number>) => string,
  labelKey: string,
  labelParams?: Record<string, number>,
): string {
  return labelParams ? t(labelKey, labelParams) : t(labelKey);
}

function hasOsFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function hasBinDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(BIN_DRAG_MIME);
}

function dropStartSec(event: DragEvent<HTMLElement>, pxPerSec: number): number {
  const body = event.currentTarget;
  const rect = body.getBoundingClientRect();
  return Math.max(0, (event.clientX - rect.left) / pxPerSec);
}

export function DirectorTimelinePane(): ReactNode {
  const d = useDirector();
  const [hoverTrack, setHoverTrack] = useState<string | null>(null);

  useEffect(() => {
    const el = d.boardScrollRef.current;
    if (!el) return undefined;
    const measure = () => d.setViewW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [d.boardScrollRef, d.setViewW]);
  const videoTracks = d.tracks.filter((track) => track.id.startsWith('v'));
  const audioTracks = d.tracks.filter((track) => track.id.startsWith('a'));
  const titleTracks = d.tracks.filter((track) => track.id.startsWith('t'));

  const onBoardDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasOsFiles(event) && !hasBinDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    d.setDropActive(true);
  };

  const onLaneDragOver = (event: DragEvent<HTMLElement>, track: TrackId) => {
    if (!hasOsFiles(event) && !hasBinDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setHoverTrack(track);
    d.setDropActive(true);
  };

  const onDragLeaveBoard = (event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setHoverTrack(null);
    d.setDropActive(false);
  };

  const onLaneDrop = (event: DragEvent<HTMLElement>, track: TrackId) => {
    event.preventDefault();
    event.stopPropagation();
    d.setDropActive(false);
    setHoverTrack(null);
    const startSec = dropStartSec(event, d.pxPerSec);
    const binId = event.dataTransfer.getData(BIN_DRAG_MIME)
      || event.dataTransfer.getData('text/plain').replace(/^acw-bin:/, '');
    if (binId && d.bins.some((b) => b.id === binId)) {
      d.placeOnTrack(track, binId, startSec);
      return;
    }
    if (event.dataTransfer.files.length > 0) {
      d.ingestDropped(event.dataTransfer.files, { track, startSec });
    }
  };

  const onBoardDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    d.setDropActive(false);
    setHoverTrack(null);
    const raw = event.dataTransfer.getData(BIN_DRAG_MIME)
      || event.dataTransfer.getData('text/plain');
    const binId = raw.startsWith('acw-bin:') ? raw.slice(8) : raw;
    if (binId && d.bins.some((b) => b.id === binId)) {
      const bin = d.bins.find((b) => b.id === binId);
      d.placeOnTrack(bin?.kind === 'audio' ? 'a1' : 'v1', binId);
      return;
    }
    if (event.dataTransfer.files.length > 0) {
      d.ingestDropped(event.dataTransfer.files);
    }
  };

  return (
    <div
      className={`${styles.paneFill} ${d.dropActive ? styles.dropHost : ''}`}
      onDragOver={onBoardDragOver}
      onDragLeave={onDragLeaveBoard}
      onDrop={onBoardDrop}
    >
      <div className={styles.timelineBar}>
        <span className={styles.timeReadout} ref={d.clockElRef}>
          {formatClock(d.playhead)} / {formatClock(d.total)}
        </span>
        <div className={styles.toolRow}>
          <button
            type="button"
            className={styles.toolBtn}
            onClick={d.addVideoOverlayTrack}
            disabled={d.trackLayout.videos >= 8}
          >
            {d.t('video.dir_add_overlay')}
          </button>
          <button
            type="button"
            className={styles.toolBtn}
            onClick={d.packGaps}
            disabled={!d.hasTimelineGaps}
            title={d.t('video.dir_pack_hint')}
          >
            {d.t('video.dir_pack_gaps')}
          </button>
          <label className={styles.scaleLabel}>
            {d.t('video.dir_scale')}
            <input
              type="range"
              min={d.minPxPerSec}
              max={d.maxPxPerSec}
              step={0.1}
              value={Math.min(d.maxPxPerSec, Math.max(d.minPxPerSec, d.pxPerSec))}
              onChange={(e) => d.setPxPerSec(Number(e.target.value))}
            />
          </label>
          <button type="button" className={styles.toolBtn} onClick={d.fitTimeline}>
            {d.t('video.dir_fit')}
          </button>
        </div>
      </div>
      <div className={styles.boardScroll} ref={d.boardScrollRef}>
        <div className={styles.board} style={{ width: LABEL_W + d.lanesPx }}>
          <div
            className={styles.ruler}
            style={{ marginLeft: LABEL_W }}
            onPointerDown={d.onRulerPointerDown}
            onPointerMove={d.onRulerPointerMove}
            onPointerUp={d.onRulerPointerUp}
          >
            {d.ticks.map((s) => (
              <span key={s} className={styles.tick} style={{ left: s * d.pxPerSec }}>
                {formatClock(s)}
              </span>
            ))}
          </div>
          {[videoTracks, audioTracks, titleTracks].map((group) => (
            group.map((track) => (
              <div
                key={track.id}
                className={styles.lane}
                data-track={track.id}
                data-track-lane={track.id}
                data-drop={hoverTrack === track.id ? 'true' : undefined}
              >
                <span className={styles.laneLabel} data-track={track.id} title={trackLabelText(d.t, track.labelKey, track.labelParams)}>
                  <i className={styles.laneDot} data-track={track.id} aria-hidden />
                  <span className={styles.laneLabelText}>
                    {trackLabelText(d.t, track.labelKey, track.labelParams)}
                  </span>
                  {d.clips.some((c) => c.track === track.id) ? (
                    <button type="button" className={styles.laneClear} title={d.t('video.dir_clear_track')} onClick={() => d.clearTrack(track.id)}>
                      ×
                    </button>
                  ) : canRemoveEmptyTrack(track.id, d.clips, d.trackLayout) ? (
                    <button type="button" className={styles.laneClear} title={d.t('video.dir_remove_track')} onClick={() => d.removeEmptyTrack(track.id)}>
                      ×
                    </button>
                  ) : null}
                </span>
                <div
                  className={styles.laneBody}
                  style={{ width: d.lanesPx }}
                  onPointerDown={d.onRulerPointerDown}
                  onPointerMove={d.onRulerPointerMove}
                  onPointerUp={d.onRulerPointerUp}
                  onDragOver={(e) => onLaneDragOver(e, track.id)}
                  onDrop={(e) => onLaneDrop(e, track.id)}
                >
                  {d.clips.filter((c) => c.track === track.id).map((clip) => (
                    <div
                      key={clip.id}
                      className={styles.block}
                      data-clip="true"
                      data-on={clip.id === d.selectedClip}
                      data-live={d.live[clip.track] === clip.id}
                      data-track={clip.track}
                      style={{
                        left: clip.startSec * d.pxPerSec,
                        width: Math.max(36, clip.durationSec * d.pxPerSec),
                        zIndex: clip.id === d.selectedClip ? 2 : 1,
                      }}
                      onPointerDown={(e) => d.onClipPointerDown(e, clip, 'move')}
                      onPointerMove={d.onClipPointerMove}
                      onPointerUp={(e) => d.onClipPointerUp(e, clip)}
                    >
                      <span
                        className={styles.blockHandle}
                        data-edge="in"
                        onPointerDown={(e) => { e.stopPropagation(); d.onClipPointerDown(e, clip, 'in'); }}
                      />
                      <span className={styles.blockLabel} title={clip.label}>
                        {clip.label.replace(/\.[^.]+$/, '')}
                      </span>
                      <button
                        type="button"
                        className={styles.blockDelete}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); d.removeClip(clip.id); }}
                      >
                        ×
                      </button>
                      <span
                        className={styles.blockHandle}
                        data-edge="out"
                        onPointerDown={(e) => { e.stopPropagation(); d.onClipPointerDown(e, clip, 'out'); }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))
          ))}
          <div
            ref={d.playheadElRef}
            className={styles.playhead}
            style={{ transform: `translate3d(${LABEL_W + d.playhead * d.pxPerSec}px,0,0)` }}
          >
            <span className={styles.playheadCap} />
          </div>
          {d.clips.length === 0 ? (
            <div className={styles.boardEmpty} style={{ left: LABEL_W }}>
              {d.t('video.dir_board_empty')}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function DirectorResultPane({ previewActive = true }: { previewActive?: boolean } = {}): ReactNode {
  const d = useDirector();
  return (
    <div className={`${styles.paneFill} ${styles.resultPane}`}>
      <DirectorPreview
        playhead={d.playhead}
        playing={d.playing}
        seekNonce={d.seekNonce}
        clips={d.clips}
        bins={d.bins}
        blobs={d.blobs}
        trackLayout={d.visibleLayout}
        overlayPos={d.overlayPos}
        onOverlayMove={d.setOverlayPos}
        active={previewActive}
        onDecodeFail={(binId) => {
          const bin = d.bins.find((item) => item.id === binId);
          if (!bin || bin.proxying) return;
          d.applyProxy(binId, true);
        }}
      />
      <div className={styles.transport}>
        <button type="button" className={styles.toolBtn} onClick={d.togglePlay} disabled={d.clips.length === 0 || d.bins.some((b) => b.proxying)}>
          {d.playing ? d.t('video.dir_pause') : d.t('video.dir_play')}
        </button>
        <button type="button" className={styles.toolBtn} onClick={() => { d.seekTo(0); }}>
          {d.t('video.dir_stop')}
        </button>
        <button
          type="button"
          className={styles.toolPrimary}
          onClick={d.exportVideo}
          disabled={d.clips.length === 0 || d.exportBusy || d.bins.some((b) => b.proxying)}
        >
          {d.exportBusy ? d.t('video.dir_exporting') : d.t('video.dir_export')}
        </button>
      </div>
      {d.bins.some((b) => b.proxying) ? <p className={styles.hintTight}>{d.t('video.dir_proxying')}</p> : null}
      {d.proxyError ? <p className={styles.error}>{d.proxyError}</p> : null}
      {d.exportError ? <p className={styles.error}>{d.exportError}</p> : null}
      {d.exportPath ? (
        <div className={styles.exportDone}>
          <p className={styles.hintTight}>
            {d.exportSavedTo
              ? d.t('video.saved_to', { path: d.exportSavedTo })
              : d.t('video.dir_export_done')}
          </p>
          <div className={styles.toolRow}>
            <button type="button" className={styles.toolPrimary} onClick={d.saveExportAs}>
              {d.t('video.save_as')}
            </button>
            <button type="button" className={styles.toolBtn} onClick={d.discardExport}>
              {d.t('video.discard')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DirectorSourcesPane({
  onOpenVoiceover,
}: {
  onOpenVoiceover?: () => void;
} = {}): ReactNode {
  const d = useDirector();
  const openVoiceover = onOpenVoiceover ?? d.openVoiceover;
  const onSourcesDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasOsFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    d.setDropActive(true);
  };

  const onSourcesDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    d.setDropActive(false);
    if (event.dataTransfer.files.length > 0) {
      d.ingestDropped(event.dataTransfer.files);
    }
  };

  return (
    <div
      className={`${styles.paneFill} ${styles.sourcesPane} ${d.dropActive ? styles.dropHost : ''}`}
      onDragOver={onSourcesDragOver}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        d.setDropActive(false);
      }}
      onDrop={onSourcesDrop}
    >
      <div className={styles.toolRow}>
        <button type="button" className={styles.toolPrimary} onClick={d.pickVideo}>{d.t('video.dir_add_video')}</button>
        <button type="button" className={styles.toolBtn} onClick={d.pickImage}>{d.t('video.dir_add_image')}</button>
        <button type="button" className={styles.toolBtn} onClick={d.pickAudio}>{d.t('video.dir_add_audio')}</button>
      </div>

      {d.voiceoverSource ? (
        <div className={styles.voEntryRow}>
          {!d.voiceover.expanded ? (
            <button
              type="button"
              className={styles.toolPrimary}
              onClick={openVoiceover}
            >
              {d.t('video.vo_open')}
            </button>
          ) : null}
          <VoiceoverSection />
        </div>
      ) : null}

      {!d.voiceover.expanded ? (
      <div className={styles.voiceStrip}>
        <span className={styles.voiceLabel}>{d.t('video.dir_voice')}</span>
        <button
          type="button"
          className={d.voiceRecording ? styles.toolPrimary : styles.toolBtn}
          onClick={d.toggleVoiceRecord}
          disabled={d.voiceBusy}
        >
          {d.voiceRecording ? d.t('video.dir_voice_stop') : d.t('video.dir_voice_record')}
        </button>
        {d.libraryAudio.length > 0 ? (
          <select
            className={styles.voiceSelect}
            defaultValue=""
            onChange={(e) => {
              const path = e.target.value;
              e.target.value = '';
              if (path) d.placeLibraryAudio(path);
            }}
          >
            <option value="" disabled>{d.t('video.dir_voice_lib')}</option>
            {d.libraryAudio.map((clip) => (
              <option key={clip.path} value={clip.path}>{clip.name}</option>
            ))}
          </select>
        ) : null}
        {d.ttsReady ? (
          <>
            <input
              className={styles.voiceInput}
              value={d.voiceLine}
              onChange={(e) => d.setVoiceLine(e.target.value)}
              placeholder={d.t('video.dir_voice_ph')}
              disabled={d.voiceBusy || d.voiceRecording}
            />
            <button
              type="button"
              className={styles.toolBtn}
              onClick={d.generateVoiceover}
              disabled={d.voiceBusy || d.voiceRecording || !d.voiceLine.trim()}
            >
              {d.t('video.dir_voice_gen')}
            </button>
            <input
              className={styles.voiceInput}
              value={d.voiceFixPrompt}
              onChange={(e) => d.setVoiceFixPrompt(e.target.value)}
              placeholder={d.t('video.dir_voice_fix_ph')}
              disabled={d.voiceBusy || d.voiceRecording}
            />
            <button
              type="button"
              className={styles.toolBtn}
              onClick={d.applyVoiceFix}
              disabled={d.voiceBusy || d.voiceRecording || !d.voiceFixPrompt.trim()}
            >
              {d.t('video.dir_voice_fix')}
            </button>
          </>
        ) : null}
        {d.voiceRecording ? <span className={styles.hintTight}>{d.t('video.dir_voice_recording')}</span> : null}
        {d.voiceError ? <p className={styles.voiceError}>{d.voiceError}</p> : null}
      </div>
      ) : null}
      {!d.voiceover.expanded ? (
      <p className={styles.hintTight}>{d.t('video.dir_voice_help')}</p>
      ) : null}
      {d.bins.length === 0 ? <p className={styles.hintTight}>{d.t('video.dir_bin_empty')}</p> : (
        <ul className={styles.binList}>
          {d.bins.map((item) => {
            const onTimeline = d.clips.some((c) => c.binId === item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={styles.binItem}
                  data-on={item.id === d.selectedBin}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(BIN_DRAG_MIME, item.id);
                    e.dataTransfer.setData('text/plain', `acw-bin:${item.id}`);
                    e.dataTransfer.effectAllowed = 'copy';
                    d.setSelectedBin(item.id);
                  }}
                  onClick={() => { d.setSelectedBin(item.id); d.setSelectedClip(null); }}
                  onDoubleClick={() => {
                    const track = item.kind === 'audio' ? 'a1' : 'v1';
                    d.placeOnTrack(track, item.id);
                  }}
                >
                  <strong>{item.name}</strong>
                  <span>
                    {d.t(`video.dir_kind_${item.kind}`)}
                    {item.proxying ? ` · ${d.t('video.dir_proxy_short')}` : ` · ${item.durationKnown || item.kind === 'image' ? `${item.durationSec.toFixed(1)}s` : '…'}`}
                    {onTimeline ? ` · ${d.t('video.dir_on_timeline')}` : ''}
                  </span>
                </button>
                <button type="button" className={styles.binDelete} onClick={() => d.removeBin(item.id)}>×</button>
              </li>
            );
          })}
        </ul>
      )}
      <div className={styles.inspector}>
        {d.activeBin ? (
          <>
            <div className={styles.cutRow}>
              <label className={styles.cutField}>
                In
                <input
                  className={styles.num}
                  type="number"
                  min={0}
                  max={d.activeBin.durationSec}
                  step={0.1}
                  value={Number(d.activeBin.inSec.toFixed(1))}
                  onChange={(e) => d.patchBin(d.activeBin!.id, { inSec: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
              <label className={styles.cutField}>
                Out
                <input
                  className={styles.num}
                  type="number"
                  min={0}
                  max={d.activeBin.durationSec}
                  step={0.1}
                  value={Number(d.activeBin.outSec.toFixed(1))}
                  onChange={(e) => d.patchBin(d.activeBin!.id, { outSec: Math.min(d.activeBin!.durationSec, Number(e.target.value) || 0) })}
                />
              </label>
              <span className={styles.cutLen}>{clipSpan(d.activeBin).toFixed(1)}s</span>
            </div>
            <p className={styles.hintTight}>{d.t('video.dir_place_hint', { time: formatClock(d.playhead) })}</p>
            <div className={styles.toolRow}>
              {d.activeBin.kind === 'video' ? (
                <button
                  type="button"
                  className={styles.placeBtnPrimary}
                  onClick={openVoiceover}
                >
                  {d.t('video.vo_open')}
                </button>
              ) : null}
              {videoTracksForBin(d.activeBin, d.visibleLayout).map((track) => (
                <button
                  key={track}
                  type="button"
                  className={track === 'v1' ? styles.placeBtnPrimary : styles.placeBtn}
                  onClick={() => d.placeOnTrack(track, d.activeBin!.id)}
                >
                  {d.t('video.dir_place_on', { track: track.toUpperCase() })}
                </button>
              ))}
              {audioTracksForBin(d.activeBin, d.visibleLayout).map((track) => (
                <button
                  key={track}
                  type="button"
                  className={styles.placeBtn}
                  onClick={() => d.placeOnTrack(track, d.activeBin!.id)}
                >
                  {d.t('video.dir_place_on', { track: track.toUpperCase() })}
                </button>
              ))}
              {d.activeBin.kind !== 'audio' && d.trackLayout.videos < 8 ? (
                <button type="button" className={styles.placeBtn} onClick={d.addVideoOverlayTrack}>
                  {d.t('video.dir_add_overlay_short')}
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <p className={styles.hintTight}>{d.t('video.dir_cut_empty')}</p>
        )}
        <div className={styles.captionRow}>
          <input
            className={styles.captionInput}
            value={d.captionDraft}
            onChange={(e) => d.setCaptionDraft(e.target.value)}
            placeholder={d.t('video.dir_caption_ph')}
          />
          <button type="button" className={styles.toolBtn} onClick={d.addCaption} disabled={!d.captionDraft.trim()}>{d.t('video.dir_caption_add')}</button>
        </div>
      </div>
    </div>
  );
}
