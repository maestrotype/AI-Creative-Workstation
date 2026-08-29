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
    "engine": "",
    "weights_cached": False,
    "started_at": 0.0,
}


def _set_progress(stage: str, percent: int, detail: str = "") -> None:
    _progress["stage"] = stage
    _progress["percent"] = max(0, min(100, percent))
    _progress["detail"] = detail
    from api import hunyuan3d as hunyuan3d_api

    _progress["weights_cached"] = (
        TRIPOSR_CACHE_KEY in _model_cache or hunyuan3d_api.hunyuan_loaded()
    )
    print(f"[3d] stage={stage} {percent}% {detail}", flush=True)


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
        model.renderer.set_chunk_size(8192)
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


def _open_photo(image_path: str):
    from PIL import Image, ImageOps

    # Browsers honor EXIF; PIL does not. Without this, portrait iPhone shots
    # reconstruct as a mesh lying on its side.
    return ImageOps.exif_transpose(Image.open(image_path))


def _solid_silhouette(image):
    """Fill interior holes rembg punches in checkered/mesh fabric."""
    import numpy as np
    from PIL import Image
    from scipy.ndimage import binary_closing, binary_fill_holes

    arr = np.array(image)
    if arr.ndim != 3 or arr.shape[-1] != 4:
        return image
    fg = arr[:, :, 3] > 12
    fg = binary_closing(fg, iterations=2)
    fg = binary_fill_holes(fg)
    out = arr.copy()
    out[:, :, 3] = np.where(fg, np.maximum(out[:, :, 3], 255), 0).astype(np.uint8)
    return Image.fromarray(out)


def _align_to_photo_aspect(mesh, photo_size: tuple[int, int]):
    """Rotate 90° only when AABB disagrees with the *original* photo (wide vs tall).

    Preprocess pads to a square, so image.size after rembg is useless here.
    Putting the longest axis on +Y made landscape bags stand on end.
    """
    import numpy as np
    import trimesh

    w, h = photo_size
    x, y, z = np.asarray(mesh.extents, dtype=np.float64).tolist()
    horiz = max(x, z)
    photo_wide = w > h * 1.12
    photo_tall = h > w * 1.12
    mesh_tall = y > horiz * 1.12
    mesh_wide = horiz > y * 1.12
    if photo_wide and mesh_tall:
        mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0.0, 0.0, 1.0]))
    elif photo_tall and mesh_wide:
        if x >= z:
            mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0.0, 0.0, 1.0]))
        else:
            mesh.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1.0, 0.0, 0.0]))
    return mesh


def _repair_mesh(mesh):
    import trimesh

    try:
        mesh.merge_vertices()
        mesh.update_faces(mesh.unique_faces())
        mesh.remove_unreferenced_vertices()
        mesh.fill_holes()
        trimesh.repair.fix_normals(mesh)
    except Exception:  # noqa: BLE001
        pass
    return mesh


def _preprocess_cpu(image_path: str, remove_bg: bool, foreground_ratio: float = 0.85):
    """Background cut runs on a normal thread — rembg/onnx must not touch the Metal worker."""
    from PIL import Image
    import numpy as np
    from tsr.utils import resize_foreground

    _ensure_triposr_path()
    photo = _open_photo(image_path)
    photo_size = photo.size
    if remove_bg:
        _set_progress("preprocess", 30, "rembg")
        hb = _Heartbeat("preprocess", 30)
        hb.start()
        try:
            rembg = _import_rembg()
            session = rembg.new_session()
            image = rembg.remove(photo.convert("RGB"), session=session)
            image = _solid_silhouette(image)
            image = resize_foreground(image, foreground_ratio)
        finally:
            hb.stop()
    else:
        _set_progress("preprocess", 30, "keep")
        image = photo.convert("RGBA")

    if image.mode != "RGBA":
        image = image.convert("RGBA")
    return image, photo_size


def _rgb_for_triposr(image):
    """TripoSR wants RGB composited on gray; Hunyuan needs the alpha mask kept."""
    from PIL import Image
    import numpy as np

    arr = np.array(image).astype(np.float32) / 255.0
    if arr.shape[-1] == 4:
        rgb = arr[:, :, :3] * arr[:, :, 3:4] + (1 - arr[:, :, 3:4]) * 0.5
        return Image.fromarray((rgb * 255.0).astype(np.uint8))
    return Image.fromarray((arr * 255.0).astype(np.uint8))


def _infer_mesh(image, output_format: str, mc_resolution: int, photo_size: tuple[int, int]) -> str:
    _unload_image_pipelines()
    entry = _get_triposr_model()
    model = entry["model"]
    device = entry["device"]
    torch = entry["torch"]
    model.renderer.set_chunk_size(8192)

    job_id = f"mesh_{uuid.uuid4().hex[:12]}"
    # Drafts only — the UI copies out via Save as. Not Documents/Canvas/Generated.
    out_dir = os.path.expanduser("~/Library/Application Support/canvas/mesh-drafts")
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
            meshes = model.extract_mesh(
                scene_codes, True, resolution=mc_resolution, threshold=15.0
            )
    finally:
        hb.stop()

    _set_progress("export", 92, ext)
    from tsr.utils import to_gradio_3d_orientation

    mesh = to_gradio_3d_orientation(meshes[0])
    mesh = _align_to_photo_aspect(mesh, photo_size)
    mesh = _repair_mesh(mesh)
    mesh.export(out_path)
    for name in os.listdir(out_dir):
        if name.startswith("mesh_") and name != os.path.basename(out_path):
            try:
                os.remove(os.path.join(out_dir, name))
            except OSError:
                pass
    _set_progress("done", 100, out_path)
    print(f"[triposr] {job_id} saved {out_path}", flush=True)
    return out_path


class MeshRequest(BaseModel):
    image_path: str
    model_id: str
    output_format: str = "glb"
    mc_resolution: int = 256
    remove_background: bool = True


@router.get("/3d/status")
async def triposr_status():
    from api import hunyuan3d as hunyuan3d_api

    err = _triposr_import_error()
    hy_err = hunyuan3d_api.hunyuan_import_error()
    weights = _resolve_weights_path()
    local_ready = os.path.isfile(os.path.join(_model_dir(), "model.ckpt"))
    return {
        "ready": err is None or hy_err is None,
        "detail": err,
        "model_id": TRIPOSR_MODEL_ID,
        "weights": weights,
        "weights_local": local_ready,
        "loaded": TRIPOSR_CACHE_KEY in _model_cache,
        "vendor_path": _vendor_root(),
        "hunyuan_id": hunyuan3d_api.HUNYUAN_MINI_ID,
        "hunyuan_ready": hy_err is None,
        "hunyuan_detail": hy_err,
        "hunyuan_weights_local": hunyuan3d_api.hunyuan_weights_local(),
        "hunyuan_loaded": hunyuan3d_api.hunyuan_loaded(),
    }


@router.get("/3d/progress")
async def triposr_progress():
    from api import hunyuan3d as hunyuan3d_api

    return {
        "stage": _progress["stage"],
        "percent": _progress["percent"],
        "detail": _progress["detail"],
        "device": _progress["device"],
        "engine": _progress.get("engine") or "",
        "weights_cached": TRIPOSR_CACHE_KEY in _model_cache or hunyuan3d_api.hunyuan_loaded(),
        "elapsed_sec": int(time.time() - _progress["started_at"]) if _progress.get("started_at") else 0,
    }


@router.post("/3d/mesh")
async def generate_mesh(request: MeshRequest):
    from api import hunyuan3d as hunyuan3d_api

    supported = {TRIPOSR_MODEL_ID, hunyuan3d_api.HUNYUAN_MINI_ID}
    if request.model_id not in supported:
        raise HTTPException(
            status_code=400,
            detail=f"Supported 3D engines: {', '.join(sorted(supported))}",
        )

    use_hunyuan = request.model_id == hunyuan3d_api.HUNYUAN_MINI_ID
    print(f"[3d] generate-mesh model_id={request.model_id} hunyuan={use_hunyuan}", flush=True)
    _progress["engine"] = "hunyuan" if use_hunyuan else "triposr"
    if use_hunyuan:
        err = hunyuan3d_api.hunyuan_import_error()
        if err:
            raise HTTPException(status_code=503, detail=err)
        if not hunyuan3d_api.hunyuan_weights_local():
            raise HTTPException(
                status_code=503,
                detail="Download Hunyuan3D 2 mini in Studio → 3D (tencent/Hunyuan3D-2mini).",
            )
    else:
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
            image, photo_size = await asyncio.to_thread(
                _preprocess_cpu, request.image_path, request.remove_background
            )
            if use_hunyuan:
                file_path = await run_on_gpu(
                    hunyuan3d_api.infer_hunyuan_mesh,
                    image,
                    request.output_format,
                    mc_resolution,
                    _set_progress,
                    photo_size,
                )
            else:
                file_path = await run_on_gpu(
                    _infer_mesh,
                    _rgb_for_triposr(image),
                    request.output_format,
                    mc_resolution,
                    photo_size,
                )
        except FileNotFoundError as exc:
            _set_progress("error", 0, str(exc)[:200])
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except RuntimeError as exc:
            msg = _exc_message(exc)
            _set_progress("error", 0, msg[:200])
            if "out of memory" in msg.lower() or "mps" in msg.lower():
                await run_on_gpu(_unload_triposr)
                await run_on_gpu(hunyuan3d_api.unload_hunyuan)
                raise HTTPException(
                    status_code=507,
                    detail="3D engine ran out of memory. Unload image models in Studio and retry.",
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
    from api import hunyuan3d as hunyuan3d_api

    async with _generation_lock:
        unloaded_t = await run_on_gpu(_unload_triposr)
        unloaded_h = await run_on_gpu(hunyuan3d_api.unload_hunyuan)
    return {
        "unloaded": unloaded_t or unloaded_h,
        "loaded": TRIPOSR_CACHE_KEY in _model_cache or hunyuan3d_api.hunyuan_loaded(),
    }
