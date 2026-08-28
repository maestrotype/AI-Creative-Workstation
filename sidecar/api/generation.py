from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import queue as _queue
import threading
import time
import asyncio
import os

# В будущем мы можем заменить это на чистое MLX, но для стабильной генерации
# изображений на Mac (FLUX/SD) индустриальным стандартом является diffusers + MPS (Metal)
try:
    import torch
    from diffusers import AutoPipelineForText2Image
except ImportError:
    torch = None

router = APIRouter()


class GenerationRequest(BaseModel):
    prompt: str
    format: str = "square"
    style: str = "subtle"
    # Use the installed model; frontend will pass the correct id
    model_id: str = "OFA-Sys/small-stable-diffusion-v0"


# Глобальный кэш пайплайна, чтобы не грузить модель каждый раз
pipeline_cache: dict = {}

# MPS не терпит параллельного инференса на одном пайплайне — сериализуем запросы
_generation_lock = asyncio.Lock()

# ─── Выделенный GPU-поток ─────────────────────────────────────────────
# Бэкенд MPS не является thread-safe: контекст Metal, созданный в одном
# потоке (например, при загрузке модели), может крашнуть при использовании
# в другом (наблюдались flaky assertion-краши GPUResizeOps под uvicorn).
# Поэтому ВСЕ блокирующие GPU-операции выполняем в одном постоянном потоке.
_gpu_queue: "_queue.Queue" = _queue.Queue()
_gpu_thread: "threading.Thread | None" = None


def _gpu_worker() -> None:
    while True:
        item = _gpu_queue.get()
        if item is None:  # shutdown sentinel
            break
        fn, args, future, loop = item
        try:
            result = fn(*args)
            loop.call_soon_threadsafe(future.set_result, result)
        except Exception as e:  # noqa: BLE001 — пробрасываем в awaiting-корутину
            loop.call_soon_threadsafe(future.set_exception, e)


def _ensure_gpu_thread() -> None:
    global _gpu_thread
    if _gpu_thread is None or not _gpu_thread.is_alive():
        _gpu_thread = threading.Thread(target=_gpu_worker, name="canvas-gpu", daemon=True)
        _gpu_thread.start()


async def run_on_gpu(fn, *args):
    """Выполняет блокирующий GPU-вызов в выделенном потоке и ждёт результат."""
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    _ensure_gpu_thread()
    _gpu_queue.put((fn, args, future, loop))
    return await future


def _pick_dtype(model_id: str):
    """
    Выбор точности под MPS:
    - SD 1.x (Tiny SD и подобные) — fp32: максимальная стабильность для мелких моделей
    - SDXL / FLUX — bf16: fp16 на MPS нестабилен, bf16 поддерживается нативно
    (VAE в любом случае держим отдельно в fp32 — см. _get_pipeline)
    """
    mid = model_id.lower()
    if "flux" in mid or "sdxl" in mid:
        return torch.bfloat16
    return torch.float32


def _pick_steps(model_id: str) -> int:
    """Turbo/Schnell-модели обучены на 1-4 шагах, для них 20 — лишние."""
    mid = model_id.lower()
    if "turbo" in mid or "schnell" in mid:
        return 4
    return 20


def _get_pipeline(model_id: str):
    """Возвращает пайплайн из кэша или загружает новый. Блокирующий вызов — только из worker-потока."""
    cache_key = model_id.replace("/", "__")
    if cache_key in pipeline_cache:
        print(f"Using cached pipeline for {cache_key}", flush=True)
        return cache_key, pipeline_cache[cache_key]

    model_path = model_id
    # Проверяем, скачана ли модель локально через наш менеджер (Studio)
    local_dir = os.path.expanduser(f"~/Documents/Canvas/Models/{cache_key}")
    if os.path.exists(local_dir):
        model_path = local_dir
        print(f"Using local model at: {model_path}", flush=True)
    else:
        print(f"Local model not found at {local_dir}, using HF id: {model_path}", flush=True)

    dtype = _pick_dtype(model_id)
    print(f"Loading model {model_path} into memory (MPS, dtype={dtype})...", flush=True)
    pipe = AutoPipelineForText2Image.from_pretrained(model_path, torch_dtype=dtype)
    # Для SD (fp32-пайплайн) держим VAE в fp32: в fp16 на MPS возможны
    # переполнения/артефакты. Для FLUX/SDXL (bf16-пайплайн) VAE оставляем в bf16,
    # чтобы dtype латента (из трансформера, bf16) совпадал с dtype VAE —
    # иначе decode падает с "Input type (BFloat16) and bias type (float)".
    if dtype == torch.float32:
        pipe.vae = pipe.vae.to(torch.float32)

    # Отключаем NSFW safety checker: на мелких моделях (Tiny SD) он даёт
    # ложные срабатывания и заменяет картинку ЧЁРНОЙ (это была причина
    # "чёрных изображений"). Генерация локальная — фильтр здесь не нужен.
    if getattr(pipe, "safety_checker", None) is not None:
        pipe.safety_checker = None
        pipe.feature_extractor = None

    pipe = pipe.to("mps")
    pipeline_cache[cache_key] = pipe
    return cache_key, pipe


def _run_inference(pipe, request: GenerationRequest, job_id: str) -> str:
    """Блокирующий инференс + сохранение. Вызывается из worker-потока."""
    width, height = 512, 512  # Default for lightweight test model
    if request.format == "portrait":
        width, height = 512, 768
    elif request.format == "wide":
        width, height = 768, 512

    print(f"[{job_id}] Generating image on MPS GPU...", flush=True)
    generator = torch.Generator(device="cpu").manual_seed(int(time.time()))
    image = pipe(
        prompt=request.prompt,
        output_type="pil",
        num_inference_steps=_pick_steps(request.model_id),
        width=width,
        height=height,
        generator=generator,
    ).images[0]

    output_dir = os.path.expanduser("~/Documents/Canvas/Generated")
    os.makedirs(output_dir, exist_ok=True)

    filepath = os.path.join(output_dir, f"{job_id}.png")
    image.save(filepath)
    print(f"[{job_id}] DONE! Image saved to {filepath}", flush=True)
    return filepath


@router.post("/generate/image")
async def generate_image(request: GenerationRequest):
    job_id = f"job_{int(time.time())}"
    print(f"[{job_id}] Starting generation for: {request.prompt}", flush=True)

    if torch is None:
        # Не имитируем успех — отдаём честную ошибку, чтобы UI показал её пользователю
        raise HTTPException(
            status_code=503,
            detail="PyTorch/diffusers are not installed in the sidecar environment. "
                   "Run: pip install torch diffusers",
        )

    async with _generation_lock:
        try:
            # Блокирующие вызовы (загрузка весов + инференс) выполняем в выделенном
            # GPU-потоке, чтобы не блокировать event loop FastAPI и не создавать
            # кросс-поточные MPS-конфликты.
            _, pipe = await run_on_gpu(_get_pipeline, request.model_id)
            file_path = await run_on_gpu(_run_inference, pipe, request, job_id)
        except HTTPException:
            raise
        except Exception as e:
            print(f"[{job_id}] ERROR during generation: {e}", flush=True)
            raise HTTPException(status_code=500, detail=str(e))

    return {"job_id": job_id, "status": "completed", "file_path": file_path}
