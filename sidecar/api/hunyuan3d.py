"""
Hunyuan3D 2 mini (shape only) for the ACW sidecar.
Texture/paint needs CUDA custom rasterizers — not wired on Mac.
"""
from __future__ import annotations

import gc
import os
import sys
from typing import Optional

HUNYUAN_MINI_ID = "tencent/Hunyuan3D-2mini"
HUNYUAN_CACHE_KEY = HUNYUAN_MINI_ID.replace("/", "__")
HUNYUAN_SUBFOLDER = "hunyuan3d-dit-v2-mini-turbo"

_pipe_cache: dict = {}


def _vendor_root() -> str:
    return os.path.join(os.path.dirname(os.path.dirname(__file__)), "vendor", "Hunyuan3D-2")


def _ensure_path() -> None:
    root = _vendor_root()
    if os.path.isdir(root) and root not in sys.path:
        sys.path.insert(0, root)


def hunyuan_import_error() -> Optional[str]:
    _ensure_path()
    try:
        from hy3dgen.shapegen.pipelines import Hunyuan3DDiTFlowMatchingPipeline  # noqa: F401
    except ImportError as exc:
        return (
            "Hunyuan3D-2 code is not installed. Run: ./scripts/setup-hunyuan3d.sh "
            f"({exc})"
        )
    return None


def _model_dir() -> str:
    return os.path.expanduser(f"~/Documents/Canvas/Models/{HUNYUAN_CACHE_KEY}")


def hunyuan_weights_local() -> bool:
    try:
        _resolve_hunyuan_ckpt()
    except FileNotFoundError:
        return False
    return True


def _resolve_hunyuan_ckpt() -> tuple[str, str, bool]:
    """Return (config.yaml, weight file, use_safetensors). Studio stores fp16 .ckpt, not .safetensors."""
    sub = os.path.join(_model_dir(), HUNYUAN_SUBFOLDER)
    config_path = os.path.join(sub, "config.yaml")
    if not os.path.isfile(config_path):
        raise FileNotFoundError(f"Missing {config_path}")
    # Prefer the file Studio actually downloads (ignore_patterns skip *.fp16.safetensors).
    candidates = [
        ("model.fp16.ckpt", False),
        ("model.ckpt", False),
        ("model.fp16.safetensors", True),
        ("model.safetensors", True),
    ]
    for name, use_safetensors in candidates:
        path = os.path.join(sub, name)
        if os.path.isfile(path):
            return config_path, path, use_safetensors
    raise FileNotFoundError(
        f"No Hunyuan checkpoint in {sub} (expected model.fp16.ckpt or model.safetensors)"
    )


def _pick_device(torch):
    if torch.cuda.is_available():
        return "cuda", torch.float16
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return "mps", torch.float32
    return "cpu", torch.float32


def hunyuan_loaded() -> bool:
    return HUNYUAN_CACHE_KEY in _pipe_cache


def unload_hunyuan() -> bool:
    entry = _pipe_cache.pop(HUNYUAN_CACHE_KEY, None)
    if entry is None:
        return False
    try:
        pipe = entry["pipe"]
        pipe.to("cpu")
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
    print("[hunyuan3d] Unloaded from RAM", flush=True)
    return True


def get_hunyuan_pipe(set_progress) -> dict:
    err = hunyuan_import_error()
    if err:
        raise RuntimeError(err)
    if not hunyuan_weights_local():
        raise RuntimeError(
            "Hunyuan3D 2 mini weights are not on disk. Download tencent/Hunyuan3D-2mini in Studio → 3D."
        )

    cached = _pipe_cache.get(HUNYUAN_CACHE_KEY)
    if cached is not None:
        return cached

    _ensure_path()
    import torch
    from hy3dgen.shapegen.pipelines import Hunyuan3DDiTFlowMatchingPipeline

    device, dtype = _pick_device(torch)
    config_path, ckpt_path, use_safetensors = _resolve_hunyuan_ckpt()
    set_progress("load_weights", 12, "hunyuan")
    print(f"[hunyuan3d] Loading {ckpt_path} on {device}...", flush=True)
    # from_pretrained() looks under HY3DGEN_MODELS + model.safetensors. We already
    # have a local fp16 ckpt in Documents/Canvas/Models — load that file directly.
    pipe = Hunyuan3DDiTFlowMatchingPipeline.from_single_file(
        ckpt_path,
        config_path,
        device=device,
        dtype=dtype,
        use_safetensors=use_safetensors,
    )
    try:
        pipe.enable_flashvdm(enabled=True, mc_algo="mc")
    except Exception as exc:  # noqa: BLE001
        print(f"[hunyuan3d] flashvdm skip: {exc}", flush=True)
        try:
            pipe.set_surface_extractor("mc")
        except Exception:  # noqa: BLE001
            pass

    _pipe_cache[HUNYUAN_CACHE_KEY] = {"pipe": pipe, "device": device}
    print(f"[hunyuan3d] Ready on {device}", flush=True)
    return _pipe_cache[HUNYUAN_CACHE_KEY]


def _erode_alpha(image, iterations: int = 3):
    """Shrink rembg leftovers (ring ropes, halo) so they are not reconstructed."""
    import numpy as np
    from PIL import Image
    from scipy.ndimage import binary_erosion

    if image.mode != "RGBA" or iterations <= 0:
        return image
    arr = np.array(image)
    fg = arr[:, :, 3] > 12
    fg = binary_erosion(fg, iterations=iterations)
    if fg.sum() < 400:
        return image
    out = arr.copy()
    out[:, :, 3] = np.where(fg, out[:, :, 3], 0).astype(np.uint8)
    return Image.fromarray(out)


def _drop_tiny_parts(mesh, min_ratio: float = 0.03):
    import numpy as np
    from trimesh.graph import connected_components

    if mesh.faces is None or len(mesh.faces) < 8:
        return mesh
    try:
        components = connected_components(mesh.face_adjacency)
    except Exception:  # noqa: BLE001
        return mesh
    if not components:
        return mesh
    components = sorted(components, key=len, reverse=True)
    main_n = len(components[0])
    keep = []
    for comp in components:
        if len(comp) >= max(40, int(main_n * min_ratio)):
            keep.extend(comp)
    if len(keep) >= len(mesh.faces) * 0.98:
        return mesh
    mask = np.zeros(len(mesh.faces), dtype=bool)
    mask[np.asarray(keep, dtype=np.int64)] = True
    mesh.update_faces(mask)
    mesh.remove_unreferenced_vertices()
    return mesh


def _paint_from_photo(mesh, image):
    """Project the cutout onto the mesh XY bounds (not the full [-1,1] volume)."""
    import numpy as np

    rgba = np.array(image.convert("RGBA"))
    h, w = rgba.shape[:2]
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 18)
    if len(xs) < 20:
        return mesh
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    v = mesh.vertices
    xmin, xmax = float(v[:, 0].min()), float(v[:, 0].max())
    ymin, ymax = float(v[:, 1].min()), float(v[:, 1].max())
    dx, dy = max(xmax - xmin, 1e-6), max(ymax - ymin, 1e-6)
    u = np.clip((v[:, 0] - xmin) / dx, 0.0, 1.0)
    vv = np.clip((v[:, 1] - ymin) / dy, 0.0, 1.0)
    ix = np.clip((x0 + u * (x1 - x0)).astype(int), 0, w - 1)
    iy = np.clip((y1 - vv * (y1 - y0)).astype(int), 0, h - 1)
    sampled = rgba[iy, ix]
    rgb = sampled[:, :3].astype(np.float32)
    a = sampled[:, 3].astype(np.float32) / 255.0
    fg = rgba[ys, xs][:, :3].astype(np.float32)
    fallback = fg.mean(axis=0)
    weak = a < 0.25
    if weak.any():
        rgb[weak] = fallback
    try:
        n = mesh.vertex_normals
        lambert = np.clip(np.abs(n[:, 2]), 0.0, 1.0) * 0.35 + 0.65
        rgb = rgb * lambert[:, None]
    except Exception:  # noqa: BLE001
        pass
    colors = np.clip(rgb, 0, 255).astype(np.uint8)
    mesh.visual.vertex_colors = np.concatenate(
        [colors, np.full((len(colors), 1), 255, dtype=np.uint8)],
        axis=1,
    )
    return mesh


def infer_hunyuan_mesh(image, output_format: str, octree_resolution: int, set_progress, photo_size=None) -> str:
    import uuid

    entry = get_hunyuan_pipe(set_progress)
    pipe = entry["pipe"]
    device = entry["device"]
    job_id = f"mesh_{uuid.uuid4().hex[:12]}"
    out_dir = os.path.expanduser("~/Library/Application Support/canvas/mesh-drafts")
    os.makedirs(out_dir, exist_ok=True)
    ext = "glb" if output_format == "glb" else "obj"
    out_path = os.path.join(out_dir, f"{job_id}.{ext}")

    steps = 8 if octree_resolution <= 160 else 12
    octree = 128 if octree_resolution <= 160 else 192
    cutout = image.convert("RGBA") if getattr(image, "mode", "") != "RGBA" else image
    set_progress("infer", 50, f"{device} steps={steps} octree={octree}")
    print(f"[hunyuan3d] {job_id} infer on {device}", flush=True)
    out = pipe(
        image=cutout,
        num_inference_steps=steps,
        octree_resolution=octree,
        mc_algo="mc",
        output_type="trimesh",
        enable_pbar=False,
    )
    mesh = out[0]
    if isinstance(mesh, (list, tuple)):
        mesh = mesh[0]
    set_progress("export", 92, ext)
    try:
        mesh = _drop_tiny_parts(mesh)
        mesh = _paint_from_photo(mesh, cutout)
        if photo_size:
            from api.threed import _align_to_photo_aspect

            mesh = _align_to_photo_aspect(mesh, photo_size)
    except Exception as exc:  # noqa: BLE001
        print(f"[hunyuan3d] cleanup/paint skip: {exc}", flush=True)
    mesh.export(out_path)
    for name in os.listdir(out_dir):
        if name.startswith("mesh_") and name != os.path.basename(out_path):
            try:
                os.remove(os.path.join(out_dir, name))
            except OSError:
                pass
    set_progress("done", 100, out_path)
    print(f"[hunyuan3d] {job_id} saved {out_path}", flush=True)
    return out_path
