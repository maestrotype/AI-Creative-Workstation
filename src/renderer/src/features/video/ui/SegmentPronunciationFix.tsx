import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { toAssetUrl } from '../model/directorMedia';
import { useDirector } from './DirectorBoard';
import vp from './VideoPage.module.css';

function ipcMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  if (typeof err === 'string' && err.trim()) return err.trim();
  return fallback;
}

type LexiconRow = { word: string; spoken: string };

const VOWELS = new Set('аеёиоуыэюяaeiouy');

function wordsIn(text: string): string[] {
  const found = text.match(/[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё-]*/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of found) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

/** Same letters. Only a stress mark on the chosen vowel — е stays е. */
function spellingForStress(word: string, index: number): string {
  const chars = [...word.toLowerCase()];
  if (!chars[index]) return word;
  chars[index] = `${chars[index]}\u0301`;
  return chars.join('');
}

function isVowel(letter: string): boolean {
  return VOWELS.has(letter.toLowerCase());
}

/** Pick a stressed vowel, listen to that word, then replace the clip on A1. */
export function SegmentPronunciationFix({
  index,
  text,
}: {
  index: number;
  text: string;
}): ReactNode {
  const d = useDirector();
  const words = useMemo(() => wordsIn(text), [text]);
  const [word, setWord] = useState('');
  const [spoken, setSpoken] = useState('');
  const [stressAt, setStressAt] = useState<number | null>(null);
  const [rules, setRules] = useState<LexiconRow[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const letters = [...word];

  useEffect(() => {
    const api = window.api;
    if (!api?.getVoiceLexicon) return undefined;
    let cancelled = false;
    api.getVoiceLexicon()
      .then((res) => {
        if (cancelled) return;
        const inLine = new Set(words.map((item) => item.toLowerCase()));
        setRules((res.entries ?? []).filter((entry) => inLine.has(entry.word.toLowerCase())));
      })
      .catch(() => {
        if (!cancelled) setRules([]);
      });
    return () => {
      cancelled = true;
    };
  }, [words, revision]);

  useEffect(() => {
    const api = window.api;
    if (!api?.prepareVoiceText) return undefined;
    const timer = window.setTimeout(() => {
      setPreviewBusy(true);
      api.prepareVoiceText({ text, apply_stress: false })
        .then((prep) => setPreview(prep.marked || prep.spoken))
        .catch(() => setPreview(null))
        .finally(() => setPreviewBusy(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [text, revision]);

  const pickWord = (item: string) => {
    setWord(item);
    setSpoken(item);
    setStressAt(null);
    setSaved(null);
    setError(null);
  };

  const pickVowel = (at: number) => {
    setStressAt(at);
    setSpoken(spellingForStress(word, at));
    setSaved(null);
  };

  const save = async (): Promise<boolean> => {
    const from = word.trim();
    const to = spoken.trim();
    if (!from || !to || !window.api?.fixVoicePronunciation) return false;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await window.api.fixVoicePronunciation({
        prompt: `${from} → ${to}`,
        context_text: text,
      });
      setSaved(d.t('video.pipe_fix_saved', { rule: `${res.word} → ${res.entry.spoken}` }));
      if (res.prepared?.marked || res.prepared?.spoken) {
        setPreview(res.prepared.marked || res.prepared.spoken);
      }
      setRevision((n) => n + 1);
      d.updateScriptSegment(index, {});
      return true;
    } catch (err) {
      setError(ipcMessage(err, d.t('video.dir_voice_fix_fail')));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const listen = async () => {
    const sample = spoken.trim();
    if (!sample || !window.api?.synthesizeVoice) return;
    setListening(true);
    setError(null);
    try {
      const result = await window.api.synthesizeVoice({
        text: sample,
        prepared_text: sample,
        skip_prepare: true,
      });
      const player = new Audio(toAssetUrl(result.file_path));
      await player.play();
    } catch (err) {
      setError(ipcMessage(err, d.t('video.dir_voice_fix_fail')));
    } finally {
      setListening(false);
    }
  };

  const updateClip = async () => {
    if (word.trim() && spoken.trim()) {
      const ok = await save();
      if (!ok) return;
    }
    await d.regenerateVoiceSegment(index);
  };

  const remove = async (key: string) => {
    if (!window.api?.deleteVoiceLexicon) return;
    setBusy(true);
    setError(null);
    try {
      await window.api.deleteVoiceLexicon(key);
      setRevision((n) => n + 1);
      d.updateScriptSegment(index, {});
    } catch (err) {
      setError(ipcMessage(err, d.t('video.dir_voice_fix_fail')));
    } finally {
      setBusy(false);
    }
  };

  const locked = busy || listening || d.voiceoverApplyBusy;

  return (
    <div className={vp.voPronFix}>
      <p className={vp.hintTight}>{d.t('video.pipe_fix_hint')}</p>
      <div className={vp.voPronWords}>
        {words.map((item) => (
          <button
            key={item.toLowerCase()}
            type="button"
            className={vp.voPronWord}
            data-on={word.toLowerCase() === item.toLowerCase() || undefined}
            onClick={() => pickWord(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {word ? (
        <div className={vp.voPronLetters} aria-label={d.t('video.pipe_fix_vowels')}>
          {letters.map((letter, at) => (
            isVowel(letter) ? (
              <button
                key={`${letter}-${at}`}
                type="button"
                className={vp.voPronLetter}
                data-on={stressAt === at || undefined}
                onClick={() => pickVowel(at)}
                disabled={locked}
              >
                {letter}
              </button>
            ) : (
              <span key={`${letter}-${at}`} className={vp.voPronLetterStatic}>{letter}</span>
            )
          ))}
        </div>
      ) : null}
      {stressAt != null ? (
        <p className={vp.hintTight}>{d.t('video.pipe_fix_mark_note')}</p>
      ) : null}
      <label className={vp.voPronField}>
        <span>{d.t('video.pipe_fix_spoken')}</span>
        <input
          className={vp.voPronInput}
          value={spoken}
          onChange={(e) => setSpoken(e.target.value)}
          placeholder={d.t('video.dir_voice_fix_ph')}
          disabled={locked}
        />
      </label>
      <div className={vp.toolRow}>
        <button
          type="button"
          className={vp.toolBtn}
          onClick={() => { void listen(); }}
          disabled={locked || !spoken.trim()}
        >
          {listening ? d.t('video.pipe_fix_listening') : d.t('video.pipe_fix_listen')}
        </button>
        <button
          type="button"
          className={vp.toolBtn}
          onClick={() => { void save(); }}
          disabled={locked || !word.trim() || !spoken.trim()}
        >
          {busy ? d.t('video.pipe_fix_applying') : d.t('video.dir_voice_fix')}
        </button>
        <button
          type="button"
          className={vp.toolPrimary}
          onClick={() => { void updateClip(); }}
          disabled={locked || !d.ttsReady}
        >
          {d.voiceoverApplyBusy ? d.t('video.pipe_fix_listening') : d.t('video.pipe_fix_revoice')}
        </button>
      </div>
      <div className={vp.voPronPreview}>
        <span className={vp.voPronPreviewLabel}>{d.t('video.pipe_fix_preview')}</span>
        <span className={vp.voPronPreviewText}>
          {previewBusy ? d.t('video.pipe_fix_preview_busy') : preview ?? '—'}
        </span>
      </div>
      <div className={vp.voPronRules}>
        <span className={vp.voPronPreviewLabel}>{d.t('video.pipe_fix_rules')}</span>
        {rules.length === 0 ? <p className={vp.hintTight}>{d.t('video.pipe_fix_none')}</p> : (
          <ul className={vp.voPronRuleList}>
            {rules.map((rule) => (
              <li key={rule.word}>
                <span>{rule.word} → {rule.spoken}</span>
                <button type="button" className={vp.voPronDelete} onClick={() => { void remove(rule.word); }} disabled={locked}>
                  {d.t('video.pipe_fix_delete')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {saved ? <p className={vp.voPronSaved}>{saved}</p> : null}
      {error ? <p className={vp.error}>{error}</p> : null}
    </div>
  );
}
