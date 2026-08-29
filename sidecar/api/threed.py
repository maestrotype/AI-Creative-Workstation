"""
TripoSR image-to-mesh inference for the ACW sidecar.
"""
from __future__ import annotations

import asyncio
import gc
import os
import sys
import threading
import time
import traceback
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

TRIPOSR_MODEL_ID = "stabilityai/TripoSR"
TRIPOSR_CACHE_KEY = TRIPOSR_MODEL_ID.replace("/", "__")

_model_cache: dict = {}
_progress: dict = {
    "stage": "idle",
    "percent": 0,
    "detail": "",
    "device": "",
    "weights_cached": False,
    "started_at": 0.0,
}


def _set_progress(stage: str, percent: int, detail: str = "") -> None:
    _progress["stage"] = stage
    _progress["percent"] = max(0, min(100, percent))
    _progress["detail"] = detail
    _progress["weights_cached"] = TRIPOSR_CACHE_KEY in _model_cache
    print(f"[triposr] stage={stage} {percent}% {detail}", flush=True)


class _Heartbeat:
    def __init__(self, stage: str, percent: int) -> None:
        self.stage = stage
        self.percent = percent
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        t0 = time.time()

        def loop() -> None:
            while not self._stop.wait(1.5):
                elapsed = int(time.time() - t0)
                _progress["detail"] = f"{elapsed}s"
                print(f"[triposr] still on {self.stage} ({elapsed}s)", flush=True)

        self._thread = threading.Thread(target=loop, name="triposr-hb", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

# Reuse the dedicated GPU worker from image generation (one Metal context).
from api.generation import _generation_lock, run_on_gpu  # noqa: E402


def _vendor_root() -> str:
    return os.path.join(os.path.dirname(os.path.dirname(__file__)), "vendor", "TripoSR")


def _ensure_triposr_path() -> None:
    root = _vendor_root()
    if os.path.isdir(root) and root not in sys.path:
        sys.path.insert(0, root)


def _triposr_import_error() -> Optional[str]:
    _ensure_triposr_path()
    try:
        import tsr  # noqa: F401
    except ImportError as exc:
        return (
            "TripoSR code is not installed. Run: "
            "git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR.git sidecar/vendor/TripoSR "
            f"then pip install the TripoSR deps from sidecar/requirements-triposr.txt ({exc})"
        )
    return None


def _model_dir() -> str:
    return os.path.expanduser(f"~/Documents/Canvas/Models/{TRIPOSR_CACHE_KEY}")


def _resolve_weights_path() -> str:
    local = _model_dir()
    if os.path.isfile(os.path.join(local, "model.ckpt")):
        return local
    return TRIPOSR_MODEL_ID


def _remap_legacy_vit_state_dict(state_dict: dict) -> dict:
    """Map DINO ViT tensors from transformers 4.x names onto 5.x.

    TripoSR's checkpoint stores facebook/dino-vitb16 as
    ``encoder.layer.N.attention.attention.query``. Current transformers (5.x)
    uses ``layers.N.attention.q_proj``. FLUX needs the new library, so we
    rewrite keys instead of pinning transformers==4.35.
    """
    if any(".attention.q_proj." in key for key in state_dict):
        return state_dict

    replacements = (
        (".encoder.layer.", ".layers."),
        (".attention.attention.query.", ".attention.q_proj."),
        (".attention.attention.key.", ".attention.k_proj."),
        (".attention.attention.value.", ".attention.v_proj."),
        (".attention.output.dense.", ".attention.o_proj."),
        (".intermediate.dense.", ".mlp.fc1."),
        (".output.dense.", ".mlp.fc2."),
    )
    remapped = {}
    for key, value in state_dict.items():
        new_key = key
        for old, new in replacements:
            new_key = new_key.replace(old, new)
        remapped[new_key] = value
    return remapped


def _tsr_from_pretrained(weights: str, config_name: str, weight_name: str):
    import torch
    from huggingface_hub import hf_hub_download
    from omegaconf import OmegaConf
    from tsr.system import TSR

    if os.path.isdir(weights):
        config_path = os.path.join(weights, config_name)
        weight_path = os.path.join(weights, weight_name)
    else:
        config_path = hf_hub_download(repo_id=weights, filename=config_name)
        weight_path = hf_hub_download(repo_id=weights, filename=weight_name)

    cfg = OmegaConf.load(config_path)
    OmegaConf.resolve(cfg)
    model = TSR(cfg)
    ckpt = torch.load(weight_path, map_location="cpu", weights_only=False)
    ckpt = _remap_legacy_vit_state_dict(ckpt)
    model.load_state_dict(ckpt)
    return model


def _pick_device(torch) -> str:
    # Official TripoSR is CUDA or CPU. MPS + rembg/onnx on the Metal worker deadlocks
    # (UI stuck at 5% "queued") when an image model already occupies the GPU thread.
    if torch.cuda.is_available():
        return "cuda:0"
    return "cpu"


def _unload_image_pipelines() -> None:
    from api.generation import _unload_model, pipeline_cache

    keys = list(pipeline_cache.keys())
    if not keys:
        return
    _set_progress("free_vram", 6, ",".join(keys)[:80])
    for key in keys:
        _unload_model(key)


def _get_triposr_model(force: bool = False):
    """Load or return cached TripoSR weights. GPU worker thread only. No rembg here."""
    err = _triposr_import_error()
    if err:
        raise RuntimeError(err)

    _set_progress("import", 8, "tsr")
    import numpy as np
    import torch
    from PIL import Image
    from tsr.utils import resize_foreground

    if force and TRIPOSR_CACHE_KEY in _model_cache:
        _unload_triposr()

    cached = _model_cache.get(TRIPOSR_CACHE_KEY)
    if cached is not None:
        _progress["device"] = cached.get("device", "")
        _progress["weights_cached"] = True
        return cached

    device = _pick_device(torch)
    weights = _resolve_weights_path()
    _progress["device"] = device
    _set_progress("load_weights", 12, weights)
    print(f"[triposr] Loading {weights} on {device}...", flush=True)
    hb = _Heartbeat("load_weights", 12)
    hb.start()
    try:
        model = _tsr_from_pretrained(weights, "config.yaml", "model.ckpt")
        model.renderer.set_chunk_size(4096)
        _set_progress("load_weights", 24, device)
        model.to(device)
    finally:
        hb.stop()

    _model_cache[TRIPOSR_CACHE_KEY] = {
        "model": model,
        "device": device,
        "Image": Image,
        "np": np,
        "resize_foreground": resize_foreground,
        "torch": torch,
    }
    print(f"[triposr] Ready on {device}", flush=True)
    return _model_cache[TRIPOSR_CACHE_KEY]


def _unload_triposr() -> bool:
    entry = _model_cache.pop(TRIPOSR_CACHE_KEY, None)
    if entry is None:
        return False
    try:
        entry["model"].to("cpu")
    except Exception:  # noqa: BLE001
        pass
    del entry
    gc.collect()
    try:
        import torch

        if torch.backends.mps.is_available():
            torch.mps.empty_cache()
    except Exception:  # noqa: BLE001
        pass
    print("[triposr] Unloaded from RAM", flush=True)
    return True


def _import_rembg():
    """rembg sys.exits if onnxruntime is missing; numba needs a writable cache dir."""
    cache = os.path.expanduser("~/Library/Caches/canvas-numba")
    os.makedirs(cache, exist_ok=True)
    os.environ.setdefault("NUMBA_CACHE_DIR", cache)
    try:
        import onnxruntime  # noqa: F401
    except ImportError as exc:
        raise RuntimeError(
            'Background removal needs onnxruntime. Run: python3 -m pip install "rembg[cpu]"'
        ) from exc
    try:
        import rembg
    except SystemExit as exc:
        raise RuntimeError(
            'rembg exited on import (onnxruntime backend missing). Run: python3 -m pip install "rembg[cpu]"'
        ) from exc
    return rembg


def _exc_message(exc: BaseException) -> str:
    text = str(exc).strip()
    if not text:
        text = type(exc).__name__
    return text[:400]


def _preprocess_cpu(image_path: str, remove_bg: bool, foreground_ratio: float = 0.85):
    """Background cut runs on a normal thread — rembg/onnx must not touch the Metal worker."""
    from PIL import Image
    import numpy as np
    from tsr.utils import resize_foreground

    _ensure_triposr_path()
    if remove_bg:
        _set_progress("preprocess", 30, "rembg")
        hb = _Heartbeat("preprocess", 30)
        hb.start()
        try:
            rembg = _import_rembg()
            session = rembg.new_session()
            image = rembg.remove(Image.open(image_path).convert("RGB"), session=session)
            image = resize_foreground(image, foreground_ratio)
        finally:
            hb.stop()
    else:
        _set_progress("preprocess", 30, "keep")
        image = Image.open(image_path).convert("RGBA")

    arr = np.array(image).astype(np.float32) / 255.0
    if arr.shape[-1] == 4:
        rgb = arr[:, :, :3] * arr[:, :, 3:4] + (1 - arr[:, :, 3:4]) * 0.5
        image = Image.fromarray((rgb * 255.0).astype(np.uint8))
    else:
        image = Image.fromarray((arr * 255.0).astype(np.uint8))
    return image


def _infer_mesh(image, output_format: str, mc_resolution: int) -> str:
    _unload_image_pipelines()
    entry = _get_triposr_model()
    model = entry["model"]
    device = entry["device"]
    torch = entry["torch"]

    job_id = f"mesh_{uuid.uuid4().hex[:12]}"
    out_dir = os.path.expanduser("~/Documents/Canvas/Generated/3D")
    os.makedirs(out_dir, exist_ok=True)
    ext = "glb" if output_format == "glb" else "obj"
    out_path = os.path.join(out_dir, f"{job_id}.{ext}")

    _set_progress("infer", 50, device)
    print(f"[triposr] {job_id} infer on {device}", flush=True)
    hb = _Heartbeat("infer", 50)
    hb.start()
    try:
        with torch.no_grad():
            scene_codes = model([image], device=device)
            _set_progress("extract", 72, str(mc_resolution))
            hb.stop()
            hb = _Heartbeat("extract", 72)
            hb.start()
            meshes = model.extract_mesh(scene_codes, True, resolution=mc_resolution)
    finally:
        hb.stop()

    _set_progress("export", 92, ext)
    meshes[0].export(out_path)
    _set_progress("done", 100, out_path)
    print(f"[triposr] {job_id} saved {out_path}", flush=True)
    return out_path


class MeshRequest(BaseModel):
    image_path: str
    model_id: str = TRIPOSR_MODEL_ID
    output_format: str = "glb"
    mc_resolution: int = 128
    remove_background: bool = True


@router.get("/3d/status")
async def triposr_status():
    err = _triposr_import_error()
    weights = _resolve_weights_path()
    local_ready = os.path.isfile(os.path.join(_model_dir(), "model.ckpt"))
    return {
        "ready": err is None,
        "detail": err,
        "model_id": TRIPOSR_MODEL_ID,
        "weights": weights,
        "weights_local": local_ready,
        "loaded": TRIPOSR_CACHE_KEY in _model_cache,
        "vendor_path": _vendor_root(),
    }


@router.get("/3d/progress")
async def triposr_progress():
    return {
        "stage": _progress["stage"],
        "percent": _progress["percent"],
        "detail": _progress["detail"],
        "device": _progress["device"],
        "weights_cached": TRIPOSR_CACHE_KEY in _model_cache,
        "elapsed_sec": int(time.time() - _progress["started_at"]) if _progress.get("started_at") else 0,
    }


@router.post("/3d/mesh")
async def generate_mesh(request: MeshRequest):
    if request.model_id != TRIPOSR_MODEL_ID:
        raise HTTPException(status_code=400, detail=f"Only {TRIPOSR_MODEL_ID} is supported for now")

    err = _triposr_import_error()
    if err:
        raise HTTPException(status_code=503, detail=err)

    if request.output_format not in ("glb", "obj"):
        raise HTTPException(status_code=400, detail="output_format must be glb or obj")

    mc_resolution = max(64, min(256, request.mc_resolution))

    _progress["started_at"] = time.time()
    _set_progress("queued", 3)
    async with _generation_lock:
        try:
            if not os.path.isfile(request.image_path):
                raise FileNotFoundError(f"Image not found: {request.image_path}")
            await run_on_gpu(_unload_image_pipelines)
            image = await asyncio.to_thread(
                _preprocess_cpu, request.image_path, request.remove_background
            )
            file_path = await run_on_gpu(
                _infer_mesh,
                image,
                request.output_format,
                mc_resolution,
            )
        except FileNotFoundError as exc:
            _set_progress("error", 0, str(exc)[:200])
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except RuntimeError as exc:
            msg = _exc_message(exc)
            _set_progress("error", 0, msg[:200])
            if "out of memory" in msg.lower() or "mps" in msg.lower():
                await run_on_gpu(_unload_triposr)
                raise HTTPException(
                    status_code=507,
                    detail="TripoSR ran out of GPU memory. Unload image models in Studio and retry with mc_resolution=128.",
                ) from exc
            raise HTTPException(status_code=500, detail=msg) from exc
        except SystemExit as exc:
            msg = (
                'Background removal aborted (onnxruntime missing). '
                'Run: python3 -m pip install "rembg[cpu]"'
            )
            traceback.print_exc()
            _set_progress("error", 0, msg[:200])
            raise HTTPException(status_code=500, detail=msg) from exc
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            msg = _exc_message(exc)
            _set_progress("error", 0, msg[:200])
            raise HTTPException(status_code=500, detail=msg) from exc

    return {
        "job_id": os.path.splitext(os.path.basename(file_path))[0],
        "file_path": file_path,
        "model_id": request.model_id,
        "format": request.output_format,
    }


@router.post("/3d/unload")
async def unload_triposr():
    async with _generation_lock:
        unloaded = await run_on_gpu(_unload_triposr)
    return {"unloaded": unloaded, "loaded": TRIPOSR_CACHE_KEY in _model_cache}
