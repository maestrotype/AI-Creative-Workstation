from fastapi import FastAPI
import platform
import psutil

# Импортируем наши роутеры
from api import generation

app = FastAPI(title="Canvas Inference Sidecar")

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
    uvicorn.run("main:app", host="127.0.0.1", port=57291, reload=True)
