import { useMemo, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useDirector } from './DirectorBoard';
import styles from './FilmProcessMap.module.css';

type StageId = 'material' | 'analyze' | 'script' | 'review' | 'voice' | 'edit' | 'export';

interface Stage {
  id: StageId;
  done: boolean;
  /** Exactly one current pipeline step. */
  current: boolean;
  available: boolean;
  note: string;
}

/**
 * Film assembly map — clickable stages for this project.
 * Stages are the real voiceover/edit path; drag media onto «Материал».
 */
export function FilmProcessMap({
  onOpenVoiceover,
}: {
  onOpenVoiceover?: () => void;
} = {}): ReactNode {
  const { t } = useTranslation();
  const d = useDirector();
  const [open, setOpen] = useState(true);
  const [dropHot, setDropHot] = useState(false);

  const stages = useMemo<Stage[]>(() => {
    const hasV1 = d.clips.some((c) => c.track === 'v1');
    const hasAnalysis = Boolean(d.voiceover.analysis);
    const segs = d.voiceover.script?.segments ?? [];
    const hasScript = segs.length > 0;
    const hasIssues = segs.some((s) => (s.review_issues?.length ?? 0) > 0);
    const hasVoice = d.clips.some((c) => c.track === 'a1') || d.voiceover.status === 'voiced';
    const hasEdit = d.clips.length > 0;
    const hasExport = Boolean(d.exportPath);

    const raw: Array<Omit<Stage, 'current'>> = [
      {
        id: 'material',
        done: hasV1,
        available: true,
        note: hasV1
          ? t('video.process_material_ok', { n: d.clips.filter((c) => c.track.startsWith('v')).length })
          : t('video.process_material_need'),
      },
      {
        id: 'analyze',
        done: hasAnalysis,
        available: hasV1,
        note: hasAnalysis ? t('video.process_analyze_ok') : t('video.process_analyze_need'),
      },
      {
        id: 'script',
        done: hasScript,
        available: hasAnalysis,
        note: hasScript
          ? t('video.process_script_ok', { n: segs.length })
          : t('video.process_script_need'),
      },
      {
        id: 'review',
        done: hasScript && !hasIssues,
        available: hasScript,
        note: hasScript
          ? (hasIssues ? t('video.process_review_issues') : t('video.process_review_ok'))
          : t('video.process_review_wait'),
      },
      {
        id: 'voice',
        done: hasVoice,
        available: hasScript,
        note: hasVoice ? t('video.process_voice_ok') : t('video.process_voice_need'),
      },
      {
        id: 'edit',
        done: hasEdit && hasVoice,
        available: hasVoice || hasEdit,
        note: t('video.process_edit_note'),
      },
      {
        id: 'export',
        done: hasExport,
        available: hasEdit && hasVoice,
        note: hasExport ? t('video.process_export_ok') : t('video.process_export_need'),
      },
    ];

    const currentId = raw.find((s) => !s.done)?.id ?? null;
    return raw.map((s) => ({
      ...s,
      current: s.id === currentId,
    }));
  }, [d.clips, d.voiceover, d.exportPath, t]);

  const runStage = (id: StageId, available: boolean) => {
    if (!available) return;
    if (id === 'material') return;
    if (id === 'analyze') {
      onOpenVoiceover?.();
      void d.analyzeVoiceover();
      return;
    }
    if (id === 'script' || id === 'review') {
      onOpenVoiceover?.();
      if (!d.voiceover.script?.segments.length) void d.generateScript();
      return;
    }
    if (id === 'voice') {
      onOpenVoiceover?.();
      if (d.voiceover.script?.segments.length) void d.applyScriptVoiceover();
      return;
    }
    if (id === 'edit') {
      return;
    }
    if (id === 'export') {
      void d.exportVideo();
    }
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDropHot(false);
    if (event.dataTransfer.files.length > 0) {
      d.ingestDropped(event.dataTransfer.files);
    }
  };

  return (
    <section className={styles.root} data-open={open || undefined}>
      <header className={styles.head}>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={t('video.process_lead')}
        >
          {open ? '▾' : '▸'} {t('video.process_title')}
        </button>
      </header>
      {open ? (
        <div
          className={styles.map}
          data-drop={dropHot || undefined}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            setDropHot(true);
          }}
          onDragLeave={() => setDropHot(false)}
          onDrop={onDrop}
        >
          {stages.map((stage, index) => {
            const disabled = !stage.available;
            return (
              <div key={stage.id} className={styles.stepWrap}>
                {index > 0 ? <span className={styles.arrow} aria-hidden>→</span> : null}
                <button
                  type="button"
                  className={styles.step}
                  data-done={stage.done || undefined}
                  data-current={stage.current || undefined}
                  data-disabled={disabled || undefined}
                  data-drop={stage.id === 'material' && dropHot ? true : undefined}
                  title={stage.note}
                  disabled={disabled && stage.id !== 'material'}
                  aria-disabled={disabled || undefined}
                  onClick={() => runStage(stage.id, stage.available || stage.id === 'material')}
                >
                  <span className={styles.stepName}>{t(`video.process_${stage.id}`)}</span>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
