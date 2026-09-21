import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import { formatClock, unstackAllTracks } from '../model/directorTimeline';
import { toAssetUrl } from '../model/directorMedia';
import { promptForPurpose, purposeWord } from '../model/autoAssemble';
import { clipDisplayName, shotProviderShort } from '../model/clipDisplayName';
import type { ShotPurpose } from '../../projects/model/project';
import { useDirector } from './DirectorBoard';
import { formatTimecode } from '../model/videoAnalysis';
import s from './ClipInspector.module.css';

const IMAGE_PRESETS = [2, 4, 6, 8];
const ASSEMBLE_TARGETS = [5, 10, 15, 30];

export function ClipInspector({
  onOpenVoiceover,
}: {
  onOpenVoiceover?: () => void;
} = {}): ReactNode {
  const d = useDirector();
  const [assembleTarget, setAssembleTarget] = useState(15);
  const clip = d.activeClip;
  const bin = clip?.binId ? d.bins.find((b) => b.id === clip.binId) ?? null : null;
  const shot = bin?.shotId ? d.shots.find((item) => item.id === bin.shotId) ?? null : null;
  const origin = bin?.shotId ? 'ai' : bin ? 'original' : null;

  const previewSrc = useMemo(() => {
    if (!bin?.path) return null;
    if (bin.kind === 'image') return toAssetUrl(bin.path);
    return d.blobs[bin.path] ?? null;
  }, [bin, d.blobs]);

  const filmStats = useMemo(() => {
    const aiClips = d.clips.filter((c) => {
      const b = c.binId ? d.bins.find((x) => x.id === c.binId) : null;
      return Boolean(b?.shotId);
    }).length;
    const originalClips = d.clips.filter((c) => {
      const b = c.binId ? d.bins.find((x) => x.id === c.binId) : null;
      return b && !b.shotId && (b.kind === 'video' || b.kind === 'image');
    }).length;
    const narration = d.clips.some((c) => c.track === 'a1') || d.voiceover.status === 'voiced';
    return {
      duration: d.total,
      clips: d.clips.filter((c) => c.track.startsWith('v')).length,
      shots: d.shots.length,
      aiClips,
      originalClips,
      narration,
      exportReady: Boolean(d.exportPath),
      product: Boolean(d.productStillPath),
    };
  }, [d.clips, d.bins, d.shots, d.total, d.voiceover.status, d.exportPath, d.productStillPath]);

  const setDuration = (seconds: number) => {
    if (!clip) return;
    const dur = Math.max(0.4, Math.round(seconds * 10) / 10);
    const maxDur = bin?.kind === 'video'
      ? Math.max(0.4, (bin.durationSec || clip.durationSec) - clip.sourceInSec)
      : 3600;
    const nextDur = Math.min(dur, maxDur);
    const baseline = d.clips.map((item) => (
      item.id === clip.id
        ? { ...item, durationSec: nextDur, autoLength: false }
        : { ...item }
    ));
    d.replaceClips(unstackAllTracks(baseline));
  };

  if (!clip) {
    const productThumb = d.productStillPath ? toAssetUrl(d.productStillPath) : null;
    return (
      <aside className={s.root}>
        <header className={s.head}>
          <h2 className={s.title}>Film</h2>
          <span className={s.kind}>{d.projectScope?.name?.trim() || 'Untitled'}</span>
        </header>

        <div className={s.productCard}>
          {productThumb ? (
            <img className={s.productThumb} src={productThumb} alt="" />
          ) : (
            <div className={s.productThumbEmpty}>No product still</div>
          )}
          <div className={s.productMeta}>
            <strong>{d.projectScope?.name?.trim() || 'Product film'}</strong>
            <span>{formatClock(filmStats.duration)} · {filmStats.clips} clips · {filmStats.aiClips} AI</span>
            {d.filmBrief?.trim() ? <span className={s.productBrief}>{d.filmBrief.trim().slice(0, 120)}</span> : null}
          </div>
        </div>

        {d.assemblyRationale ? (
          <p className={s.hint}>Assembly: {d.assemblyRationale}</p>
        ) : null}

        <div className={s.block}>
          <div className={s.sectionLabel}>Actions</div>
          <div className={s.presets}>
            {ASSEMBLE_TARGETS.map((sec) => (
              <button
                key={sec}
                type="button"
                className={s.preset}
                data-on={assembleTarget === sec}
                onClick={() => setAssembleTarget(sec)}
              >
                {sec}s
              </button>
            ))}
          </div>
          <button
            type="button"
            className={s.btnPrimaryWide}
            onClick={() => d.applyAutoAssemble(assembleTarget)}
            disabled={d.shots.length === 0 && !d.productStillPath}
          >
            Auto Assemble → {assembleTarget}s
          </button>
          <button
            type="button"
            className={s.btnWide}
            disabled={d.aiBusy || !d.productStillPath}
            onClick={() => d.generateAiClip({
              mode: 'shot',
              purpose: 'PRODUCT_HERO',
              prompt: promptForPurpose('PRODUCT_HERO', d.filmBrief),
              durationSec: 3.4,
            })}
          >
            Generate Shot
          </button>
          <button
            type="button"
            className={s.btnWide}
            disabled={d.aiBusy || !d.productStillPath}
            onClick={() => { void d.generateProductShotSet(); }}
          >
            {d.aiBusy && d.aiStatus ? d.aiStatus : 'Generate 4 shots (Hero→Detail→Angle→Feature)'}
          </button>
          {onOpenVoiceover ? (
            <button type="button" className={s.btnWide} onClick={onOpenVoiceover}>
              Prepare narration
            </button>
          ) : null}
          <div className={s.actions}>
            <button type="button" className={s.btn} onClick={d.pickVideo}>Add video</button>
            <button type="button" className={s.btn} onClick={d.pickImage}>Add image</button>
            <button
              type="button"
              className={s.btn}
              disabled={d.aiBusy || !d.productStillPath}
              onClick={() => d.generateAiClip({
                mode: 'insert',
                purpose: 'DETAIL',
                prompt: promptForPurpose('DETAIL', d.filmBrief),
                durationSec: 3.4,
              })}
            >
              Insert
            </button>
          </div>
          {!d.productStillPath ? (
            <p className={s.hint}>Add a product still to this film so AI shots stay on-product.</p>
          ) : (
            <p className={s.hint}>Fit the timeline to see the full {formatClock(filmStats.duration)} film.</p>
          )}
        </div>
      </aside>
    );
  }

  const kind = bin?.kind ?? (clip.track.startsWith('a') ? 'audio' : 'video');
  const endSec = clip.startSec + clip.durationSec;
  const purpose = (shot?.shotPurpose || 'PRODUCT_HERO') as ShotPurpose;
  const title = clipDisplayName(clip, bin, shot);

  return (
    <aside className={s.root}>
      <header className={s.head}>
        <h2 className={s.title}>Clip</h2>
        <span className={s.kind}>{kind}</span>
      </header>

      <div className={s.previewBox}>
        {kind === 'image' && previewSrc ? (
          <img className={s.previewMedia} src={previewSrc} alt="" />
        ) : kind === 'video' && previewSrc ? (
          <video className={s.previewMedia} src={previewSrc} muted playsInline preload="metadata" />
        ) : (
          <div className={s.previewFallback}>{title}</div>
        )}
      </div>

      <div className={s.block}>
        <div className={s.row}>
          <span className={s.key}>Shot</span>
          <span className={s.val}>{title}</span>
        </div>
        <div className={s.row}>
          <span className={s.key}>Type</span>
          <span className={s.val}>
            {origin === 'ai' ? 'AI Video' : origin === 'original' ? (kind === 'image' ? 'Original still' : 'Uploaded / original') : kind}
          </span>
        </div>
        <div className={s.row}>
          <span className={s.key}>Range</span>
          <span className={s.val}>{formatClock(clip.startSec)} – {formatClock(endSec)}</span>
        </div>
        {shot ? (
          <div className={s.row}>
            <span className={s.key}>Provider</span>
            <span className={s.val}>{shotProviderShort(shot)}</span>
          </div>
        ) : null}
        {bin?.name ? (
          <div className={s.row}>
            <span className={s.key}>File</span>
            <span className={s.val} title={bin.path}>{bin.name}</span>
          </div>
        ) : null}
      </div>

      <div className={s.block}>
        <div className={s.sectionLabel}>Duration</div>
        <div className={s.durationRow}>
          <button type="button" className={s.btn} onClick={() => setDuration(clip.durationSec - 0.5)} disabled={kind === 'video' && clip.durationSec <= 0.4}>−</button>
          <input
            className={s.durInput}
            type="number"
            min={0.4}
            step={0.1}
            value={Math.round(clip.durationSec * 10) / 10}
            onChange={(e) => setDuration(Number(e.target.value) || 0.4)}
          />
          <span className={s.unit}>s</span>
          <button type="button" className={s.btn} onClick={() => setDuration(clip.durationSec + 0.5)}>+</button>
        </div>
        {kind === 'image' ? (
          <div className={s.presets}>
            {IMAGE_PRESETS.map((sec) => (
              <button
                key={sec}
                type="button"
                className={s.preset}
                data-on={Math.abs(clip.durationSec - sec) < 0.05}
                onClick={() => setDuration(sec)}
              >
                {sec}s
              </button>
            ))}
          </div>
        ) : null}
        {kind === 'video' ? (
          <p className={s.hint}>Limited by source media ({formatTimecode(Math.max(0.4, (bin?.durationSec ?? clip.durationSec) - clip.sourceInSec))} max from In).</p>
        ) : (
          <p className={s.hint}>Drag clip edges on the timeline, or set an exact value here.</p>
        )}
      </div>

      {shot ? (
        <div className={s.block}>
          <div className={s.sectionLabel}>AI details</div>
          <div className={s.row}>
            <span className={s.key}>Purpose</span>
            <span className={s.val}>{purposeWord(shot.shotPurpose)}</span>
          </div>
          {shot.validationStatus ? (
            <div className={s.row}>
              <span className={s.key}>Status</span>
              <span className={s.val}>{shot.validationStatus}{shot.productIdentityWarning ? ' · identity warning' : ''}</span>
            </div>
          ) : null}
          {shot.generationPrompt ? (
            <p className={s.prompt}>{shot.generationPrompt}</p>
          ) : null}
        </div>
      ) : null}

      {clip.track.startsWith('a') && clip.text ? (
        <div className={s.block}>
          <div className={s.sectionLabel}>Narration</div>
          <p className={s.prompt}>{clip.text}</p>
        </div>
      ) : null}

      <div className={s.actions}>
        {clip.track.startsWith('v') ? (
          <button
            type="button"
            className={s.btnPrimary}
            disabled={d.aiBusy || !d.productStillPath}
            onClick={() => d.generateAiClip({
              mode: 'replace',
              purpose,
              prompt: shot?.generationPrompt || promptForPurpose(purpose, d.filmBrief),
              durationSec: clip.durationSec,
            })}
          >
            Regenerate
          </button>
        ) : null}
        {clip.previousBinId ? (
          <button type="button" className={s.btn} disabled={d.aiBusy} onClick={() => d.restoreClip(clip.id)}>
            Restore original
          </button>
        ) : null}
        <button type="button" className={s.btnDanger} onClick={() => d.removeClip(clip.id)}>
          Delete
        </button>
      </div>
    </aside>
  );
}
