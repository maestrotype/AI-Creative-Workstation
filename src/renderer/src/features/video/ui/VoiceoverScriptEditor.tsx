import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { studioHref } from '../../studio/model/studioReturn';
import { useDirector } from './DirectorBoard';
import { LlmEngineNotice } from './LlmEngineNotice';
import { VoiceSampleSetup } from './VoiceSampleSetup';
import { SegmentPronunciationFix } from './SegmentPronunciationFix';
import { narrationClipTitle } from '../model/clipDisplayName';
import { segmentSpoken, type NarrationLang } from '../model/voiceoverScript';
import { formatTimecode } from '../model/videoAnalysis';
import styles from './VideoPage.module.css';

function scriptCoverageSec(script: NonNullable<ReturnType<typeof useDirector>['voiceover']['script']>): number {
  if (!script.segments.length) return 0;
  return Math.max(...script.segments.map((seg) => seg.end_sec));
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function VoiceDictation(): ReactNode {
  const d = useDirector();
  const { i18n } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const language = i18n.language.toLowerCase().startsWith('en') ? 'en' : 'ru';

  const applyText = (text: string) => {
    const spoken = text.trim();
    if (!spoken) {
      setError(d.t('video.vo_dictate_empty'));
      return;
    }
    const current = d.voiceover.scriptPrompt.trim();
    d.setScriptPrompt(current ? `${current}\n${spoken}` : spoken);
    setError(null);
  };

  const transcribePath = async (path: string) => {
    if (!window.api?.transcribeAudio) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.api.transcribeAudio({ path, language });
      applyText(result.full_text || '');
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(/WHISPER_NOT_INSTALLED/i.test(raw) ? d.t('video.vo_whisper_missing') : raw);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (!window.api?.startMicRecord || !window.api.stopMicRecord) return;
    if (d.voiceRecording || d.voiceSampleRecording) {
      setError(d.t('video.vo_voice_sample_busy'));
      return;
    }
    if (recording) {
      setBusy(true);
      try {
        const stopped = await window.api.stopMicRecord();
        setRecording(false);
        await transcribePath(stopped.file_path);
      } catch (err) {
        setRecording(false);
        setError(err instanceof Error ? err.message : d.t('video.dir_voice_fail'));
        setBusy(false);
      }
      return;
    }
    setError(null);
    try {
      await window.api.startMicRecord('wav');
      setRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : d.t('video.dir_voice_fail'));
    }
  };

  const fromFile = async () => {
    const picked = await window.api?.pickAudio?.();
    if (picked) await transcribePath(picked);
  };

  return (
    <>
      <div className={styles.toolRow}>
        <button type="button" className={recording ? styles.toolPrimary : styles.toolBtn} onClick={() => { void toggle(); }} disabled={busy}>
          {recording ? d.t('video.vo_dictate_stop') : d.t('video.vo_dictate_record')}
        </button>
        <button type="button" className={styles.toolBtn} onClick={() => { void fromFile(); }} disabled={busy || recording}>
          {busy ? d.t('video.vo_dictate_working') : d.t('video.vo_dictate_file')}
        </button>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </>
  );
}

export function VoiceoverScriptEditor(): ReactNode {
  const d = useDirector();
  const [pronIndex, setPronIndex] = useState<number | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const script = d.voiceover.script;
  const analysis = d.voiceover.analysis;
  const busy = d.scriptBusy || d.voiceoverApplyBusy || translating;
  const voiced = d.voiceover.status === 'voiced';
  const lang: NarrationLang = d.voiceover.narrationLang
    ?? (script?.meta.language?.startsWith('en') ? 'en' : 'ru');
  const cardTitles: string[] = [];
  for (const seg of script?.segments ?? []) {
    cardTitles.push(narrationClipTitle(segmentSpoken(seg, lang), cardTitles.at(-1)));
  }

  const coverageSec = script ? scriptCoverageSec(script) : 0;
  const videoSec = analysis?.duration_sec ?? 0;

  const showEnglish = async () => {
    setTranslateError(null);
    if (!script) {
      d.setNarrationLang('en');
      return;
    }
    const stale = script.segments.flatMap((seg, index) => (
      seg.text.trim() && !seg.text_en?.trim() ? [index] : []
    ));
    if (!stale.length || !window.api?.translateScript) {
      d.setNarrationLang('en');
      return;
    }
    setTranslating(true);
    try {
      const result = await window.api.translateScript({
        lines: script.segments.map((seg) => seg.text),
        source: 'ru',
        target: 'en',
        ollama_model: d.scriptModel || undefined,
      });
      const pending = new Set(stale);
      result.lines.forEach((line, index) => {
        if (pending.has(index)) d.updateScriptSegment(index, { text_en: line });
      });
      d.setNarrationLang('en');
    } catch (err) {
      const message = err instanceof Error ? err.message : d.t('video.vo_translate_fail');
      setTranslateError(message);
    } finally {
      setTranslating(false);
    }
  };

  return (
    <div className={styles.voScriptBlock}>
      <h4 className={styles.voSubtitle}>{d.t('video.vo_script_title')}</h4>
      <LlmEngineNotice />
      <label className={styles.voPromptLabel}>
        <span>{d.t('video.vo_script_prompt')}</span>
        <textarea
          className={styles.voPromptInput}
          rows={3}
          value={d.voiceover.scriptPrompt}
          onChange={(e) => d.setScriptPrompt(e.target.value)}
          placeholder={d.t('video.vo_script_prompt_placeholder')}
          disabled={busy}
        />
      </label>
      <p className={styles.hintTight}>{d.t('video.vo_dictate_hint')}</p>
      <VoiceDictation />
      <div className={styles.toolRow}>
        <button
          type="button"
          className={styles.toolPrimary}
          onClick={d.generateScript}
          disabled={busy || !d.voiceover.analysis}
        >
          {d.scriptBusy ? d.t('video.vo_script_generating') : d.t('video.vo_script_generate')}
        </button>
      </div>
      {script ? (
        <>
          <p className={styles.voScriptStatus}>
            {d.t('video.vo_script_saved', { count: script.segments.length })}
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
            <p className={styles.voScriptNotice}>
              {d.t('video.vo_script_fallback_note')}{' '}
              <Link className={styles.voStudioLink} to={studioHref('llm', '/video')}>{d.t('video.vo_script_open_studio')}</Link>
            </p>
          ) : null}
          <p className={styles.hintTight}>{d.t('video.vo_script_edit_hint')}</p>
          <div className={styles.voLangTabs} role="tablist" aria-label={d.t('video.vo_lang_label')}>
            <button
              type="button"
              role="tab"
              data-on={lang === 'ru' || undefined}
              aria-selected={lang === 'ru'}
              onClick={() => d.setNarrationLang('ru')}
              disabled={translating}
            >
              {d.t('video.vo_lang_ru')}
            </button>
            <button
              type="button"
              role="tab"
              data-on={lang === 'en' || undefined}
              aria-selected={lang === 'en'}
              onClick={() => { void showEnglish(); }}
              disabled={translating}
            >
              {translating ? d.t('video.vo_translating') : d.t('video.vo_lang_en')}
            </button>
          </div>
          <p className={styles.hintTight}>{d.t('video.vo_lang_hint')}</p>
          {translateError ? <p className={styles.error}>{translateError}</p> : null}
          <div className={styles.voScriptCards}>
            {script.segments.map((seg, index) => {
              const shown = segmentSpoken(seg, lang);
              const title = cardTitles[index];
              const words = wordCount(shown);
              const spoken = seg.speech_sec ?? seg.estimated_sec;
              return (
                <article key={`${seg.start_sec}-${index}`} className={styles.voScriptCard}>
                  <header className={styles.voScriptCardHead}>
                    <span className={styles.voScriptTime}>
                      {formatTimecode(seg.start_sec)} – {formatTimecode(seg.end_sec)}
                    </span>
                    <span className={styles.voScriptRole}>{title}</span>
                    {lang === 'ru' ? (
                      <button
                        type="button"
                        className={styles.voPronToggle}
                        data-on={pronIndex === index || undefined}
                        onClick={() => setPronIndex(pronIndex === index ? null : index)}
                      >
                        {d.t('video.pipe_fix_toggle')}
                      </button>
                    ) : null}
                    <span className={styles.voScriptWords}>
                      {words}
                      {spoken != null && spoken > 0 ? ` · ${Math.round(spoken * 10) / 10} с` : ''}
                    </span>
                  </header>
                  <textarea
                    className={styles.voScriptText}
                    rows={Math.min(8, Math.max(4, Math.ceil((shown.length || 40) / 42)))}
                    value={shown}
                    placeholder={lang === 'en'
                      ? d.t('video.vo_translate_empty')
                      : (seg.text_en ? d.t('video.vo_ru_empty') : undefined)}
                    onChange={(e) => d.updateScriptSegment(
                      index,
                      lang === 'en'
                        ? { text_en: e.target.value, review_issues: undefined }
                        : { text: e.target.value, text_en: '', review_issues: undefined },
                    )}
                    disabled={busy}
                  />
                  {seg.review_issues?.length ? (
                    <p className={styles.hintTight}>Проверка: {seg.review_issues.join('; ')}.</p>
                  ) : null}
                  {lang === 'ru' && pronIndex === index ? (
                    <SegmentPronunciationFix index={index} text={seg.text} />
                  ) : null}
                  {seg.audio_path ? (
                    <button
                      type="button"
                      className={styles.toolBtn}
                      onClick={() => d.regenerateVoiceSegment(index)}
                      disabled={busy || !d.ttsReady}
                    >
                      Заново озвучить
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
          <div className={styles.voNextStep}>
            <div className={styles.toolRow}>
              <button type="button" className={styles.toolBtn} onClick={d.createCaptionsFromScript} disabled={busy}>
                Add captions to timeline
              </button>
              <button type="button" className={styles.toolBtn} onClick={d.exportSubtitles} disabled={busy}>
                Export SRT
              </button>
            </div>
            <VoiceSampleSetup />
            {(() => {
              const hasValidSample = Boolean(d.voiceHasSample && (d.voiceSampleSec ?? 0) >= 0.5);
              const canApply = !busy && d.ttsReady && hasValidSample;
              return (
                <>
                  <button
                    type="button"
                    className={styles.toolPrimary}
                    onClick={d.applyScriptVoiceover}
                    disabled={!canApply}
                  >
                    {d.voiceoverApplyBusy
                      ? d.t('video.vo_voice_applying', {
                          current: d.voiceoverApplyProgress.current,
                          total: d.voiceoverApplyProgress.total,
                        })
                      : voiced
                        ? d.t('video.vo_voice_apply_again')
                        : d.t('video.vo_voice_apply')}
                  </button>
                  {d.voiceoverApplyBusy ? (
                    <p className={styles.hintTight}>{d.voiceoverApplyProgress.detail}</p>
                  ) : null}
                  {d.voiceoverApplyError ? <p className={styles.error}>{d.voiceoverApplyError}</p> : null}
                  <button
                    type="button"
                    className={styles.toolBtn}
                    onClick={d.alignNarrationToPicture}
                    disabled={busy}
                  >
                    Убрать паузы в A1
                  </button>
                  {d.narrationAlignNote ? <p className={styles.hintTight}>{d.narrationAlignNote}</p> : null}
                  {!hasValidSample ? (
                    <p className={styles.hintTight}>{d.t('video.vo_sample_need_record')}</p>
                  ) : voiced ? (
                    <p className={styles.voScriptStatus}>{d.t('video.vo_after_voice_hint')}</p>
                  ) : (
                    <p className={styles.hintTight}>{d.t('video.vo_voice_apply_hint')}</p>
                  )}
                </>
              );
            })()}
          </div>
        </>
      ) : (
        <p className={styles.hintTight}>{d.t('video.vo_script_empty_hint')}</p>
      )}
    </div>
  );
}
