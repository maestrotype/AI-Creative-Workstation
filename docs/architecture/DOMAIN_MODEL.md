# DOMAIN MODEL
## AI Creative Workstation — Entities, Relationships, Behavior

---

## Domain Model Overview

```mermaid
erDiagram
    Project {
        string id PK
        string name
        string type
        string status
        json consistency_context
        timestamp created_at
        timestamp updated_at
    }
    
    Asset {
        string id PK
        string type
        string name
        int current_version
        json metadata
        timestamp created_at
    }
    
    AssetVersion {
        string id PK
        string asset_id FK
        int version
        json source_paths
        string identity_path
        timestamp created_at
    }
    
    Character {
        string asset_id FK
        string[] source_photo_paths
        string face_embedding_path
        string voice_id
        string mesh3d_id
        float identity_strength
    }
    
    Style {
        string asset_id FK
        string[] reference_paths
        string style_vector_path
        json color_palette
        string description
    }
    
    Scene {
        string id PK
        string project_id FK
        int position
        string name
        string status
        json prompt_context
    }
    
    Generation {
        string id PK
        string type
        string scene_id FK
        string project_id FK
        string status
        string prompt
        string enhanced_prompt
        int seed
        string output_path
        json provenance
        timestamp created_at
        timestamp completed_at
    }
    
    Job {
        string id PK
        string generation_id FK
        string status
        int priority
        string provider
        string model_id
        json payload
        int progress_step
        int progress_total
        string error_message
        timestamp created_at
        timestamp started_at
        timestamp completed_at
    }
    
    AssetRelationship {
        string id PK
        string from_id
        string from_type
        string to_id
        string to_type
        string relationship_type
        float strength
    }
    
    Model {
        string id PK
        string name
        string technical_name
        string type
        json capabilities
        bool installed
        string path
        int size_bytes
        string license
        bool commercial_ok
        float min_memory_gb
        string format
        string engine
        float quality_score
        float speed_score
    }
    
    Project ||--o{ Scene : "contains"
    Scene ||--o{ Generation : "has"
    Project ||--o{ Generation : "has"
    Generation ||--|| Job : "executed by"
    Asset ||--o{ AssetVersion : "has versions"
    Asset ||--o{ Character : "is type"
    Asset ||--o{ Style : "is type"
    Generation }o--o{ Asset : "used (via AssetRelationship)"
    Generation }o--o{ Generation : "derived from (via AssetRelationship)"
```

---

## Entity Specifications

### Project

A Project is the top-level organizational unit. Everything belongs to a project.

```typescript
interface Project {
  id: string;                    // ULID
  name: string;
  type: ProjectType;
  status: ProjectStatus;
  
  // AI Director consistency settings
  consistency_context: {
    host_character_id?: string;
    style_asset_id?: string;
    product_asset_ids?: string[];
    visual_theme?: string;
    camera_language?: string;
  };
  
  // Statistics (computed)
  scene_count: number;
  generation_count: number;
  total_duration_ms: number;    // for video projects
  
  created_at: Date;
  updated_at: Date;
}

type ProjectType = 
  | 'image_pack'        // Collection of related images
  | 'video_production'  // Full video with scenes, audio, script
  | 'content_package'   // Multi-format (video + shorts + thumbnail)
  | 'asset_build'       // Building a reusable asset
  | 'free'              // No structure imposed;

type ProjectStatus = 'active' | 'producing' | 'complete' | 'archived';
```

---

### Asset (and Subtypes)

```typescript
interface Asset {
  id: string;           // ULID
  type: AssetType;
  name: string;
  description?: string;
  thumbnail_path?: string;
  current_version: number;
  
  // Soft-delete
  deleted_at?: Date;
  
  created_at: Date;
  updated_at: Date;
}

type AssetType = 'character' | 'product' | 'environment' | 'style' | 'voice' | 'collection';

// Character-specific data (stored in assets.metadata + separate character table)
interface CharacterData {
  asset_id: string;
  source_photo_paths: string[];       // Reference photos
  face_embedding_path: string;        // IP-Adapter / face identity vector (NEVER leaves device)
  identity_strength: number;          // 0.0–1.0, user-adjustable
  
  // Optional extensions
  voice_asset_id?: string;            // linked Voice asset
  mesh3d_generation_id?: string;      // linked 3D generation
  
  // Physical traits (for generation guidance)
  physical_description?: string;      // "Late 20s, athletic build, dark hair"
  default_style?: string;             // "Professional, cinematic"
}

// Style-specific data
interface StyleData {
  asset_id: string;
  reference_paths: string[];
  style_vector_path: string;          // Computed CLIP embedding (local)
  color_palette: string[];            // Hex colors extracted
  mood_tags: string[];                // "cinematic", "editorial", "moody"
  description?: string;
}
```

---

### Generation

A Generation is a single AI-produced output — an image, video clip, 3D mesh, or audio track.

```typescript
interface Generation {
  id: string;
  type: GenerationType;
  
  // Context
  scene_id?: string;                  // null if standalone
  project_id?: string;                // null if standalone
  
  // Input
  prompt: string;                     // User prompt or AI-generated
  enhanced_prompt?: string;           // LLM-enhanced version
  negative_prompt?: string;
  seed?: number;
  
  // Output
  status: GenerationStatus;
  output_path?: string;
  thumbnail_path?: string;
  output_metadata: OutputMetadata;    // resolution, duration, fps, etc.
  
  // Provenance (full record for reproducibility)
  provenance: GenerationProvenance;
  
  // Timestamps
  created_at: Date;
  completed_at?: Date;
}

type GenerationType = 'image' | 'video' | 'audio' | 'mesh3d' | 'voice' | 'script';
type GenerationStatus = 'pending' | 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';

interface GenerationProvenance {
  model_id: string;
  model_version?: string;
  provider: string;                   // 'local:mlx' | 'cloud:fal' etc.
  engine: string;
  hardware_profile_id?: number;
  
  // Asset references used
  assets_used: Array<{
    asset_id: string;
    asset_version: number;
    role: string;                     // 'identity' | 'style' | 'product' | etc.
    strength: number;
  }>;
  
  // Full inference parameters (for Lab mode and reproducibility)
  inference_params: Record<string, unknown>;
  
  // Timing
  queue_time_ms: number;
  inference_time_ms: number;
  
  can_reproduce: boolean;
}
```

---

### Model

```typescript
interface Model {
  id: string;                         // e.g., 'flux1-dev-mlx-q8'
  name: string;                       // User-facing: "FLUX — Quality"
  technical_name: string;             // Exact technical identifier
  type: ModelType;
  
  // Capabilities this model satisfies
  capabilities: Capability[];
  
  // Availability
  installed: boolean;
  path?: string;                      // Local path if installed
  cloud_available: boolean;
  
  // Requirements
  size_bytes: number;
  min_memory_gb: number;
  recommended_memory_gb: number;
  format: ModelFormat;
  engine: InferenceEngine;
  
  // Licensing
  license: string;
  commercial_ok: boolean;
  attribution_required: boolean;
  
  // Quality metrics (our internal benchmarks)
  quality_score: number;             // 0.0–1.0
  speed_score: number;               // 0.0–1.0 (relative to category)
  
  // Platform support
  platforms: Array<'macos_arm64' | 'windows_cuda' | 'linux_cuda' | 'cpu'>;
  
  // Download
  download_url?: string;
  checksum?: string;
}

type ModelType = 'image' | 'video' | '3d' | 'llm' | 'voice' | 'music' | 'auxiliary';
type ModelFormat = 'gguf' | 'safetensors' | 'onnx' | 'mlx' | 'mlx_4bit' | 'coreml';
type InferenceEngine = 'mlx' | 'cuda' | 'cpu' | 'onnx' | 'comfyui' | 'llamacpp';

// Capability registry
type Capability =
  | 'image_generation'
  | 'image_editing'
  | 'identity_preservation'
  | 'text_rendering'
  | 'image_upscaling'
  | 'image_inpainting'
  | 'style_transfer'
  | 'video_generation'
  | 'video_to_video'
  | 'image_to_video'
  | 'video_upscaling'
  | 'character_consistency'
  | 'image_to_3d'
  | 'text_to_3d'
  | '3d_texturing'
  | '3d_rigging'
  | '3d_animation'
  | 'speech_to_text'
  | 'text_to_speech'
  | 'voice_cloning'
  | 'music_generation'
  | 'script_generation'
  | 'prompt_enhancement'
  | 'image_segmentation'
  | 'depth_estimation'
  | 'pose_estimation';
```

---

## Domain Events

The system communicates between layers via domain events:

```typescript
type DomainEvent =
  | { type: 'job.queued'; job_id: string; }
  | { type: 'job.started'; job_id: string; provider: string; }
  | { type: 'job.progress'; job_id: string; step: number; total: number; message: string; }
  | { type: 'job.completed'; job_id: string; generation_id: string; output_path: string; }
  | { type: 'job.failed'; job_id: string; error: CreativeError; }
  | { type: 'job.cancelled'; job_id: string; }
  | { type: 'asset.created'; asset_id: string; type: AssetType; }
  | { type: 'asset.updated'; asset_id: string; new_version: number; }
  | { type: 'model.installed'; model_id: string; }
  | { type: 'model.install_progress'; model_id: string; bytes_downloaded: number; bytes_total: number; }
  | { type: 'hardware.scan_complete'; profile: HardwareProfile; }
  | { type: 'cloud.request_consent'; provider: string; data_description: string; }
  | { type: 'cloud.consent_granted'; }
  | { type: 'cloud.consent_denied'; };
```

---

## Error Taxonomy

All errors presented to the user in creative language:

```typescript
type CreativeErrorCode =
  | 'hardware.insufficient_memory'    // "Your Mac needs more memory for this"
  | 'hardware.unsupported_operation'  // "This requires a different type of hardware"
  | 'model.not_installed'             // "This model isn't installed yet"
  | 'model.generation_failed'         // "The generation didn't succeed — try again"
  | 'cloud.timeout'                   // "Cloud took too long — try again"
  | 'cloud.no_credits'                // "You're out of cloud credits"
  | 'cloud.consent_required'          // "Allow cloud access to continue"
  | 'asset.reference_missing'         // "One of your reference photos is missing"
  | 'asset.identity_too_weak'         // "Not enough reference photos for good identity"
  | 'job.cancelled'                   // "Generation was stopped"
  | 'storage.insufficient_space'      // "Not enough disk space"
  | 'network.unavailable';            // "No internet connection"

interface CreativeError {
  code: CreativeErrorCode;
  message: string;                    // Human-readable, creative language
  recovery_options: RecoveryAction[];
  technical_detail?: string;          // Only in Lab mode / debug
}

interface RecoveryAction {
  label: string;
  action: () => void | Promise<void>;
}
```
