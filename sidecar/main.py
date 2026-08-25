from fastapi import FastAPI
import platform
import psutil

app = FastAPI(title="Canvas Inference Sidecar")

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
    # Start on port 57291 as defined in SYSTEM_ARCHITECTURE.md
    uvicorn.run("main:app", host="127.0.0.1", port=57291, reload=True)
