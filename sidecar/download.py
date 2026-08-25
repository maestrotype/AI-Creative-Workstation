import sys
import os
from huggingface_hub import snapshot_download

def download_model(repo_id: str):
    # Папка, куда будут сохраняться модели
    # По умолчанию HuggingFace кэширует в ~/.cache/huggingface, 
    # но мы можем указать локальную директорию для Canvas.
    local_dir = os.path.expanduser("~/Documents/Canvas/Models")
    target_dir = os.path.join(local_dir, repo_id.split("/")[-1])
    
    os.makedirs(target_dir, exist_ok=True)
    
    print(f"START_DOWNLOAD:{repo_id}")
    try:
        # Скачиваем только необходимые веса (обычно safetensors и json конфиги)
        # Игнорируем .bin и .msgpack если есть safetensors, чтобы не качать мусор
        snapshot_download(
            repo_id=repo_id,
            local_dir=target_dir,
            local_dir_use_symlinks=False, # Копируем реально, чтобы не зависеть от кэша
            ignore_patterns=["*.bin", "*.msgpack", "*.ckpt", "*.pt"]
        )
        print(f"DONE:{target_dir}")
    except Exception as e:
        print(f"ERROR:{str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python download.py <repo_id>")
        sys.exit(1)
        
    repo_id = sys.argv[1]
    download_model(repo_id)
