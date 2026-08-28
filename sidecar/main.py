from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import faulthandler
import platform
import psutil

# Dump Python stacks on native crashes (Metal assertions, SIGABRT/SIGSEGV).
faulthandler.enable()

from api import generation
from api import video as video_api

app = FastAPI(title="AI Creative Workstation Inference Sidecar")

# Allow renderer (localhost:5173) to call the sidecar
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(generation.router, prefix="/api")
app.include_router(video_api.router, prefix="/api")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "acw-sidecar"}

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

    # No reload=True: the reloader leaves orphan workers holding the port.
    # Pass the app object, not "main:app", so uvicorn does not re-import from
    # Electron's cwd and block /health on heavy ML imports.
    uvicorn.run(app, host="127.0.0.1", port=57291, log_level="info")
