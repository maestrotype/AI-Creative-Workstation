import os
import sys
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

_SIDEcar_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _SIDEcar_ROOT not in sys.path:
    sys.path.insert(0, _SIDEcar_ROOT)

from script_llm import DEFAULT_OLLAMA_MODEL, generate_voiceover_script, shorten_spoken, translate_narration

router = APIRouter()


class ScriptSegmentOut(BaseModel):
    start_sec: float
    end_sec: float
    text: str
    role: str = "body"
    purpose: str = ""
    visual_summary: str = ""
    estimated_sec: float = 0.0
    anchor_sec: Optional[float] = None


class ScriptMetaOut(BaseModel):
    tone: str = "draft"
    language: str = "ru"
    words_per_min: int = 130
    provider: str = "fallback"
    model: Optional[str] = None
    planner: Optional[str] = None
    scene_count: Optional[int] = None
    visual_quality: Optional[str] = None
    vision_model: Optional[str] = None
    note: Optional[str] = None


class ScriptGenerateRequest(BaseModel):
    video_context: dict[str, Any]
    prompt: str = ""
    project_context: str = ""
    language: str = "ru"
    target_wpm: int = Field(default=130, ge=80, le=200)
    prefer_ollama: bool = True
    ollama_model: str = DEFAULT_OLLAMA_MODEL


class ScriptGenerateResponse(BaseModel):
    segments: list[ScriptSegmentOut]
    meta: ScriptMetaOut


@router.post("/script/generate", response_model=ScriptGenerateResponse)
def generate_script_route(request: ScriptGenerateRequest):
    ctx = request.video_context or {}
    duration = float(ctx.get("duration_sec") or 0)
    if duration <= 0:
        raise HTTPException(status_code=400, detail="video_context.duration_sec must be positive")

    from api.generation import (
        cancel_idle_release,
        clear_runtime_job,
        release_heavy_for_other_work,
        run_on_gpu_blocking,
        set_runtime_job,
    )
    import time as _time

    cancel_idle_release()
    set_runtime_job(
        active=True,
        kind="script",
        stage="llm",
        percent=8,
        detail="releasing other models",
        model_id=request.ollama_model,
        started_at=_time.time(),
        error=None,
        cancel=False,
    )
    try:
        run_on_gpu_blocking(release_heavy_for_other_work)
    except Exception as exc:  # noqa: BLE001
        print(f"[script] heavy-model release skipped: {exc}", flush=True)

    set_runtime_job(active=True, kind="script", stage="llm", percent=20, detail="ollama")
    try:
        if request.prefer_ollama:
            from script_llm import _list_ollama_models

            if not _list_ollama_models():
                raise HTTPException(status_code=503, detail="OLLAMA_SCRIPT_FAILED")
        result = generate_voiceover_script(
            ctx,
            request.prompt,
            language=request.language,
            target_wpm=request.target_wpm,
            prefer_ollama=request.prefer_ollama,
            ollama_model=request.ollama_model,
            project_context=request.project_context,
        )
        segments = result.get("segments") or []
        meta = result.get("meta") if isinstance(result.get("meta"), dict) else {}
        provider = str(meta.get("provider", "fallback"))
        if request.prefer_ollama and provider != "ollama":
            raise HTTPException(
                status_code=503,
                detail="OLLAMA_SCRIPT_FAILED",
            )
        return ScriptGenerateResponse(
            segments=[ScriptSegmentOut(**seg) for seg in segments],
            meta=ScriptMetaOut(
                tone=str(meta.get("tone", "draft")),
                language=str(meta.get("language", request.language)),
                words_per_min=int(meta.get("words_per_min", request.target_wpm)),
                provider=provider,
                model=meta.get("model"),
                planner=meta.get("planner"),
                scene_count=meta.get("scene_count"),
            ),
        )
    finally:
        clear_runtime_job()


class ScriptShortenRequest(BaseModel):
    text: str
    target_sec: float = Field(ge=0.8, le=60)
    language: str = "ru"
    target_wpm: int = Field(default=130, ge=80, le=200)
    visual_summary: str = ""
    purpose: str = ""


@router.post("/script/shorten")
def shorten_script_route(request: ScriptShortenRequest):
    text = shorten_spoken(
        request.text,
        language=request.language,
        target_sec=request.target_sec,
        wpm=request.target_wpm,
        visual_summary=request.visual_summary,
        purpose=request.purpose,
    )
    if not text.strip():
        raise HTTPException(status_code=500, detail="Shorten produced empty text")
    return {"text": text}


class ScriptTranslateRequest(BaseModel):
    lines: list[str]
    source: str = "ru"
    target: str = "en"
    ollama_model: str = DEFAULT_OLLAMA_MODEL


class FitBeatIn(BaseModel):
    start: float
    end: float
    target_words: int = Field(default=12, ge=4, le=80)
    brief: str = ""
    seen: str = ""


class FitChapterIn(BaseModel):
    title: str = ""
    script: str = ""
    beats: list[FitBeatIn]


class FitChaptersRequest(BaseModel):
    chapters: list[FitChapterIn]
    language: str = "ru"
    ollama_model: str = DEFAULT_OLLAMA_MODEL


@router.post("/script/fit-chapters", response_model=ScriptGenerateResponse)
def fit_chapters_route(request: FitChaptersRequest):
    if not request.chapters:
        raise HTTPException(status_code=400, detail="chapters are required")
    from api.generation import (
        cancel_idle_release,
        clear_runtime_job,
        release_heavy_for_other_work,
        run_on_gpu_blocking,
        set_runtime_job,
    )
    import time as _time

    from chapter_fit import fit_chapters
    from script_llm import _list_ollama_models

    cancel_idle_release()
    set_runtime_job(
        active=True,
        kind="script",
        stage="llm",
        percent=20,
        detail="fitting chapter length",
        model_id=request.ollama_model,
        started_at=_time.time(),
        error=None,
        cancel=False,
    )
    try:
        run_on_gpu_blocking(release_heavy_for_other_work)
    except Exception as exc:  # noqa: BLE001
        print(f"[script] heavy-model release skipped: {exc}", flush=True)
    try:
        if not _list_ollama_models():
            raise HTTPException(status_code=503, detail="OLLAMA_SCRIPT_FAILED")
        segments = fit_chapters(
            [chapter.model_dump() for chapter in request.chapters],
            request.ollama_model,
        )
        if not segments:
            raise HTTPException(status_code=502, detail="CHAPTER_FIT_EMPTY")
        short = any(bool(seg.pop("short", False)) for seg in segments)
        return ScriptGenerateResponse(
            segments=[ScriptSegmentOut(**seg) for seg in segments],
            meta=ScriptMetaOut(
                tone="directed",
                language=request.language,
                words_per_min=130,
                provider="ollama",
                model=request.ollama_model,
                planner="chapter-length",
                scene_count=len(request.chapters),
                note="SHORT" if short else None,
            ),
        )
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        clear_runtime_job()


@router.post("/script/translate")
def translate_script_route(request: ScriptTranslateRequest):
    if not request.lines:
        return {"lines": []}
    from script_llm import _list_ollama_models

    if not _list_ollama_models():
        raise HTTPException(status_code=503, detail="OLLAMA_SCRIPT_FAILED")
    try:
        lines = translate_narration(
            request.lines,
            request.ollama_model,
            source=request.source,
            target=request.target,
        )
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"lines": lines}
