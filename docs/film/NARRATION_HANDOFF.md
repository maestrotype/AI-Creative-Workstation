# Film narration handoff

Read this before touching voiceover. The current film is the marketplace listing «Новый проект» (`d15a585d-ab9d-4032-8a43-f7fdb07189c6`), not the old 62-second demo below.

Python in the sidecar is not hot-reloaded. After editing `sidecar/*.py`, fully quit the app and open it again.

## Current rules (do not undo one by “fixing” another)

The picture on V1 is the clock, including stills. The ready chapter text is `scene.prompt` in `project.json` (Russian). Frame analysis says what is visible. It does not replace the script and it does not switch the language to English.

1. Measure each chapter on the timeline (the trimmed length, not the original file).
2. A chapter longer than 18s is several beats of about 14s. Each beat has a word budget at 130 words/minute (`chapterSpeech.ts`).
3. The ready script is the meaning. If a beat already has about that many words, keep it. If it is short, expand it from those same facts (`expand_spoken`). If it is long, trim it. Do not invent a new English ad.
4. After XTTS, measure the wav. Speech under 75% of the beat is still too short: expand and speak again. Speech over 15% too long is shortened, then sped up at most 15%. A small remainder is silence inside the same beat.
5. The next line starts at its own beat. A long line must not push the later lines down the timeline (`pictureSlots` / script windows in `applyScriptVoiceover`).
6. `lock-*` and `fit-*` wavs under `Generated/Audio/_processing/` are pipeline temps. They are not voice samples and must not appear in «Доступные образцы голоса».
7. Ollama sometimes returns Chinese translator chatter or JSON debris instead of a line. `valid_narration_line` rejects that; the beat falls back to the ready chapter text, not into the script card.
8. Do not pad a beat by restating the same claim («файлы в комплекте… те же файлы…»). Extra length comes from a new picture fact or a clean close. Opening/closing stills get a short intro/outro. Chapter windows abut — no silence gaps between chapters (gaps hiss). Transitions are in the wording.

«Заменить мою озвучку» on a film with chapters runs this path (`replaceOwnNarration`). `generateScript` still exists for a single uploaded video and still asks for English. Do not point the chapter button at it.

What went wrong when these were split:

| Only this | Result |
|-----------|--------|
| Pack wavs one after another | A1 edges drift off V1. Hook 16.9s sits on a 12s Hero and shoves everything after it. |
| Lock the clip to the picture and pad silence | Bars match (Hook 12s, Body 17s) but the mouth is a 3s English sentence. The ready Russian chapter (about 34–85 words) was thrown away. |
| Generate from vision in English | “The advertisement highlights a new bag collection…” instead of the authored store script. |

## Historical: 62s demo

The notes below describe `8cd095b2-7f44-4e38-ac81-709d5080ad7a`. Do not re-apply “clip length = wav, never fill a window” to the marketplace film. That rule made the holes the listing film is now trying to close.

Read this before touching voiceover. Trust `sidecar/script_llm.py`, `DirectorBoard.tsx` apply/generate, and the live `project.json` over older traces.

**Branch:** `fix/narration-vlm-understanding`  
**Demo film:** `8cd095b2-7f44-4e38-ac81-709d5080ad7a`  
**On disk:** `~/Documents/Canvas/Projects/8cd095b2-7f44-4e38-ac81-709d5080ad7a/project.json`  
**Assembled picture:** ~62.222s, two muted V1 screencasts (0–28.23 and 28.23–62.2).  
**Models:** vision `qwen2.5vl:7b`, script `qwen2.5:14b`, TTS XTTS. Analysis cache is already VLM (`visual_quality: vlm`). **Do not re-run VLM.**

Python in the sidecar process is not hot-reloaded. After editing `sidecar/*.py`, fully quit the app and open it again before judging Generate.

## What we were doing

The VLM and preview timeline already work. The remaining job is the **narrative planner** plus **one version of the film**:

```
Visual events (analysis windows, do not rewrite)
  → narrative units (related pictures, ≤12s)
  → one finished spoken thought
  → TTS wav
  → A1 clip duration = measured wav
  → next clip at max(previous mouth + 0.4s, picture − 6s lead)
```

A1 must be the current script. Empty A1 is allowed only while TTS is running. A fake full-width “Narration” bar is not a clip.

## Fixed (do not reopen)

| Problem | Fix |
|---------|-----|
| Vision model missing / degraded warning while 7B was installed | Earlier on this branch. Leave `scene_understand.py` / `video_analyze.py` alone. |
| Black preview / empty `clipAtTime` at a cut | `clipAtTime` still shows a clip 0.35s past its out-point. Preview seeks on `readyState >= 1`. Do not select A1 after ingest. |
| Fake A1 bar labeled Narration 1:02 with no wav | Removed from `TrackMixer`. Empty lane = no blocks. |
| Generate wiped A1, V1 is muted, playback silent | Generate no longer leaves old wavs. It **clears A1 then voices the new script**. Status `scripted` then `voiced`. |
| Script Y on the right, audio X on A1 | `script_version` on generate. Apply writes `speech_sec` + `audio_path`. Clips labeled Hook/Body/CTA. |
| One 9s “slot” with 4.7s of speech and silence inside | Windows are not speech slots. Clip length = wav. Word budget `19 / ~12` removed from the editor. Apply does not `shorten_spoken` to fit a window. |
| «Пользователь перешел…», «Теперь перейдите…», circular «X позволяет вам X» | Tour planner. Captions and commands unwrapped or dropped. |
| One caption per ~9s window, or 18s of mixed facts spoken at the first frame | Units max 12s. Catalog→product 9s later is a new line. 3D sneaker at 0:28 is not mentioned at 0:18. |
| 503 `OLLAMA_SCRIPT_FAILED` leaving the previous draft | Tour returns whatever lines it accepted (fallback sentence if the model is rejected). Provider stays `ollama`. |
| Scene-count warning «ожидалось 4, есть 6» | Removed. `analysis.scenes` is ffmpeg cuts, not speech. |

## Still broken (this is the next job)

Demo at 0:14 after the last generate (`script_version` 1790712512859): 7 segments, 7 A1 clips, preview shows the shop. Remaining holes on A1 were:

| Empty | Why |
|-------|-----|
| 6.40–9.34 (2.9s) after Hook | Next line waited for the 9.34s picture. |
| 47.90–53.17 (5.3s) before CTA | Collection line was 2.7s («Доступны просмотр новой коллекции»). |
| 59.74–62.22 (2.5s) after CTA | Last wav shorter than the last picture. Do **not** stretch the wav. |

Also quality, still true on that take:

- Second line was **15.5s** of «Этот фрагмент шаблона… форма для отправки сообщений» while the frame at 0:14 is brand logos + footer. VLM put a contact form on a catalog window. Planner now drops contact/theme facts on `catalog`/`product` screens. Restart sidecar and Generate again to hear it.
- Fallback lines «Покупатель может рассмотреть 3D…; также доступны текстовое сообщение…» are still caption-like.
- VLM first window claims 3D + Add to Cart; the real opening may be the hero/catalog. Do not special-case Bags / brands / 3D in code. Fix wording in the planner, not by rewriting `scene_understand.py`.
- Trailing 2s on the last card will remain unless the last sentence is longer. Total speech was ~51s of 62s; packing every line to the left only moves the hole to the end.

Code aimed at the holes (needs app restart + Generate + TTS):

- `_place_by_speech` / `applyScriptVoiceover`: 0.4s pause, up to 6s lead before the next picture.
- `_capability_fits_screen`: no message-form on a catalog window.
- Reject openers «Этот фрагмент шаблона», short «Доступны …».
- If a unit is ≥7s of picture and the line is &lt; ~5.5s of speech, one extra Ollama pass for 14–22 words.

## Do not change

- `sidecar/scene_understand.py`, `frame_ocr`, `video_analyze.py` (cache v6)
- XTTS internals, V1 layout, Film chrome, Studio models page
- Hardcoded demo facts (Bags, Nike, Saddle Crossbody, cart, contacts)
- Forced word-count budgets that clip sentences to «позволяя сразу.»

## Pipeline (current)

1. `DirectorBoard.analyzeVoiceover` → `/api/video/analyze` (already cached for the demo).
2. `generateScript` → `/api/script/generate` → `script_llm.generate_voiceover_script` → `_plan_tour` when `visual_quality == vlm`.
3. On success: new `script_version`, **remove A1 clips**, `applyScriptVoiceover` (batch XTTS).
4. Each wav: `start = max(prevEnd + 0.4, anchor - 6)`, duration = probed wav. Segment `start_sec`/`end_sec`/`speech_sec`/`audio_path` updated.
5. Playback: V1 muted when `audioPolicy === 'replace'`. Sound is A1 only.

`docs/narration-trace/demo-проект/00-CODE-PATH.md` is stale (VISION_MODEL_MISSING, one mixed 62s wav, shorten-to-window). Prefer this file.

## How to verify

1. Fully quit the app, reopen the demo film.
2. Narration → Generate. A1 must go empty, then show **the same count** of Hook/Body/CTA clips as script cards.
3. Every script row has `speech_sec` and a wav after apply. No clip longer than its wav.
4. Play 0:14: preview is the recording, not black; speech matches brands/categories, not a contact form.
5. A1 gaps between clips ≤ ~1s except a short hold on the last picture.
6. `python3 -m unittest sidecar.tests.test_narration_vlm -q` (18 tests).

## If you change the planner

Keep tests free of demo special cases. Use the user’s failing sentences as examples only (`Теперь перейдите…`, circular category line, `Шаблон позволяет переход…`, `Этот фрагмент шаблона…`).

Do not fall through to planner `"chapters"` once the tour produced lines. That path is how «Теперь перейдите» was saved.
