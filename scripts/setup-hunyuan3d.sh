#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/sidecar/vendor/Hunyuan3D-2"

if [[ ! -d "$VENDOR/hy3dgen" ]]; then
  echo "Cloning Hunyuan3D-2 into sidecar/vendor/Hunyuan3D-2..."
  mkdir -p "$ROOT/sidecar/vendor"
  git clone --depth 1 https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git "$VENDOR"
else
  echo "Hunyuan3D-2 source already present at $VENDOR"
fi

# pymeshlab often fails on Mac/Python 3.14; shape pipeline does not need it.
python3 - "$VENDOR" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1]) / "hy3dgen" / "shapegen" / "__init__.py"
text = p.read_text()
old = """from .pipelines import Hunyuan3DDiTPipeline, Hunyuan3DDiTFlowMatchingPipeline
from .postprocessors import FaceReducer, FloaterRemover, DegenerateFaceRemover, MeshSimplifier
from .preprocessors import ImageProcessorV2, IMAGE_PROCESSORS, DEFAULT_IMAGEPROCESSOR
"""
new = """from .pipelines import Hunyuan3DDiTPipeline, Hunyuan3DDiTFlowMatchingPipeline
from .preprocessors import ImageProcessorV2, IMAGE_PROCESSORS, DEFAULT_IMAGEPROCESSOR

try:
    from .postprocessors import FaceReducer, FloaterRemover, DegenerateFaceRemover, MeshSimplifier
except ImportError:
    FaceReducer = FloaterRemover = DegenerateFaceRemover = MeshSimplifier = None  # type: ignore
"""
if old in text:
    p.write_text(text.replace(old, new))
    print("Patched shapegen/__init__.py (optional pymeshlab)")
else:
    print("shapegen/__init__.py already patched or upstream changed")
PY

echo "Done. In Studio → 3D download Hunyuan3D 2 mini, then restart the app."
