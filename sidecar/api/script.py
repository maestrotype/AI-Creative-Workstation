import os
import sys
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

_SIDEcar_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _SIDEcar_ROOT not in sys.path:
    sys.path.insert(0, _SIDEcar_ROOT)

from script_llm import DEFAULT_OLLAMA_MODEL, generate_voiceover_script

router = APIRouter()


class ScriptSegmentOut(BaseModel):
    start_sec: float
    end_sec: float
    text: str
    role: str = "body"


class ScriptMetaOut(BaseModel):
    tone: str = "draft"
    language: str = "ru"
    words_per_min: int = 130
    provider: str = "fallback"
    model: Optional[str] = None


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
    if not segments:
        raise HTTPException(status_code=500, detail="Script generation produced no segments")

    meta = result.get("meta") if isinstance(result.get("meta"), dict) else {}
    return ScriptGenerateResponse(
        segments=[ScriptSegmentOut(**seg) for seg in segments],
        meta=ScriptMetaOut(
            tone=str(meta.get("tone", "draft")),
            language=str(meta.get("language", request.language)),
            words_per_min=int(meta.get("words_per_min", request.target_wpm)),
            provider=str(meta.get("provider", "fallback")),
            model=meta.get("model"),
        ),
    )
