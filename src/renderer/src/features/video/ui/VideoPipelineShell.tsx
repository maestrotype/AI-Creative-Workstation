import { useEffect, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useDirector } from './DirectorBoard';
import { DirectorPreview } from './DirectorPreview';
import { DirectorResultPane, DirectorTimelinePane } from './DirectorPanes';
import { VoiceSampleSetup } from './VoiceSampleSetup';
import { formatTimecode } from '../model/videoAnalysis';
import vp from './VideoPage.module.css';
import s from './VideoPipelineShell.module.css';

type PipelineStage = 'material' | 'analyze' | 'brief' | 'script' | 'voice' | 'export';

const STAGES: PipelineStage[] = ['material', 'analyze', 'brief', 'script', 'voice', 'export'];

type Director = ReturnType<typeof useDirector>;

/** Furthest stage the user may open, based on real session progress. */
function maxUnlockedIndex(d: Director): number {
  if (d.voiceover.status === 'voiced') return 5;
  if (d.voiceover.script?.segments.length) return 4;
  if (d.voiceover.analysis) return 2;
  if (d.voiceoverSource) return 1;
  return 0;
}

/** Best stage to land on when entering pipeline mode. */
function deriveStage(d: Director): PipelineStage {
  if (d.voiceover.status === 'voiced') return 'export';
  if (d.voiceover.script?.segments.length) return 'script';
  if (d.voiceover.analysis) return 'brief';
  if (d.voiceoverSource) return 'analyze';
  return 'material';
}

export function VideoPipelineShell(): ReactNode {
  const d = useDirector();
  const [stage, setStage] = useState<PipelineStage>(() => deriveStage(d));
  const maxIdx = maxUnlockedIndex(d);
  const stageIdx = STAGES.indexOf(stage);

  useEffect(() => {
    if (STAGES.indexOf(stage) > maxIdx) setStage(STAGES[maxIdx]);
  }, [stage, maxIdx]);

  // Auto-advance: analyze finished → brief.
  const prevAnalyzeBusy = useRef(d.voiceoverBusy);
  useEffect(() => {
    const was = prevAnalyzeBusy.current;
    prevAnalyzeBusy.current = d.voiceoverBusy;
    if (was && !d.voiceoverBusy && d.voiceover.analysis && !d.voiceoverError) {
      setStage((cur) => (cur === 'analyze' ? 'brief' : cur));
    }
  }, [d.voiceoverBusy, d.voiceover.analysis, d.voiceoverError]);

  // Auto-advance: script generated → script review.
  const prevScriptBusy = useRef(d.scriptBusy);
  useEffect(() => {
    const was = prevScriptBusy.current;
    prevScriptBusy.current = d.scriptBusy;
    if (was && !d.scriptBusy && d.voiceover.script?.segments.length && !d.scriptError) {
      setStage((cur) => (cur === 'brief' ? 'script' : cur));
    }
  }, [d.scriptBusy, d.voiceover.script, d.scriptError]);

  // Auto-advance: voiceover applied → export.
  const prevApplyBusy = useRef(d.voiceoverApplyBusy);
  useEffect(() => {
    const was = prevApplyBusy.current;
    prevApplyBusy.current = d.voiceoverApplyBusy;
    if (was && !d.voiceoverApplyBusy && d.voiceover.status === 'voiced' && !d.voiceoverApplyError) {
      setStage((cur) => (cur === 'voice' ? 'export' : cur));
    }
  }, [d.voiceoverApplyBusy, d.voiceover.status, d.voiceoverApplyError]);

  // Auto-advance: video appeared while on material stage.
  const prevSource = useRef(Boolean(d.voiceoverSource));
  useEffect(() => {
    const had = prevSource.current;
    const has = Boolean(d.voiceoverSource);
    prevSource.current = has;
    if (!had && has) setStage((cur) => (cur === 'material' ? 'analyze' : cur));
  }, [d.voiceoverSource]);

  const doneFlags: Record<PipelineStage, boolean> = {
    material: Boolean(d.voiceoverSource),
    analyze: Boolean(d.voiceover.analysis),
    brief: Boolean(d.voiceover.script?.segments.length),
    script: d.voiceover.status === 'voiced',
    voice: d.voiceover.status === 'voiced',
    export: Boolean(d.exportPath),
  };

  return (
    <div className={s.shell}>
      <div className={s.column}>
        <ol className={s.stepper}>
          {STAGES.map((id, index) => {
            const state = id === stage ? 'current' : doneFlags[id] ? 'done' : 'upcoming';
            return (
              <li key={id}>
                <button
                  type="button"
                  className={s.step}
                  data-state={state}
                  disabled={index > maxIdx}
                  onClick={() => setStage(id)}
                >
                  <span className={s.stepNum}>{doneFlags[id] && id !== stage ? '✓' : index + 1}</span>
                  <span>{d.t(`video.pipe_step_${id}`)}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <section className={s.stageCard}>
          <header className={s.stageHead}>
            <h3 className={s.stageTitle}>{d.t(`video.pipe_title_${stage}`)}</h3>
            <p className={s.stageHint}>{d.t(`video.pipe_hint_${stage}`)}</p>
          </header>

          {stage === 'material' ? <StageMaterial /> : null}
          {stage === 'analyze' ? <StageAnalyze /> : null}
          {stage === 'brief' ? <StageBrief /> : null}
          {stage === 'script' ? <StageScript /> : null}
          {stage === 'voice' ? <StageVoice /> : null}
          {stage === 'export' ? <StageExport /> : null}

          <footer className={s.nav}>
            {stageIdx > 0 ? (
              <button type="button" className={vp.toolBtn} onClick={() => setStage(STAGES[stageIdx - 1])}>
                {d.t('video.pipe_back')}
              </button>
            ) : <span />}
            {stageIdx < STAGES.length - 1 ? (
              <button
                type="button"
                className={vp.toolPrimary}
                disabled={stageIdx + 1 > maxIdx}
                onClick={() => setStage(STAGES[stageIdx + 1])}
              >
                {d.t('video.pipe_continue')}
              </button>
            ) : null}
          </footer>
        </section>
      </div>
    </div>
  );
}

function hasOsFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function SourceRow(): ReactNode {
  const d = useDirector();
  const source = d.voiceoverSource;
  if (!source) return null;
  return (
    <div className={vp.voSource}>
      <span className={vp.voSourceLabel}>{d.t('video.vo_source')}</span>
      <strong>{source.name}</strong>
      <span className={vp.voSourceFrom}>{d.t(`video.vo_source_${source.from}`)}</span>
    </div>
  );
}

function StageMaterial(): ReactNode {
  const d = useDirector();
  const source = d.voiceoverSource;

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasOsFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files.length > 0) {
      d.ingestDropped(event.dataTransfer.files);
    }
  };

  return (
    <div className={s.stageBody} onDragOver={onDragOver} onDrop={onDrop}>
      {source ? (
        <>
          <SourceRow />
          <p className={vp.hintTight}>{d.t('video.pipe_material_ready')}</p>
        </>
      ) : (
        <div className={s.dropZone}>{d.t('video.pipe_material_drop')}</div>
      )}
      <div className={vp.toolRow}>
        <button type="button" className={source ? vp.toolBtn : vp.toolPrimary} onClick={d.pickVideo}>
          {source ? d.t('video.vo_pick_other') : d.t('video.dir_add_video')}
        </button>
      </div>
    </div>
  );
}

function StageAnalyze(): ReactNode {
  const d = useDirector();
  const ctx = d.voiceover.analysis;
  const busy = d.voiceoverBusy;
  const canAnalyze = Boolean(d.voiceoverSource?.path) && !busy;

  return (
    <div className={s.stageBody}>
      <SourceRow />
      <div className={vp.toolRow}>
        {ctx ? (
          <span className={vp.voAnalyzeReady}>{d.t('video.vo_analyze_ready')}</span>
        ) : (
          <button type="button" className={vp.toolPrimary} onClick={d.analyzeVoiceover} disabled={!canAnalyze}>
            {busy ? d.t('video.vo_analyzing') : d.t('video.vo_analyze')}
          </button>
        )}
        {ctx ? (
          <button type="button" className={vp.toolBtn} onClick={d.reanalyzeVoiceover} disabled={!canAnalyze}>
            {busy ? d.t('video.vo_analyzing') : d.t('video.vo_reanalyze')}
          </button>
        ) : null}
        <button type="button" className={vp.toolBtn} onClick={d.pickVideo} disabled={busy}>
          {d.t('video.vo_pick_other')}
        </button>
      </div>

      {busy ? (
        <div className={vp.progressBox}>
          <div className={vp.progressTrack}>
            <div className={vp.progressFill} style={{ width: `${Math.max(4, d.voiceoverProgress.percent)}%` }} />
          </div>
          <p className={vp.hintTight}>{d.voiceoverProgress.detail}</p>
        </div>
      ) : null}
      {d.voiceoverError ? <p className={vp.error}>{d.voiceoverError}</p> : null}

      {ctx ? (
        <div className={vp.analysisBox}>
          <p className={vp.output}>
            {d.t('video.vo_summary', {
              duration: formatTimecode(ctx.duration_sec),
              scenes: ctx.scenes.length,
              words: ctx.transcript.full_text.split(/\s+/).filter(Boolean).length,
            })}
          </p>
          {ctx.warnings?.includes('WHISPER_NOT_INSTALLED') ? (
            <p className={vp.hintTight}>{d.t('video.vo_whisper_missing')}</p>
          ) : null}
          <details className={vp.voDetails}>
            <summary>{d.t('video.vo_scenes')}</summary>
            <ul className={vp.scenes}>
              {ctx.scenes.map((scene) => (
                <li key={scene.index}>
                  {formatTimecode(scene.start)} – {formatTimecode(scene.end)}
                </li>
              ))}
            </ul>
          </details>
          {ctx.transcript.segments.length > 0 ? (
            <details className={vp.voDetails}>
              <summary>{d.t('video.vo_show_transcript')}</summary>
              <ul className={vp.transcriptList}>
                {ctx.transcript.segments.map((seg, i) => (
                  <li key={`${seg.start}-${i}`}>
                    <span className={vp.ts}>{formatTimecode(seg.start)}</span>
                    {seg.text}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StageBrief(): ReactNode {
  const d = useDirector();
  const busy = d.scriptBusy;
  const hasScript = Boolean(d.voiceover.script?.segments.length);
  const [ollamaReady, setOllamaReady] = useState<boolean | null>(null);

  useEffect(() => {
    void window.api?.getOllamaEngineStatus?.().then((status) => {
      setOllamaReady(Boolean(status?.model_ready && status?.server_running));
    }).catch(() => setOllamaReady(null));
    const cleanup = window.api?.onOllamaEngineUpdated?.((status) => {
      setOllamaReady(Boolean(status.model_ready && status.server_running));
    });
    return () => { cleanup?.(); };
  }, []);

  return (
    <div className={s.stageBody}>
      {ollamaReady === false ? (
        <p className={vp.voScriptNotice}>
          {d.t('video.vo_script_fallback_note')}{' '}
          <Link className={vp.voStudioLink} to="/studio?family=llm">{d.t('video.vo_script_open_studio')}</Link>
        </p>
      ) : null}
      <label className={vp.voPromptLabel}>
        <span>{d.t('video.vo_script_prompt')}</span>
        <textarea
          className={vp.voPromptInput}
          rows={6}
          value={d.voiceover.scriptPrompt}
          onChange={(e) => d.setScriptPrompt(e.target.value)}
          placeholder={d.t('video.vo_script_prompt_placeholder')}
          disabled={busy}
        />
      </label>
      <div className={vp.toolRow}>
        <button
          type="button"
          className={vp.toolPrimary}
          onClick={d.generateScript}
          disabled={busy || !d.voiceover.analysis}
        >
          {busy
            ? d.t('video.vo_script_generating')
            : hasScript
              ? d.t('video.pipe_regenerate')
              : d.t('video.vo_script_generate')}
        </button>
      </div>
      {d.scriptError ? <p className={vp.error}>{d.scriptError}</p> : null}
    </div>
  );
}

function StageScript(): ReactNode {
  const d = useDirector();
  const script = d.voiceover.script;
  const analysis = d.voiceover.analysis;
  const busy = d.scriptBusy || d.voiceoverApplyBusy;

  if (!script) {
    return <p className={vp.hintTight}>{d.t('video.vo_script_empty_hint')}</p>;
  }

  const coverageSec = script.segments.length
    ? Math.max(...script.segments.map((seg) => seg.end_sec))
    : 0;
  const videoSec = analysis?.duration_sec ?? 0;

  return (
    <div className={s.split}>
      <div className={s.splitCol}>
        <p className={vp.voScriptStatus}>
          {d.t('video.vo_script_saved', { count: script.segments.length })}
          {' · '}
          {script.meta.provider === 'ollama'
            ? d.t('video.vo_script_provider_ollama')
            : d.t('video.vo_script_provider_fallback')}
          {videoSec > 0 ? (
            <>
              {' · '}
              {d.t('video.vo_script_coverage', {
                covered: formatTimecode(coverageSec),
                total: formatTimecode(videoSec),
              })}
            </>
          ) : null}
        </p>
        {script.meta.provider === 'fallback' ? (
          <p className={vp.voScriptNotice}>
            {d.t('video.vo_script_fallback_note')}{' '}
            <Link className={vp.voStudioLink} to="/studio?family=llm">{d.t('video.vo_script_open_studio')}</Link>
          </p>
        ) : null}
        <p className={vp.hintTight}>{d.t('video.pipe_script_seek_hint')}</p>
        <div className={`${vp.voScriptTableWrap} ${s.tableScroll}`}>
          <table className={vp.voScriptTable}>
            <thead>
              <tr>
                <th>{d.t('video.vo_script_col_time')}</th>
                <th>{d.t('video.vo_script_col_text')}</th>
              </tr>
            </thead>
            <tbody>
              {script.segments.map((seg, index) => {
                const live = d.playhead >= seg.start_sec && d.playhead < seg.end_sec;
                return (
                  <tr key={`${seg.start_sec}-${index}`} data-live={live} className={s.scriptRow}>
                    <td className={vp.voScriptTime}>
                      <button
                        type="button"
                        className={s.timeBtn}
                        title={d.t('video.pipe_script_seek_hint')}
                        onClick={() => d.seekTo(seg.start_sec)}
                      >
                        {formatTimecode(seg.start_sec)} – {formatTimecode(seg.end_sec)}
                      </button>
                      <span className={vp.voScriptRole}>{seg.role}</span>
                    </td>
                    <td>
                      <textarea
                        className={vp.voScriptText}
                        rows={2}
                        value={seg.text}
                        onChange={(e) => d.updateScriptSegment(index, { text: e.target.value })}
                        disabled={busy}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className={s.splitCol}>
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
          onDecodeFail={(binId) => {
            const bin = d.bins.find((item) => item.id === binId);
            if (!bin || bin.proxying) return;
            d.applyProxy(binId, true);
          }}
        />
        <div className={vp.toolRow}>
          <button
            type="button"
            className={vp.toolBtn}
            onClick={d.togglePlay}
            disabled={d.clips.length === 0}
          >
            {d.playing ? d.t('video.dir_pause') : d.t('video.dir_play')}
          </button>
          <button type="button" className={vp.toolBtn} onClick={() => d.seekTo(0)}>
            {d.t('video.dir_stop')}
          </button>
        </div>
      </div>
    </div>
  );
}

function StageVoice(): ReactNode {
  const d = useDirector();
  const busy = d.scriptBusy || d.voiceoverApplyBusy;
  const voiced = d.voiceover.status === 'voiced';

  return (
    <div className={s.stageBody}>
      <VoiceSampleSetup />
      <div className={vp.toolRow}>
        <button
          type="button"
          className={vp.toolPrimary}
          onClick={d.applyScriptVoiceover}
          disabled={busy || !d.ttsReady || voiced}
        >
          {d.voiceoverApplyBusy
            ? d.t('video.vo_voice_applying', {
                current: d.voiceoverApplyProgress.current,
                total: d.voiceoverApplyProgress.total,
              })
            : d.t('video.vo_voice_apply')}
        </button>
      </div>
      {d.voiceoverApplyBusy ? (
        <p className={vp.hintTight}>{d.voiceoverApplyProgress.detail}</p>
      ) : null}
      {d.voiceoverApplyError ? <p className={vp.error}>{d.voiceoverApplyError}</p> : null}
      {voiced ? (
        <p className={vp.voScriptStatus}>{d.t('video.vo_after_voice_hint')}</p>
      ) : (
        <p className={vp.hintTight}>{d.t('video.vo_voice_apply_hint')}</p>
      )}
    </div>
  );
}

function StageExport(): ReactNode {
  const d = useDirector();
  return (
    <div className={s.stageBody}>
      <div className={s.exportPreview}>
        <DirectorResultPane />
      </div>
      <details className={s.timelineDetails}>
        <summary>{d.t('video.pipe_timeline_toggle')}</summary>
        <div className={s.timelineBox}>
          <DirectorTimelinePane />
        </div>
      </details>
    </div>
  );
}
