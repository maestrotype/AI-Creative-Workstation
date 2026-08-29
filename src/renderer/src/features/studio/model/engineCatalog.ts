export type EngineFamily = 'image' | 'video' | '3d' | 'voice';

export interface CatalogEngine {
  id: string;
  name: string;
  type: Exclude<EngineFamily, 'voice'>;
  gated: boolean;
  size: string;
  /** Sidecar can run this family today. */
  downloadable: boolean;
  noteKey: string;
}

export const ENGINE_FAMILIES: EngineFamily[] = ['image', 'video', '3d', 'voice'];

export const CATALOG_ENGINES: CatalogEngine[] = [
  {
    id: 'stabilityai/sdxl-turbo',
    name: 'SDXL Turbo',
    type: 'image',
    gated: false,
    size: '~7 GB',
    downloadable: true,
    noteKey: 'studio.note_sdxl_turbo',
  },
  {
    id: 'stabilityai/stable-diffusion-xl-base-1.0',
    name: 'SDXL Base 1.0',
    type: 'image',
    gated: false,
    size: '~14 GB',
    downloadable: true,
    noteKey: 'studio.note_sdxl_base',
  },
  {
    id: 'black-forest-labs/FLUX.1-schnell',
    name: 'FLUX.1 Schnell',
    type: 'image',
    gated: true,
    size: '~32 GB',
    downloadable: true,
    noteKey: 'studio.note_flux_schnell',
  },
  {
    id: 'black-forest-labs/FLUX.1-dev',
    name: 'FLUX.1 Dev',
    type: 'image',
    gated: true,
    size: '~32 GB',
    downloadable: true,
    noteKey: 'studio.note_flux_dev',
  },
  {
    id: 'Lightricks/LTX-Video',
    name: 'LTX Video',
    type: 'video',
    gated: false,
    size: '~8 GB+',
    downloadable: false,
    noteKey: 'studio.note_ltx',
  },
  {
    id: 'Wan-AI/Wan2.1-T2V-1.3B',
    name: 'Wan 2.1 T2V 1.3B',
    type: 'video',
    gated: false,
    size: '~6 GB+',
    downloadable: false,
    noteKey: 'studio.note_wan',
  },
  {
    id: 'stabilityai/TripoSR',
    name: 'TripoSR',
    type: '3d',
    gated: false,
    size: '~1.5 GB',
    downloadable: false,
    noteKey: 'studio.note_triposr',
  },
  {
    id: 'tencent/Hunyuan3D-2',
    name: 'Hunyuan3D 2',
    type: '3d',
    gated: true,
    size: '~20 GB+',
    downloadable: false,
    noteKey: 'studio.note_hunyuan3d',
  },
];
