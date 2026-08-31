#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/sidecar/vendor/TripoSR"

if [[ ! -d "$VENDOR/tsr" ]]; then
  echo "Cloning TripoSR into sidecar/vendor/TripoSR..."
  mkdir -p "$ROOT/sidecar/vendor"
  git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR.git "$VENDOR"
else
  echo "TripoSR source already present at $VENDOR"
fi

echo "Installing TripoSR Python dependencies..."
python3 -m pip install -r "$ROOT/sidecar/requirements-triposr.txt"

echo "Done. Download TripoSR weights from Studio (stabilityai/TripoSR) or they will load from Hugging Face on first run."
