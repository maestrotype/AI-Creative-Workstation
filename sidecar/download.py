import fnmatch
import os
import sys
import threading
from huggingface_hub import HfApi, snapshot_download

# Formats we never use on Apple Silicon (diffusers loads the default safetensors shards).
# SDXL Base 1.0's Hugging Face repo is ~77 GB because it ships the same UNet 4+ times
# (fp32, fp16, ONNX, OpenVINO) plus two ~7 GB single-file checkpoints. Without these
# ignores a "7 GB" model takes hours. Diffusers only needs the default shards + configs.
IGNORE_PATTERNS = [
    "flax_model*",
    "tf_model*",
    "*.onnx",
    "*.onnx_data",
    "*onnx*",
    "*.msgpack",
    "rust_model.ot",
    "openvino*",
    "*openvino*",
    "*.fp16.safetensors",
    "*.fp16.bin",
    # Single-file SDXL checkpoints — unused when loading the diffusers folder layout.
    "sd_xl_*.safetensors",
    "vae_decoder/*",
    "vae_encoder/*",
    "vae_1_0/*",
]
# FLUX repos also ship the transformer weights as one monolithic file that duplicates
# the sharded transformer/ files diffusers actually loads. Skipping it saves ~24 GB.
FLUX_MONOLITHIC_DUPES = ["flux1-dev.safetensors", "flux1-schnell.safetensors"]
ALL_IGNORE_PATTERNS = IGNORE_PATTERNS + FLUX_MONOLITHIC_DUPES


def _friendly_error(exc: Exception) -> str:
    """Map common huggingface_hub exceptions to actionable messages."""
    from huggingface_hub.errors import (
        GatedRepoError,
        LocalEntryNotFoundError,
        RepositoryNotFoundError,
    )

    if isinstance(exc, GatedRepoError):
        return (
            "Gated repository: open it in a browser, accept the license terms with your "
            "Hugging Face account, make sure the token has Read access, then retry."
        )
    if isinstance(exc, RepositoryNotFoundError):
        return "Repository not found. Check the repo ID and your token permissions."
    if isinstance(exc, LocalEntryNotFoundError):
        return "You appear to be offline (file not in local cache). Check your internet connection and retry."
    return str(exc) or exc.__class__.__name__


def _total_repo_size(repo_id: str, ignore_patterns) -> int:
    """Total size (bytes) of the files we actually download; 0 if unknown."""
    try:
        entries = HfApi().list_repo_tree(repo_id, repo_type="model", recursive=True)
        return sum(
            getattr(e, "size", 0) for e in entries
            if not any(fnmatch.fnmatch(e.path, p) for p in ignore_patterns)
        )
    except Exception:
        return 0


def _report_progress(repo_id: str, target_dir: str, stop_event: threading.Event) -> None:
    """Print PROGRESS:<percent>:<downloaded_bytes>:<total_bytes> every 2s until stopped."""
    total = _total_repo_size(repo_id, ALL_IGNORE_PATTERNS)
    print(f"PROGRESS:0:0:{total}", flush=True)
    if not total:
        return
    while not stop_event.is_set():
        downloaded = 0
        for root, _dirs, files in os.walk(target_dir):
            for name in files:
                try:
                    downloaded += os.path.getsize(os.path.join(root, name))
                except OSError:
                    pass
        pct = min(99, int(downloaded * 100 / total))
        print(f"PROGRESS:{pct}:{downloaded}:{total}", flush=True)
        stop_event.wait(2)


def download_model(repo_id: str):
    target_dir = os.path.expanduser(f"~/Documents/Canvas/Models/{repo_id.replace('/', '__')}")
    # Token is passed via environment (HF_TOKEN), not argv, so it does not show up
    # in the process list.
    token = os.environ.get("HF_TOKEN") or None

    print(f"START_DOWNLOAD:{repo_id}", flush=True)
    if token:
        print("Token received (HF_TOKEN env)", flush=True)
    else:
        print("No token received", flush=True)

    stop_event = threading.Event()
    progress_thread = threading.Thread(
        target=_report_progress, args=(repo_id, target_dir, stop_event), daemon=True
    )
    progress_thread.start()

    try:
        snapshot_download(
            repo_id=repo_id,
            local_dir=target_dir,
            token=token,
            # Skip large redundant formats — keep safetensors AND .bin (some models only have .bin).
            # Only skip flax/tf/onnx which we never use on Apple Silicon, plus the
            # monolithic FLUX transformer file (duplicate of the sharded transformer/).
            ignore_patterns=ALL_IGNORE_PATTERNS,
        )
        print(f"DONE:{target_dir}", flush=True)
    except Exception as e:
        print(f"ERROR:{_friendly_error(e)}", flush=True)
        sys.exit(1)
    finally:
        stop_event.set()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: HF_TOKEN=... python download.py <repo_id>")
        sys.exit(1)

    repo_id = sys.argv[1]
    download_model(repo_id)
