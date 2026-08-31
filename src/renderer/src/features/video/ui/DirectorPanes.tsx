import type { ReactNode } from 'react';

import { TRACKS, clipSpan, formatClock } from '../model/directorTimeline';
import { DirectorPreview } from './DirectorPreview';
import { useDirector } from './DirectorBoard';
import styles from './VideoPage.module.css';

const LABEL_W = 96;

export function DirectorTimelinePane(): ReactNode {
  const d = useDirector();
  return (
    <div className={styles.paneFill}>
      <div className={styles.sceneHeader}>
        <div className={styles.timeReadout}>
          <strong>{formatClock(d.playhead)}</strong>
          <span> / {formatClock(d.total)}</span>
        </div>
        <label className={styles.scaleLabel}>
          {d.t('video.dir_scale')}
          <input
            type="range"
            min={8}
            max={32}
            value={d.pxPerSec}
            onChange={(e) => d.setPxPerSec(Number(e.target.value))}
          />
        </label>
      </div>
      <div className={styles.boardScroll} ref={d.boardScrollRef}>
        <div className={styles.board} style={{ width: LABEL_W + d.lanesPx }}>
          <div className={styles.ruler} style={{ marginLeft: LABEL_W }} onClick={d.seekFromEvent}>
            {d.ticks.map((s) => (
              <span key={s} className={styles.tick} style={{ left: s * d.pxPerSec }}>
                {formatClock(s)}
              </span>
            ))}
          </div>
          {TRACKS.map((track) => (
            <div key={track.id} className={styles.lane} data-track={track.id} data-track-lane={track.id}>
              <span className={styles.laneLabel} data-track={track.id}>
                <i className={styles.laneDot} data-track={track.id} aria-hidden />
                {d.t(track.labelKey)}
                {d.clips.some((c) => c.track === track.id) ? (
                  <button type="button" className={styles.laneClear} title={d.t('video.dir_clear_track')} onClick={() => d.clearTrack(track.id)}>
                    ×
                  </button>
                ) : null}
              </span>
              <div className={styles.laneBody} style={{ width: d.lanesPx }} onClick={d.seekFromEvent}>
                {d.clips.filter((c) => c.track === track.id).map((clip) => (
                  <div
                    key={clip.id}
                    className={styles.block}
                    data-clip="true"
                    data-on={clip.id === d.selectedClip}
                    data-live={d.live[clip.track] === clip.id}
                    data-track={clip.track}
                    style={{ left: clip.startSec * d.pxPerSec, width: Math.max(36, clip.durationSec * d.pxPerSec) }}
                    onPointerDown={(e) => d.onClipPointerDown(e, clip, 'move')}
                    onPointerMove={d.onClipPointerMove}
                    onPointerUp={(e) => d.onClipPointerUp(e, clip)}
                  >
                    <span className={styles.blockHandle} data-edge="in" onPointerDown={(e) => d.onClipPointerDown(e, clip, 'in')} />
                    <span className={styles.blockLabel} title={clip.label}>{clip.label}</span>
                    <button
                      type="button"
                      className={styles.blockDelete}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); d.removeClip(clip.id); }}
                    >
                      ×
                    </button>
                    <span className={styles.blockHandle} data-edge="out" onPointerDown={(e) => d.onClipPointerDown(e, clip, 'out')} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className={styles.playhead} style={{ left: LABEL_W + d.playhead * d.pxPerSec }}>
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

export function DirectorResultPane(): ReactNode {
  const d = useDirector();
  return (
    <div className={styles.paneFill}>
      <DirectorPreview
        playhead={d.playhead}
        playing={d.playing}
        seekNonce={d.seekNonce}
        clips={d.clips}
        bins={d.bins}
        blobs={d.blobs}
        onDecodeFail={(binId) => {
          const bin = d.bins.find((item) => item.id === binId);
          if (!bin || bin.proxying) return;
          d.applyProxy(binId, true);
        }}
      />
      <div className={styles.transport}>
        <button type="button" className={styles.primary} onClick={d.togglePlay} disabled={d.clips.length === 0 || d.bins.some((b) => b.proxying)}>
          {d.playing ? d.t('video.dir_pause') : d.t('video.dir_play')}
        </button>
        <button type="button" className={styles.secondary} onClick={() => { d.seekTo(0); }}>
          {d.t('video.dir_stop')}
        </button>
        <button type="button" className={styles.secondary} disabled={!d.activeClip} onClick={() => d.activeClip && d.removeClip(d.activeClip.id)}>
          {d.t('video.dir_remove_clip')}
        </button>
      </div>
      {d.bins.some((b) => b.proxying) ? <p className={styles.hint}>{d.t('video.dir_proxying')}</p> : null}
      {d.proxyError ? <p className={styles.error}>{d.proxyError}</p> : null}
    </div>
  );
}

export function DirectorSourcesPane(): ReactNode {
  const d = useDirector();
  return (
    <div className={styles.paneFill}>
      {d.seed?.title ? <p className={styles.hint}>{d.t('video.dir_from_storyboard', { title: d.seed.title })}</p> : null}
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={d.pickVideo}>{d.t('video.dir_add_video')}</button>
        <button type="button" className={styles.secondary} onClick={d.pickImage}>{d.t('video.dir_add_image')}</button>
        <button type="button" className={styles.secondary} onClick={d.pickAudio}>{d.t('video.dir_add_audio')}</button>
      </div>
      {d.bins.length === 0 ? <p className={styles.hint}>{d.t('video.dir_bin_empty')}</p> : (
        <ul className={styles.binList}>
          {d.bins.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={styles.binItem}
                data-on={item.id === d.selectedBin}
                onClick={() => { d.setSelectedBin(item.id); d.setSelectedClip(null); }}
              >
                <strong>{item.name}</strong>
                <span>
                  {d.t(`video.dir_kind_${item.kind}`)}
                  {item.proxying ? ` · ${d.t('video.dir_proxy_short')}` : ` · ${item.durationKnown || item.kind === 'image' ? `${item.durationSec.toFixed(1)}s` : '…'}`}
                </span>
              </button>
              <button type="button" className={styles.binDelete} onClick={() => d.removeBin(item.id)}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DirectorCutPane(): ReactNode {
  const d = useDirector();
  return (
    <div className={styles.paneFill}>
      {d.activeBin ? (
        <>
          <div className={styles.row}>
            <label className={styles.field}>
              <span className={styles.label}>In</span>
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
            <label className={styles.field}>
              <span className={styles.label}>Out</span>
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
            <span className={styles.hint}>{d.t('video.dir_cut_len', { seconds: clipSpan(d.activeBin).toFixed(1) })}</span>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => d.placeOnTrack('v1')} disabled={d.activeBin.kind === 'audio'}>{d.t('video.dir_to_main')}</button>
            <button type="button" className={styles.secondary} onClick={() => d.placeOnTrack('v2')} disabled={d.activeBin.kind === 'audio'}>{d.t('video.dir_to_overlay')}</button>
            <button type="button" className={styles.secondary} onClick={() => d.placeOnTrack('a1')} disabled={d.activeBin.kind !== 'audio'}>{d.t('video.dir_to_audio')}</button>
          </div>
        </>
      ) : (
        <p className={styles.hint}>{d.t('video.dir_cut_empty')}</p>
      )}
      <div className={styles.captionRow}>
        <input
          className={styles.captionInput}
          value={d.captionDraft}
          onChange={(e) => d.setCaptionDraft(e.target.value)}
          placeholder={d.t('video.dir_caption_ph')}
        />
        <button type="button" className={styles.primary} onClick={d.addCaption} disabled={!d.captionDraft.trim()}>{d.t('video.dir_caption_add')}</button>
      </div>
    </div>
  );
}
