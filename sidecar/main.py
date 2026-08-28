from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import faulthandler
import platform
import psutil

# Даём Python дамп стека при C++-крашах (Metal assertion, SIGABRT/SIGSEGV)
faulthandler.enable()

# Импортируем наши роутеры
from api import generation

app = FastAPI(title="Canvas Inference Sidecar")

# Allow renderer (localhost:5173) to call the sidecar
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(generation.router, prefix="/api")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "canvas-sidecar"}

@app.get("/hardware")
def get_hardware():
    return {
        "os": platform.system(),
        "arch": platform.machine(),
        "memory_gb": round(psutil.virtual_memory().total / (1024**3), 2),
        "processor": platform.processor(),
    }

if __name__ == "__main__":
    import uvicorn

    # Без reload=True: он спавнит reloader + worker и оставляет сиротские процессы
    # при выходе (порт остаётся занятым). Один процесс закрывается чисто по SIGTERM,
    # который Electron шлёт при завершении приложения.
    uvicorn.run("main:app", host="127.0.0.1", port=57291)
