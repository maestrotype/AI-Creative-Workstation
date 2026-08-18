# SYSTEM ARCHITECTURE
## AI Creative Workstation — Technical Blueprint

---

## Architecture Decision Record: Desktop Shell

### Decision
**Electron** for the desktop shell, with a **Python sidecar** for AI inference orchestration.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Electron** | Guaranteed WebGPU (Chromium); mature ecosystem; LM Studio, InvokeAI, Jan.ai all use it; Node.js IPC to Python sidecar is well-understood | Memory overhead (~150MB); large bundle size |
| **Tauri 2.0** | Smaller bundle; lower idle memory | WebGPU consistency across macOS WebKit unreliable; 3D viewport work requires native overlay; adds Rust complexity |
| **Native (Swift/Rust)** | Best performance; smallest memory | 2–3× UI development cost; cross-platform impossible without platform-specific code |
| **PWA/Browser** | No installation; easy updates | No local file access; no subprocess management; no GPU inference |

### Chosen: Electron

**Why:** The memory overhead (150MB) is negligible when the application will allocate 16–64GB for model weights. Electron's guaranteed Chromium WebGPU support is essential for the 3D viewport and procedural animations. The Python inference ecosystem is centered on subprocess + HTTP/WebSocket — this maps cleanly to Electron's Node.js runtime. Most comparable professional-grade AI desktop tools (LM Studio, InvokeAI, Jan.ai) use Electron.

**Trade-off acknowledged:** Large installer size (~150MB before models). Mitigated by not shipping models in the installer.

**Future escape path:** If WebGPU stabilizes across platform webviews, migrate the UI layer to Tauri while keeping Electron as an option. The Python sidecar architecture is shell-agnostic.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  CANVAS — Desktop Application                                   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Renderer Process (Electron + Chromium)                  │   │
│  │                                                          │   │
│  │  React + TypeScript + Vite                               │   │
│  │  ├── Design System Components                            │   │
│  │  ├── Application Shell (Layout, Navigation, State)       │   │
│  │  ├── Create Module (Intent, Generation, Result)          │   │
│  │  ├── Project Module (Project, Scene, Timeline)           │   │
│  │  ├── Asset Module (Character, Product, Style, Library)   │   │
│  │  ├── Studio Module (Hardware, Models, Providers)         │   │
│  │  ├── 3D Viewport (Three.js / React Three Fiber)          │   │
│  │  └── Settings Module                                     │   │
│  └──────────────────────┬────────────────────────────────── ┘   │
│                         │ IPC (Electron contextBridge)          │
│  ┌──────────────────────▼────────────────────────────────── ┐   │
│  │  Main Process (Electron + Node.js)                       │   │
│  │                                                          │   │
│  │  ├── Application Lifecycle Manager                       │   │
│  │  ├── File System Service (projects, models, assets)      │   │
│  │  ├── Database Service (SQLite via better-sqlite3)        │   │
│  │  ├── Hardware Detector                                   │   │
│  │  ├── Job Queue Manager                                   │   │
│  │  ├── Process Manager (Python sidecar lifecycle)          │   │
│  │  ├── Cloud API Client (fetch, credentials)               │   │
│  │  ├── Model Registry (local model catalog)                │   │
│  │  └── Sidecar IPC Bridge (HTTP / WebSocket to sidecar)    │   │
│  └──────────────────────┬────────────────────────────────── ┘   │
│                         │ HTTP / WebSocket (localhost)          │
│  ┌──────────────────────▼────────────────────────────────── ┐   │
│  │  Python Inference Sidecar (subprocess, managed)          │   │
│  │                                                          │   │
│  │  ├── Sidecar API (FastAPI, port 57291)                   │   │
│  │  ├── Capability Router                                   │   │
│  │  ├── Execution Providers:                                │   │
│  │  │   ├── MLX Provider (Apple Silicon)                    │   │
│  │  │   ├── CUDA Provider (NVIDIA)                          │   │
│  │  │   ├── ComfyUI Bridge (optional, existing installs)    │   │
│  │  │   └── CPU Fallback                                    │   │
│  │  ├── Model Loader / Unloader                             │   │
│  │  ├── llama.cpp Bridge (LLM inference)                    │   │
│  │  └── ONNX Runtime (auxiliary vision tasks)               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌────────────────────────────────────────────────────────── ┐   │
│  │  Cloud Provider Layer (external)                         │   │
│  │  ├── fal.ai (images, video via API)                      │   │
│  │  ├── Replicate (models via API)                          │   │
│  │  └── Canvas Cloud (future proprietary GPU pool)          │   │
│  └────────────────────────────────────────────────────────── ┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Layer Architecture

```
Storage Architecture:
├── SQLite (metadata, graph, job queue)     — ~/.canvas/canvas.db
├── Filesystem (projects, assets, models)  — ~/Documents/Canvas/
│   ├── projects/
│   │   └── {project_id}/
│   │       ├── project.json              (project metadata)
│   │       ├── assets/                  (project-scoped assets)
│   │       └── outputs/                 (generated media)
│   ├── assets/                          (global asset library)
│   │   └── {asset_id}/
│   │       ├── asset.json               (asset metadata)
│   │       ├── sources/                 (reference photos/files)
│   │       ├── identity/                (embeddings, face models — NEVER synced to cloud)
│   │       └── outputs/                 (generated content)
│   └── models/                          (AI model files)
│       ├── image/
│       ├── video/
│       ├── 3d/
│       ├── llm/
│       └── voice/
└── User Preferences                      — Electron userDataPath
```

### Database Schema (High-Level)

```sql
-- Core entity tables
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,        -- 'character' | 'product' | 'environment' | 'style' | 'voice'
  name TEXT NOT NULL,
  description TEXT,
  thumbnail_path TEXT,
  version INTEGER DEFAULT 1,
  created_at INTEGER,
  updated_at INTEGER,
  metadata JSON             -- type-specific metadata (strength, voice_profile, etc.)
);

CREATE TABLE asset_versions (
  id TEXT PRIMARY KEY,
  asset_id TEXT REFERENCES assets(id),
  version INTEGER,
  source_paths JSON,        -- reference photos/files
  identity_path TEXT,       -- embedded identity (face embedding, style vector)
  created_at INTEGER
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT,
  type TEXT,                -- 'image_pack' | 'video' | 'content_package' | 'asset_build'
  status TEXT,              -- 'active' | 'complete' | 'archived'
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE scenes (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  position INTEGER,
  name TEXT,
  status TEXT,
  metadata JSON             -- scene-specific configuration
);

CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  type TEXT,                -- 'image' | 'video' | 'audio' | 'mesh3d'
  scene_id TEXT REFERENCES scenes(id),
  project_id TEXT REFERENCES projects(id),
  status TEXT,              -- 'pending' | 'running' | 'complete' | 'failed'
  prompt TEXT,
  enhanced_prompt TEXT,
  seed INTEGER,
  output_path TEXT,
  thumbnail_path TEXT,
  created_at INTEGER,
  completed_at INTEGER,
  metadata JSON             -- full generation provenance
);

-- Asset Graph (relationships)
CREATE TABLE asset_relationships (
  id TEXT PRIMARY KEY,
  from_id TEXT,             -- asset_id or generation_id
  from_type TEXT,           -- 'asset' | 'generation'
  to_id TEXT,
  to_type TEXT,
  relationship TEXT,        -- 'used_in' | 'derived_from' | 'influenced_by' | ...
  strength REAL,            -- 0.0–1.0 (for weighted relationships)
  created_at INTEGER
);

-- Job system
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT,                -- 'generate_image' | 'generate_video' | etc.
  status TEXT,              -- 'queued' | 'running' | 'complete' | 'failed' | 'cancelled'
  priority INTEGER DEFAULT 0,
  generation_id TEXT,
  provider TEXT,            -- 'local' | 'cloud:fal' | 'cloud:replicate'
  model_id TEXT,
  payload JSON,             -- full job parameters
  progress_step INTEGER,
  progress_total INTEGER,
  error_message TEXT,
  created_at INTEGER,
  started_at INTEGER,
  completed_at INTEGER
);

-- Model registry
CREATE TABLE models (
  id TEXT PRIMARY KEY,
  name TEXT,                -- User-facing name
  technical_name TEXT,      -- e.g., 'flux1-dev-gguf-q8'
  type TEXT,                -- 'image' | 'video' | '3d' | 'llm' | 'voice'
  capabilities JSON,        -- list of capabilities this model satisfies
  installed BOOLEAN DEFAULT FALSE,
  path TEXT,                -- local path if installed
  size_bytes INTEGER,
  license TEXT,
  commercial_ok BOOLEAN,
  min_memory_gb REAL,       -- minimum RAM/VRAM required
  recommended_memory_gb REAL,
  format TEXT,              -- 'gguf' | 'safetensors' | 'onnx' | 'mlx'
  engine TEXT,              -- 'mlx' | 'cuda' | 'cpu' | 'onnx'
  quality_score REAL,       -- 0.0–1.0, our internal benchmark
  speed_score REAL,
  metadata JSON
);

-- Hardware profiles (cached detection results)
CREATE TABLE hardware_profile (
  id INTEGER PRIMARY KEY,
  detected_at INTEGER,
  profile JSON              -- full hardware detection result
);
```

---

## Provider Architecture

### Capability → Provider Resolution

```
User requests: ImageGenerationCapability + IdentityPreservationCapability

CapabilityResolver:
1. Query ModelRegistry for models satisfying both capabilities
2. Filter by: hardware compatibility, installed, license ok, quality score
3. For each candidate model, determine execution provider:
   - Apple Silicon + MLX format → MLXProvider
   - NVIDIA GPU + SafeTensors/GGUF → CUDAProvider
   - No local GPU → CloudProvider
4. Select best option: local preferred, cloud as fallback
5. Return ExecutionPlan

ExecutionPlan:
{
  capability: "image_generation_with_identity",
  model: { id: "flux1-dev-mlx-q8", engine: "mlx" },
  provider: "local:mlx",
  estimated_seconds: 12,
  memory_required_gb: 16
}
```

### Provider Interface (TypeScript)

```typescript
interface ExecutionProvider {
  id: string;
  type: 'local' | 'cloud';
  name: string;
  
  // Check if provider can handle this request
  canExecute(request: GenerationRequest): Promise<boolean>;
  
  // Execute the generation
  execute(request: GenerationRequest): AsyncGenerator<JobProgress>;
  
  // Cancel a running job
  cancel(jobId: string): Promise<void>;
  
  // Get current resource availability
  getAvailability(): Promise<ProviderAvailability>;
}

interface GenerationRequest {
  capability: CapabilityType;
  params: Record<string, unknown>;
  assets: AssetReference[];
  model_id?: string;  // if user explicitly selected
  seed?: number;
  resolution?: Resolution;
}

interface JobProgress {
  job_id: string;
  step: number;
  total_steps: number;
  status: 'running' | 'complete' | 'failed';
  message: string;  // creative language, not technical
  output?: GenerationOutput;
  error?: CreativeError;
}
```

---

## Python Sidecar API

The Python sidecar runs as a subprocess and exposes a FastAPI server on localhost. It handles all AI inference.

### API Endpoints

```
POST /generate/image
  Body: GenerationRequest
  Response: SSE stream of progress events

POST /generate/video
  Body: GenerationRequest
  Response: SSE stream of progress events

POST /generate/3d
  Body: GenerationRequest
  Response: SSE stream of progress events

POST /generate/audio
  Body: GenerationRequest
  Response: SSE stream of progress events

POST /assets/character/build
  Body: { source_paths: string[], config: CharacterConfig }
  Response: CharacterIdentity (face embeddings, style vectors)

GET /models
  Response: List of loaded/available models

POST /models/load
  Body: { model_id: string }
  Response: success/failure

POST /models/unload
  Body: { model_id: string }
  Response: success/failure

GET /hardware
  Response: HardwareProfile (detected capabilities)

GET /health
  Response: sidecar status, loaded models, memory usage
```

### Sidecar Process Management

```typescript
// Main process: sidecar management
class SidecarManager {
  private process: ChildProcess | null = null;
  private port = 57291;
  
  async start(): Promise<void> {
    // Launch Python sidecar as subprocess
    // Wait for /health to return 200
    // Handle crash → restart with exponential backoff
  }
  
  async stop(): Promise<void> {
    // Graceful shutdown: wait for active jobs to complete or cancel
    // SIGTERM → wait 10s → SIGKILL
  }
  
  async ensureRunning(): Promise<void> {
    // Check /health; restart if needed
  }
}
```

---

## Job System Architecture

### Job Queue

The job queue is managed in SQLite with polling from the Node.js main process:

```
Job Lifecycle:
CREATED → QUEUED → RESERVED → RUNNING → COMPLETE
                                      → FAILED → RETRY → QUEUED
                                               → ABANDONED
                             → CANCELLED
```

### Job Execution Flow

```typescript
class JobQueueManager {
  // Concurrency: 1 local GPU job, unlimited cloud jobs
  private localGPUSemaphore = new Semaphore(1);
  private cloudSemaphore = new Semaphore(5);
  
  async enqueue(job: Job, priority: number = 0): Promise<string>;
  async cancel(jobId: string): Promise<void>;
  async getStatus(jobId: string): Promise<JobStatus>;
  
  private async processNext(): Promise<void> {
    const job = await this.db.getNextQueuedJob();
    if (!job) return;
    
    const provider = this.resolveProvider(job);
    const semaphore = provider.type === 'local' 
      ? this.localGPUSemaphore 
      : this.cloudSemaphore;
    
    await semaphore.acquire();
    try {
      await this.execute(job, provider);
    } finally {
      semaphore.release();
    }
  }
}
```

### Progress Reporting

Progress events flow from sidecar → main process → renderer:

```
Sidecar: SSE event
  { step: 3, total: 8, message: "Composing identity", percent: 37 }
    ↓
Main Process: JobQueueManager forwards via IPC
    ↓
Renderer: React state update → UI update

UI shows:
  ████████████░░░░░░░░  37%
  Composing identity
  Estimated: 8 seconds
```

---

## Security Architecture

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| Malicious model file (pickle injection) | Reject `.pkl` files; only SafeTensors (safe format) and GGUF (verified parsers); code signing check on model files |
| Cloud provider credential exposure | Stored in OS keychain (Electron keytar), never in plaintext files |
| User photos uploaded without consent | Cloud consent flow required; always-local mode available; no automatic cloud upload |
| Python sidecar RCE | Sidecar runs on localhost only; no external network access; input sanitization |
| Plugin malicious code execution | Plugins run in sandboxed iframe or separate renderer process |
| VRAM/memory exhaustion | Memory guard: reject jobs if estimated memory > available − safety margin |

### Privacy Architecture

```
Data Classification:
┌─────────────────────────────────────────────────┐
│  NEVER LEAVES DEVICE (by design):               │
│  - Source photos and reference images           │
│  - Face identity embeddings                     │
│  - Voice profiles                               │
│  - Project files                                │
│  - Generation seeds and prompts (local jobs)    │
│  - Asset metadata and relationships             │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  LEAVES DEVICE ONLY WITH CONSENT:               │
│  - Source photos (when cloud job requires them) │
│  - Generated images (when used as input)        │
│  - Prompts (when cloud generation)              │
│  - Consent is explicit, per-generation          │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  LEAVES DEVICE (always, telemetry):             │
│  - Anonymous crash reports (opt-out available)  │
│  - Generation success/failure counts            │
│  - NO prompts, NO images, NO identifiable data  │
└─────────────────────────────────────────────────┘
```

---

## Hardware Capability Detection

```typescript
interface HardwareProfile {
  os: 'macos' | 'windows' | 'linux';
  arch: 'arm64' | 'x86_64';
  cpu: {
    model: string;
    cores: number;
  };
  gpu: {
    model: string;
    vram_gb: number;            // 0 if unified memory
    vendor: 'nvidia' | 'amd' | 'intel' | 'apple';
    cuda_version?: string;
    metal_version?: string;
  };
  memory_gb: number;            // total RAM
  unified_memory: boolean;      // Apple Silicon
  storage_available_gb: number;
  
  // Computed capability ratings
  capabilities: {
    image_generation: CapabilityRating;    // 'excellent' | 'good' | 'moderate' | 'poor'
    video_generation: CapabilityRating;
    image_to_3d: CapabilityRating;
    llm_inference: CapabilityRating;
    voice_synthesis: CapabilityRating;
  };
  
  // Available inference engines (detected)
  engines: {
    mlx: boolean;
    cuda: boolean;
    metal: boolean;
    vulkan: boolean;
    cpu: boolean;
  };
}

// Capability rating thresholds (Apple Silicon example):
// image_generation:
//   excellent: unified_memory >= 16GB
//   good:      unified_memory >= 8GB
//   moderate:  unified_memory >= 4GB
//   poor:      otherwise (CPU only)
```

---

## Recommended Technology Stack (Full)

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Desktop shell | Electron | 32+ | Guaranteed WebGPU; mature AI app ecosystem |
| UI framework | React | 19 | Industry standard; best TypeScript support; large ecosystem |
| Build tool | Vite + electron-vite | Latest | Fast HMR; optimized Electron builds |
| Language | TypeScript | 5.5+ | Type safety across all layers |
| 3D viewport | Three.js + React Three Fiber | Latest | Mature ecosystem; good GLTF support; WebGPU renderer |
| UI animation | Framer Motion | 11+ | React-native; GPU-accelerated |
| Database | SQLite via better-sqlite3 | Latest | Synchronous; fast; battle-tested in Electron |
| ORM | Drizzle | Latest | TypeScript-first; zero overhead |
| Vector search | sqlite-vec | Latest | Local embedding search without external DB |
| State management | Zustand | Latest | Lightweight; simple; good with async |
| Python inference | Python 3.11 + FastAPI | Latest | Stable; fast async; good for SSE |
| Image models | MLX-Diffusion (Mac), ComfyUI headless (Win) | Latest | Best local performance per platform |
| LLM | llama.cpp (via Python binding) | Latest | C++ core; GGUF; Metal + CUDA |
| 3D generation | Hunyuan 3D (Python) | Latest | Best open-source option with PBR |
| Credential storage | Electron keytar / OS keychain | — | Secure OS-native credential storage |
| Cloud images | fal.ai API | — | Fast; good model selection; FLUX support |
| Cloud video | fal.ai or Replicate API | — | Both support Wan models |
| Website | Next.js 15 + React | Latest | SSG; App Router; Vercel native |
| Website hosting | Vercel | — | Edge network; zero config |
