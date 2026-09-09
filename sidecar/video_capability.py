"""Smallest video-provider capability map used by routing.

Keep in sync with src/renderer/src/features/create/model/videoCapability.ts
"""
from __future__ import annotations

from typing import Any

IMAGE_ANIMATION = "IMAGE_ANIMATION"
IMAGE_TO_VIDEO = "IMAGE_TO_VIDEO"
TEXT_TO_VIDEO = "TEXT_TO_VIDEO"

# Prompt-driven product clip. SVD is not this.
AI_VIDEO_CAPABILITIES = frozenset({IMAGE_TO_VIDEO})
ANIMATION_CAPABILITIES = frozenset({IMAGE_ANIMATION})

PROVIDERS: dict[str, dict[str, Any]] = {
    "stabilityai/stable-video-diffusion-img2vid-xt": {
        "id": "stabilityai/stable-video-diffusion-img2vid-xt",
        "capability": IMAGE_ANIMATION,
        "supports_text_prompt": False,
        "supports_image_conditioning": True,
        "supports_camera_motion": False,
        "supports_object_motion": False,
        "supports_scene_description": False,
        "supports_duration_control": False,
        "supports_negative_prompt": False,
        "typical_fps": 7,
        "typical_frames_mac": 14,
        "typical_frames": 25,
        "prompt_consumed": False,
    },
    "runwayml/gen4.5": {
        "id": "runwayml/gen4.5",
        "capability": IMAGE_TO_VIDEO,
        "supports_text_prompt": True,
        "supports_image_conditioning": True,
        "supports_camera_motion": True,
        "supports_object_motion": True,
        "supports_scene_description": True,
        "supports_duration_control": True,
        "supports_negative_prompt": False,
        "typical_fps": 24,
        "typical_frames_mac": 0,
        "typical_frames": 0,
        "prompt_consumed": True,
    },
    "Anes1032/Wan2.2-TI2V-5B-mlx-q8": {
        "id": "Anes1032/Wan2.2-TI2V-5B-mlx-q8",
        "capability": IMAGE_TO_VIDEO,
        "supports_text_prompt": True,
        "supports_image_conditioning": True,
        "supports_camera_motion": True,
        "supports_object_motion": False,
        "supports_scene_description": True,
        "supports_duration_control": False,
        "supports_negative_prompt": True,
        "typical_fps": 24,
        "typical_frames_mac": 41,
        "typical_frames": 41,
        "prompt_consumed": True,
    },
    "MiniMaxAI/MiniMax-H3": {
        "id": "MiniMaxAI/MiniMax-H3",
        "capability": IMAGE_TO_VIDEO,
        "supports_text_prompt": True,
        "supports_image_conditioning": True,
        "supports_camera_motion": True,
        "supports_object_motion": True,
        "supports_scene_description": True,
        "supports_duration_control": True,
        "supports_negative_prompt": False,
        "typical_fps": 24,
        "typical_frames_mac": 0,
        "typical_frames": 0,
        "prompt_consumed": True,
    },
    "Wan-AI/Wan2.1-T2V-1.3B-Diffusers": {
        "id": "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
        "capability": TEXT_TO_VIDEO,
        "supports_text_prompt": True,
        "supports_image_conditioning": False,
        "supports_camera_motion": False,
        "supports_object_motion": False,
        "supports_scene_description": True,
        "supports_duration_control": True,
        "supports_negative_prompt": True,
        "typical_fps": 16,
        "typical_frames_mac": 33,
        "typical_frames": 49,
        "prompt_consumed": True,
    },
}

_AI_VIDEO_NEEDLES = (
    "commercial", "cinematic", "orbit", "dolly", "camera", "push-in", "push in",
    "rotate", "walk", "fabric", "marketplace", "advert", "product video",
    "реклам", "кинематограф", "камер", "облет", "облёт", "наезд", "ткан",
    "поворот", "идёт", "идет", "ролик", "клип", "commercial shot",
)


def normalize_model_id(model_id: str) -> str:
    raw = (model_id or "").strip()
    lower = raw.lower()
    if "stable-video-diffusion" in lower or "img2vid" in lower:
        return "stabilityai/stable-video-diffusion-img2vid-xt"
    if "runway" in lower:
        return "runwayml/gen4.5"
    if "minimax" in lower or ("h3" in lower and "ti2v" not in lower):
        return "MiniMaxAI/MiniMax-H3"
    if "ti2v" in lower or "anes1032" in lower:
        return "Anes1032/Wan2.2-TI2V-5B-mlx-q8"
    if "wan" in lower:
        return "Wan-AI/Wan2.1-T2V-1.3B-Diffusers"
    return raw


def spec_for(model_id: str) -> dict[str, Any] | None:
    key = normalize_model_id(model_id)
    found = PROVIDERS.get(key)
    if found:
        return found
    for item in PROVIDERS.values():
        if item["id"].lower() == lower_id(model_id):
            return item
    return None


def lower_id(model_id: str) -> str:
    return (model_id or "").strip().lower()


def capability_of(model_id: str) -> str | None:
    spec = spec_for(model_id)
    return None if spec is None else str(spec["capability"])


def prompt_wants_ai_video(prompt: str) -> bool:
    text = (prompt or "").lower()
    return any(needle in text for needle in _AI_VIDEO_NEEDLES)


def resolve_mode(mode: str | None, *, prompt: str, model_id: str) -> str:
    """ai_video | image_animation | t2v"""
    requested = (mode or "").strip().lower()
    if requested in ("ai_video", "image_animation", "t2v"):
        return requested
    cap = capability_of(model_id)
    if cap == TEXT_TO_VIDEO:
        return "t2v"
    if cap == IMAGE_ANIMATION and not prompt_wants_ai_video(prompt):
        return "image_animation"
    return "ai_video"


def required_capability(mode: str) -> str:
    if mode == "image_animation":
        return IMAGE_ANIMATION
    if mode == "t2v":
        return TEXT_TO_VIDEO
    return IMAGE_TO_VIDEO


def mismatch_message(mode: str, model_id: str) -> str:
    cap = capability_of(model_id) or "UNKNOWN"
    if mode == "ai_video":
        return (
            "VIDEO_CAPABILITY_UNSUPPORTED: This request is AI image-to-video "
            "(prompt + product still). "
            f"{model_id or 'The selected model'} is {cap}, not IMAGE_TO_VIDEO. "
            "On this Mac use Wan 2.2 TI2V-5B (Studio → Video) for local AI video, "
            "or Runway / MiniMax H3 if configured. "
            "SVD only animates a still and ignores the motion prompt."
        )
    if mode == "image_animation":
        return (
            "VIDEO_CAPABILITY_UNSUPPORTED: Image animation needs SVD. "
            f"{model_id or 'No model'} is {cap}."
        )
    return (
        "VIDEO_CAPABILITY_UNSUPPORTED: Text-to-video needs Wan. "
        f"{model_id or 'No model'} is {cap}."
    )


def assert_mode_allowed(mode: str, model_id: str) -> dict[str, Any]:
    spec = spec_for(model_id)
    if spec is None:
        raise RuntimeError(
            f"VIDEO_CAPABILITY_UNSUPPORTED: Unknown video model {model_id!r}."
        )
    need = required_capability(mode)
    if spec["capability"] != need:
        raise RuntimeError(mismatch_message(mode, spec["id"]))
    if mode == "ai_video" and not spec["supports_image_conditioning"]:
        raise RuntimeError(mismatch_message(mode, spec["id"]))
    return spec
