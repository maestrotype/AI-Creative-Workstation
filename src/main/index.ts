import { app, shell, BrowserWindow, ipcMain, protocol, net, dialog, desktopCapturer, session } from 'electron';
import { basename, extname, join, resolve, sep } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
// import icon from '../../resources/icon.png?asset'

import { spawn, spawnSync, ChildProcess, execFileSync } from 'child_process';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, statfsSync, unlinkSync, writeFileSync } from 'fs';
import { homedir, freemem, totalmem } from 'os';
import { initDb, getDb } from './db';
import { models, settings } from './db/schema';
import { eq } from 'drizzle-orm';

app.setName('AI Creative Workstation');
process.title = 'AI Creative Workstation';
const legacyUserData = join(app.getPath('appData'), 'canvas');
if (existsSync(legacyUserData)) {
  app.setPath('userData', legacyUserData);
}

process.on('uncaughtException', (err) => {
  if (err.message.includes('EPIPE')) {
    return;
  }
  console.error('Uncaught Exception:', err);
});

const SIDECAR_URL = 'http://127.0.0.1:57291';
const SIDECAR_PORT = 57291;
const ACTIVE_MODEL_KEY = 'active_model_id';
const ACTIVE_3D_MODEL_KEY = 'active_3d_model_id';
let sidecarProcess: ChildProcess | null = null;
let engineStatus: 'stopped' | 'starting' | 'ready' | 'error' = 'stopped';
let engineDetail = '';
let ignoreSidecarExit = false;

// Active download.py processes keyed by model id. If the handle is dropped,
// killing/retrying leaves orphans (PPID=1) that keep using RAM and writing disk.
const activeDownloads: Map<string, ChildProcess> = new Map();
let micRecorder: ChildProcess | null = null;
let micOutPath: string | null = null;

const voiceInstallJob = {
  active: false,
  stage: 'idle',
  percent: 0,
  detail: '',
};

function sidecarRootDir(): string {
  return join(__dirname, '../../sidecar');
}

function voiceVenvPython(): string {
  return join(sidecarRootDir(), '.venv-tts/bin/python3');
}

function coquiTtsCacheDir(): string {
  return join(homedir(), 'Library/Application Support/tts');
}

function xttsWeightsDir(): string {
  return join(coquiTtsCacheDir(), 'tts_models--multilingual--multi-dataset--xtts_v2');
}

function voiceVerifyScript(): string {
  return join(sidecarRootDir(), 'verify_xtts.py');
}

function voicePackagesReady(): boolean {
  const py = voiceVenvPython();
  const script = voiceVerifyScript();
  if (!existsSync(py) || !existsSync(script)) return false;
  const check = spawnSync(py, [script], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, COQUI_TOS_AGREED: '1' },
  });
  return check.status === 0;
}

function voiceWeightsReady(): boolean {
  const dir = xttsWeightsDir();
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some(
      (name) => name.endsWith('.pth') || name === 'config.json' || name === 'model.pth',
    );
  } catch {
    return false;
  }
}

function voiceEngineStatusPayload() {
  return {
    packages_ready: voicePackagesReady(),
    weights_ready: voiceWeightsReady(),
    installing: voiceInstallJob.active,
    stage: voiceInstallJob.stage,
    percent: voiceInstallJob.percent,
    detail: voiceInstallJob.detail,
    cache_path: coquiTtsCacheDir(),
  };
}

function parseVoiceProgressLine(line: string): void {
  if (!line.startsWith('{')) return;
  try {
    const payload = JSON.parse(line) as { progress?: number; stage?: string; detail?: string };
    if (payload.progress == null) return;
    voiceInstallJob.stage = String(payload.stage ?? voiceInstallJob.stage);
    voiceInstallJob.percent = Number(payload.progress);
    voiceInstallJob.detail = String(payload.detail ?? voiceInstallJob.detail);
    broadcast('voice-engine-updated', voiceEngineStatusPayload());
  } catch {
    /* ignore non-json lines */
  }
}

async function downloadXttsWeights(): Promise<void> {
  const py = voiceVenvPython();
  const script = join(sidecarRootDir(), 'download_xtts.py');
  if (!existsSync(py) || !existsSync(script)) {
    throw new Error('Voice packages are not installed yet.');
  }
  voiceInstallJob.stage = 'weights';
  voiceInstallJob.percent = 35;
  voiceInstallJob.detail = 'Downloading XTTS v2 weights (~2 GB)';
  broadcast('voice-engine-updated', voiceEngineStatusPayload());

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(py, [script], {
      cwd: sidecarRootDir(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, COQUI_TOS_AGREED: '1' },
    });
    let lastError = 'XTTS download failed';
    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        parseVoiceProgressLine(trimmed);
        if (trimmed.includes('"ok"')) {
          try {
            const payload = JSON.parse(trimmed) as { ok?: boolean; error?: string };
            if (payload.ok === false) lastError = payload.error ?? lastError;
          } catch {
            /* ignore */
          }
        }
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) voiceInstallJob.detail = text.slice(-200);
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0 && voiceWeightsReady()) resolve();
      else if (/EOF when reading a line|CPML|confirm/i.test(lastError)) {
        reject(new Error('Coqui license prompt failed. Restart the app and click Download again.'));
      } else reject(new Error(lastError));
    });
  });
}

function ffmpegBin(): string {
  try {
    return execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('ffmpeg is not installed (brew install ffmpeg)');
  }
}

function ffprobeBin(): string {
  try {
    return execFileSync('which', ['ffprobe'], { encoding: 'utf8' }).trim();
  } catch {
    return ffmpegBin().replace(/ffmpeg$/i, 'ffprobe');
  }
}

function probeMediaDurationSec(filePath: string): number {
  try {
    const raw = execFileSync(
      ffprobeBin(),
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
      { encoding: 'utf8', timeout: 30_000 },
    ).trim();
    const n = Number.parseFloat(raw.split('\n')[0] ?? '');
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function probeVideoCodec(filePath: string): string {
  try {
    return execFileSync(
      ffprobeBin(),
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', filePath],
      { encoding: 'utf8', timeout: 20_000 },
    )
      .trim()
      .split('\n')[0]
      ?.trim()
      .toLowerCase() ?? '';
  } catch {
    return '';
  }
}

function needsH264Proxy(codec: string): boolean {
  if (!codec) return true;
  return !['h264', 'avc1', 'vp8', 'theora'].includes(codec);
}

function previewProxyPath(sourcePath: string): string {
  const st = statSync(sourcePath);
  const stamp = `${sourcePath}:${st.size}:${Math.floor(st.mtimeMs)}`;
  let hash = 0;
  for (let i = 0; i < stamp.length; i += 1) hash = (hash * 31 + stamp.charCodeAt(i)) >>> 0;
  const dir = join(homedir(), 'Documents/Canvas/Generated/Video/drafts');
  mkdirSync(dir, { recursive: true });
  return join(dir, `preview-${hash.toString(16)}.mp4`);
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), args);
    let err = '';
    child.stderr.on('data', (chunk) => {
      err += String(chunk);
      if (err.length > 8000) err = err.slice(-4000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.slice(-400) || `ffmpeg exited ${code}`));
    });
  });
}

async function ensureH264Preview(sourcePath: string, force: boolean): Promise<{ path: string; transcoded: boolean }> {
  const codec = probeVideoCodec(sourcePath);
  const out = previewProxyPath(sourcePath);
  if (!force && !needsH264Proxy(codec)) {
    return { path: sourcePath, transcoded: false };
  }
  if (existsSync(out) && !force) {
    rememberPickedMedia(out);
    return { path: out, transcoded: true };
  }
  await runFfmpeg([
    '-y',
    '-i', sourcePath,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-crf', '23',
    '-c:a', 'aac',
    '-ac', '2',
    '-b:a', '128k',
    '-movflags', '+faststart',
    out,
  ]);
  rememberPickedMedia(out);
  return { path: out, transcoded: true };
}

function formatSidecarDetail(detail: unknown, status: number, raw: string): string {
  if (typeof detail === 'string' && detail.trim()) return detail.slice(0, 400);
  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      if (item && typeof item === 'object' && 'msg' in item) return String((item as { msg: unknown }).msg);
      return JSON.stringify(item);
    });
    const joined = parts.filter(Boolean).join('; ');
    if (joined) return joined.slice(0, 400);
  }
  if (detail != null && String(detail).trim() && String(detail) !== '[object Object]') {
    return String(detail).slice(0, 400);
  }
  const clipped = raw.replace(/\s+/g, ' ').trim().slice(0, 400);
  return clipped || `HTTP ${status}`;
}

async function sidecarJson(path: string, body: unknown, timeoutMs = 120_000): Promise<Record<string, unknown>> {
  const ready = await ensureSidecarReady();
  if (!ready.ok) {
    throw new Error(ready.error || 'Sidecar unavailable');
  }
  const res = await net.fetch(`${SIDECAR_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => ({}))) as { detail?: unknown };
  if (!res.ok) {
    throw new Error(data.detail != null ? String(data.detail).slice(0, 400) : `HTTP ${res.status}`);
  }
  return data as Record<string, unknown>;
}

function killDownload(modelId: string | null): void {
  if (!modelId) return;
  const proc = activeDownloads.get(modelId);
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
    activeDownloads.delete(modelId);
  }
}

async function isSidecarAlive(): Promise<boolean> {
  try {
    const res = await net.fetch(`${SIDECAR_URL}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function setEngineStatus(status: typeof engineStatus, detail = ''): void {
  engineStatus = status;
  engineDetail = detail;
  broadcast('engine-status', { status, detail });
}

function killProcessOnSidecarPort(): void {
  const { execSync } = require('child_process') as typeof import('child_process');
  try {
    const pids = execSync(`lsof -ti tcp:${SIDECAR_PORT}`, { encoding: 'utf8' }).trim();
    for (const pid of pids.split('\n').filter(Boolean)) {
      const n = Number(pid);
      if (!n || n === process.pid) continue;
      try {
        process.kill(n, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* lsof exits 1 when nothing is listening */
  }
}

function getSettingValue(key: string): string | null {
  const db = getDb();
  const result = db.select().from(settings).where(eq(settings.key, key)).get();
  return result ? result.value : null;
}

function putSettingValue(key: string, value: string): void {
  const db = getDb();
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

function listReadyModels(kind: 'image' | 'video' | '3d' = 'image'): { id: string; name: string }[] {
  const db = getDb();
  return db
    .select()
    .from(models)
    .all()
    .filter((m) => m.status === 'ready' && m.type === kind)
    .map((m) => ({ id: m.id, name: m.name }));
}

function resolveActiveModelId(): string | null {
  const ready = listReadyModels('image');
  if (ready.length === 0) return null;
  const stored = getSettingValue(ACTIVE_MODEL_KEY);
  if (stored && ready.some((m) => m.id === stored)) return stored;
  putSettingValue(ACTIVE_MODEL_KEY, ready[0].id);
  return ready[0].id;
}

function resolveActive3dModelId(): string | null {
  const ready = listReadyModels('3d');
  if (ready.length === 0) return null;
  const stored = getSettingValue(ACTIVE_3D_MODEL_KEY);
  if (stored && ready.some((m) => m.id === stored)) return stored;
  const hunyuan = ready.find((m) => m.id === 'tencent/Hunyuan3D-2mini');
  const pick = hunyuan ?? ready[0];
  putSettingValue(ACTIVE_3D_MODEL_KEY, pick.id);
  return pick.id;
}

function startSidecar(): void {
  const sidecarDir = join(__dirname, '../../sidecar');
  const sidecarPath = join(sidecarDir, 'main.py');
  console.log('Starting Python Sidecar:', sidecarPath);
  setEngineStatus('starting');

  sidecarProcess = spawn('python3', ['-u', sidecarPath], {
    cwd: sidecarDir,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTORCH_ENABLE_MPS_FALLBACK: '1',
      PYTORCH_MPS_HIGH_WATERMARK_RATIO: '0.0',
    },
    stdio: 'inherit',
  });

  sidecarProcess.on('error', (err) => {
    console.error('Failed to start sidecar:', err);
    setEngineStatus('error', err.message);
  });

  sidecarProcess.on('exit', (code) => {
    sidecarProcess = null;
    if (ignoreSidecarExit) {
      ignoreSidecarExit = false;
      return;
    }
    if (engineStatus !== 'stopped') {
      console.error(`Sidecar exited with code ${code}`);
      setEngineStatus('error', `exited ${code ?? 'unknown'}`);
    }
  });
}

async function bootSidecar(timeoutMs = 20_000): Promise<{ ok: boolean; error?: string }> {
  if (sidecarProcess && !sidecarProcess.killed) {
    ignoreSidecarExit = true;
    sidecarProcess.kill('SIGTERM');
    sidecarProcess = null;
  }
  killProcessOnSidecarPort();
  await new Promise((r) => setTimeout(r, 400));

  startSidecar();

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isSidecarAlive()) {
      setEngineStatus('ready');
      return { ok: true };
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  const msg = 'Sidecar did not become ready. Check that python3 can import fastapi/uvicorn.';
  setEngineStatus('error', msg);
  return { ok: false, error: msg };
}

async function ensureSidecarReady(timeoutMs = 20_000): Promise<{ ok: boolean; error?: string }> {
  if (await isSidecarAlive() && sidecarProcess && !sidecarProcess.killed) {
    setEngineStatus('ready');
    return { ok: true };
  }
  return bootSidecar(timeoutMs);
}

function broadcast(channel: string, ...args: any[]) {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(channel, ...args);
  });
}

function toCacheKey(modelId: string): string {
  return modelId.replaceAll('/', '__');
}

function modelDirFor(modelId: string): string {
  return join(homedir(), 'Documents/Canvas/Models', toCacheKey(modelId));
}

function modelsRootDir(): string {
  return join(homedir(), 'Documents/Canvas/Models');
}

function dirSizeBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir)) {
    const filePath = join(dir, name);
    try {
      const st = statSync(filePath);
      if (st.isDirectory()) total += dirSizeBytes(filePath);
      else total += st.size;
    } catch {
      // skip unreadable
    }
  }
  return total;
}

function getStudioResourcesSnapshot() {
  const modelsDir = modelsRootDir();
  if (!existsSync(modelsDir)) mkdirSync(modelsDir, { recursive: true });
  let diskFree = 0;
  let diskTotal = 0;
  try {
    const fsStats = statfsSync(modelsDir);
    diskFree = fsStats.bavail * fsStats.bsize;
    diskTotal = fsStats.blocks * fsStats.bsize;
  } catch {
    // leave zeros
  }
  return {
    ram_total: totalmem(),
    ram_free: freemem(),
    disk_total: diskTotal,
    disk_free: diskFree,
    models_dir: modelsDir,
  };
}

async function unloadFromSidecar(modelId: string): Promise<{ unloaded: boolean; reason?: string }> {
  const row = getDb().select().from(models).where(eq(models.id, modelId)).get();
  if (row?.type === '3d') {
    try {
      const res = await net.fetch(`${SIDECAR_URL}/api/3d/unload`, {
        method: 'POST',
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) return { unloaded: false, reason: `http-${res.status}` };
      const body = (await res.json()) as { unloaded?: boolean };
      return { unloaded: Boolean(body.unloaded), reason: undefined };
    } catch (e) {
      console.warn('unload 3d sidecar:', e);
      return { unloaded: false, reason: 'sidecar-unavailable' };
    }
  }
  const cacheKey = toCacheKey(modelId);
  try {
    const res = await net.fetch(`${SIDECAR_URL}/api/models/unload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId, cache_key: cacheKey }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      console.warn(`unload-model: sidecar returned ${res.status} for ${cacheKey}`);
      return { unloaded: false, reason: `http-${res.status}` };
    }
    const body = (await res.json()) as { unloaded?: boolean; reason?: string; loaded?: string[] };
    const loaded = body.loaded ?? [];
    const gone = !loaded.includes(cacheKey);
    return { unloaded: Boolean(body.unloaded) || gone, reason: body.reason };
  } catch (e) {
    console.warn(`unload-model: could not unload ${cacheKey} from sidecar memory:`, e);
    return { unloaded: false, reason: 'sidecar-unavailable' };
  }
}

const pickedMediaPaths = new Set<string>();

const AUDIO_EXTS = new Set([
  '.wav', '.mp3', '.flac', '.m4a', '.aac',
  '.ogg', '.oga', '.opus', '.webm',
  '.wma', '.aiff', '.aif', '.caf',
]);

const MEDIA_EXTS = new Set([
  '.mp4', '.mov', '.m4v', '.webm', '.mkv',
  '.png', '.jpg', '.jpeg', '.webp',
  ...AUDIO_EXTS,
]);

function audioLibraryDir(): string {
  return join(homedir(), 'Documents/Canvas/Generated/Audio');
}

function isAudioExtension(filePath: string): boolean {
  return AUDIO_EXTS.has(extname(filePath).toLowerCase());
}

function isInsideDir(filePath: string, dir: string): boolean {
  const file = resolve(filePath);
  const root = resolve(dir);
  return file === root || file.startsWith(root.endsWith(sep) ? root : root + sep);
}

function uniqueLibraryDest(fileName: string): string {
  const dir = audioLibraryDir();
  mkdirSync(dir, { recursive: true });
  const ext = extname(fileName).toLowerCase() || '.wav';
  const stem = basename(fileName, extname(fileName)).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'audio';
  let dest = join(dir, `${stem}${ext}`);
  let n = 2;
  while (existsSync(dest)) {
    dest = join(dir, `${stem}-${n}${ext}`);
    n += 1;
  }
  return dest;
}

const TRANSCODE_AUDIO_EXTS = new Set(['.ogg', '.oga', '.opus', '.wma', '.webm']);

function transcodeAudioToWav(src: string, dest: string): void {
  const result = spawnSync(
    ffmpegBin(),
    ['-y', '-i', src, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', dest],
    { encoding: 'utf8' },
  );
  if (result.status !== 0 || !existsSync(dest)) {
    throw new Error((result.stderr || result.stdout || 'ffmpeg could not convert this audio').slice(0, 400));
  }
}

function importAudioIntoLibrary(src: string): string | null {
  const resolved = resolve(src);
  if (!existsSync(resolved) || !statSync(resolved).isFile() || !isAudioExtension(resolved)) {
    return null;
  }
  const dir = audioLibraryDir();
  mkdirSync(dir, { recursive: true });
  const ext = extname(resolved).toLowerCase();
  const stem = basename(resolved, extname(resolved));
  const shouldWav = TRANSCODE_AUDIO_EXTS.has(ext);
  if (isInsideDir(resolved, dir) && !shouldWav) {
    return rememberPickedMedia(resolved);
  }
  if (shouldWav) {
    const dest = uniqueLibraryDest(`${stem}.wav`);
    try {
      transcodeAudioToWav(resolved, dest);
      if (isInsideDir(resolved, dir) && dest !== resolved) {
        try {
          unlinkSync(resolved);
        } catch {
          /* keep original copy if delete fails */
        }
        pickedMediaPaths.delete(resolved);
      }
      return rememberPickedMedia(dest);
    } catch {
      if (isInsideDir(resolved, dir)) return rememberPickedMedia(resolved);
      const copied = uniqueLibraryDest(basename(resolved));
      copyFileSync(resolved, copied);
      return rememberPickedMedia(copied);
    }
  }
  const dest = uniqueLibraryDest(basename(resolved));
  copyFileSync(resolved, dest);
  return rememberPickedMedia(dest);
}

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);

function pickedMediaStorePath(): string {
  return join(app.getPath('userData'), 'picked-media.json');
}

function loadPickedMedia(): void {
  try {
    const raw = JSON.parse(readFileSync(pickedMediaStorePath(), 'utf8')) as unknown;
    if (!Array.isArray(raw)) return;
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      const resolved = resolve(item);
      if (existsSync(resolved)) pickedMediaPaths.add(resolved);
    }
  } catch {
    /* first run */
  }
}

function persistPickedMedia(): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(pickedMediaStorePath(), JSON.stringify([...pickedMediaPaths].slice(-500)));
  } catch {
    /* ignore */
  }
}

function rememberPickedMedia(filePath: string | null): string | null {
  if (!filePath) return null;
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) return null;
  const ext = extname(resolved).toLowerCase();
  if (!MEDIA_EXTS.has(ext)) return null;
  if (!pickedMediaPaths.has(resolved)) {
    pickedMediaPaths.add(resolved);
    persistPickedMedia();
  }
  return resolved;
}

function isUnderDir(filePath: string, dir: string): boolean {
  const base = resolve(dir);
  return filePath === base || filePath.startsWith(`${base}/`);
}

function resolveAllowedVideoFile(sourcePath: string): string | null {
  const ext = extname(sourcePath).toLowerCase();
  if (!VIDEO_EXTS.has(ext)) return null;
  if (!sourcePath || !existsSync(sourcePath)) return null;
  const resolved = resolve(sourcePath);
  if (pickedMediaPaths.has(resolved)) return resolved;
  const allowed = [
    join(app.getPath('userData'), 'video-drafts'),
    join(homedir(), 'Library/Application Support/canvas/video-drafts'),
    join(homedir(), 'Documents/Canvas/Generated/Video'),
  ];
  const ok = allowed.some((dir) => isUnderDir(resolved, dir));
  return ok ? resolved : null;
}

function resolveAllowedMediaFile(sourcePath: string): string | null {
  if (!sourcePath) return null;
  const ext = extname(sourcePath).toLowerCase();
  if (!MEDIA_EXTS.has(ext)) return null;
  if (!existsSync(sourcePath)) return null;
  const resolved = resolve(sourcePath);
  if (pickedMediaPaths.has(resolved)) return resolved;
  if (isUnderDir(resolved, join(homedir(), 'Documents/Canvas'))) return resolved;
  if (isUnderDir(resolved, join(app.getPath('userData'), 'video-drafts'))) return resolved;
  if (isUnderDir(resolved, join(homedir(), 'Library/Application Support/canvas/video-drafts'))) return resolved;
  return resolveAllowedVideoFile(sourcePath);
}

function resolveAllowedMeshFile(sourcePath: string): string | null {
  const ext = extname(sourcePath).toLowerCase();
  if (ext !== '.glb' && ext !== '.obj') return null;
  if (!sourcePath || !existsSync(sourcePath)) return null;
  const allowed = [
    join(app.getPath('userData'), 'mesh-drafts'),
    join(homedir(), 'Library/Application Support/canvas/mesh-drafts'),
    join(homedir(), 'Documents/Canvas/Generated/3D'),
  ];
  const resolved = resolve(sourcePath);
  const ok = allowed.some((dir) => {
    const base = resolve(dir);
    return resolved === base || resolved.startsWith(`${base}/`);
  });
  return ok ? resolved : null;
}

function setupIpc() {
  loadPickedMedia();
  ipcMain.handle('get-models', async () => {
    const db = getDb();
    return db.select().from(models).all();
  });

  ipcMain.handle('get-studio-resources', async () => getStudioResourcesSnapshot());

  ipcMain.handle('get-model-disk-usage', async () => {
    const db = getDb();
    const rows = db.select().from(models).all();
    const usage: Record<string, number> = {};
    for (const row of rows) {
      usage[row.id] = dirSizeBytes(modelDirFor(row.id));
    }
    return usage;
  });

  ipcMain.handle('get-loaded-models', async () => {
    try {
      const res = await net.fetch(`${SIDECAR_URL}/api/models/loaded`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { loaded?: string[] };
      return body.loaded ?? [];
    } catch {
      return [];
    }
  });

  ipcMain.handle('get-engine-status', async () => {
    if (engineStatus !== 'ready' && (await isSidecarAlive())) {
      setEngineStatus('ready');
    }
    return { status: engineStatus, detail: engineDetail };
  });

  ipcMain.handle('unload-model', async (_, modelId: string) => {
    const result = await unloadFromSidecar(modelId);
    broadcast('models-updated');
    return result;
  });

  ipcMain.handle('get-active-model', async () => resolveActiveModelId());

  ipcMain.handle('set-active-model', async (_, modelId: string) => {
    const ready = listReadyModels('image');
    if (!ready.some((m) => m.id === modelId)) {
      throw new Error('Model is not installed');
    }
    putSettingValue(ACTIVE_MODEL_KEY, modelId);
    broadcast('models-updated');
    return true;
  });

  ipcMain.handle('get-active-3d-model', async () => resolveActive3dModelId());

  ipcMain.handle('set-active-3d-model', async (_, modelId: string) => {
    const ready = listReadyModels('3d');
    if (!ready.some((m) => m.id === modelId)) {
      throw new Error('Model is not installed');
    }
    putSettingValue(ACTIVE_3D_MODEL_KEY, modelId);
    broadcast('models-updated');
    return true;
  });

  ipcMain.handle('generate-image', async (_, payload: {
    prompt: string;
    format: string;
    style: string;
    model_id?: string;
    image_base64?: string;
    images_base64?: string[];
  }) => {
    const ready = await ensureSidecarReady();
    if (!ready.ok) {
      throw new Error(ready.error || 'Sidecar unavailable');
    }

    const modelId = payload.model_id || resolveActiveModelId();
    if (!modelId) {
      throw new Error('NO_MODEL');
    }

    const res = await net.fetch(`${SIDECAR_URL}/api/generate/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: payload.prompt,
        format: payload.format,
        style: payload.style,
        model_id: modelId,
        image_base64: payload.image_base64 || null,
        images_base64: payload.images_base64 || null,
      }),
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });

    const body = (await res.json().catch(() => ({}))) as {
      detail?: unknown;
      job_id?: string;
      file_path?: string | null;
    };
    if (!res.ok) {
      const detail = body.detail != null ? String(body.detail).slice(0, 400) : `HTTP ${res.status}`;
      throw new Error(detail);
    }
    return { job_id: body.job_id, file_path: body.file_path ?? null, model_id: modelId };
  });

  ipcMain.handle('assemble-video', async (_, payload: {
    image_paths: string[];
    durations: number[];
    width: number;
    height: number;
    output_name: string;
  }) => {
    const ready = await ensureSidecarReady();
    if (!ready.ok) {
      throw new Error(ready.error || 'Sidecar unavailable');
    }
    const res = await net.fetch(`${SIDECAR_URL}/api/video/assemble`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown; file_path?: string };
    if (!res.ok) {
      throw new Error(body.detail != null ? String(body.detail).slice(0, 400) : `HTTP ${res.status}`);
    }
    return { file_path: body.file_path as string };
  });

  ipcMain.handle('render-timeline', async (_, payload: {
    clips: Array<{
      kind: string;
      track: string;
      path: string | null;
      text: string | null;
      start_sec: number;
      duration_sec: number;
      source_in_sec: number;
    }>;
    width: number;
    height: number;
    fps: number;
  }) => {
    const ready = await ensureSidecarReady();
    if (!ready.ok) {
      throw new Error(ready.error || 'Sidecar unavailable');
    }
    const res = await net.fetch(`${SIDECAR_URL}/api/video/render-timeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown; file_path?: string };
    if (!res.ok) {
      throw new Error(body.detail != null ? String(body.detail).slice(0, 400) : `HTTP ${res.status}`);
    }
    return { file_path: body.file_path as string };
  });

  const videoHistoryPath = () => join(homedir(), 'Documents/Canvas/Generated/Video/idea-history.json');

  ipcMain.handle('load-video-history', async () => {
    const p = videoHistoryPath();
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  });

  ipcMain.handle('save-video-history', async (_, payload: unknown) => {
    const dir = join(homedir(), 'Documents/Canvas/Generated/Video');
    mkdirSync(dir, { recursive: true });
    writeFileSync(videoHistoryPath(), JSON.stringify(payload, null, 2), 'utf8');
    return true;
  });

  ipcMain.handle('list-generated-stills', async () => {
    const dir = join(homedir(), 'Documents/Canvas/Generated');
    if (!existsSync(dir)) return [];
    const rows: { path: string; mtime: number }[] = [];
    for (const name of readdirSync(dir)) {
      if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
      const path = join(dir, name);
      try {
        rows.push({ path, mtime: statSync(path).mtimeMs });
      } catch {
        /* skip */
      }
    }
    return rows.sort((a, b) => b.mtime - a.mtime).slice(0, 24);
  });

  ipcMain.handle('pick-video', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a screen recording',
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return rememberPickedMedia(result.filePaths[0]);
  });

  ipcMain.handle('probe-media-duration', async (_, filePath: string) => {
    if (!filePath || !existsSync(filePath)) return 0;
    return probeMediaDurationSec(filePath);
  });

  ipcMain.handle('remember-dropped-media', async (_, filePath: string) => {
    return rememberPickedMedia(filePath);
  });

  ipcMain.handle('pick-image', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a reference image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return rememberPickedMedia(result.filePaths[0]);
  });

  ipcMain.handle('pick-images', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose reference photos',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths.map((p) => rememberPickedMedia(p)).filter((p): p is string => Boolean(p));
  });

  ipcMain.handle('clean-screencast', async (_, payload: { input_path: string; prompt: string; dry_run?: boolean }) => {
    const ready = await ensureSidecarReady();
    if (!ready.ok) {
      throw new Error(ready.error || 'Sidecar unavailable');
    }
    const res = await net.fetch(`${SIDECAR_URL}/api/video/clean-screencast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      detail?: unknown;
      file_path?: string | null;
      plan?: unknown;
    };
    if (!res.ok) {
      throw new Error(body.detail != null ? String(body.detail).slice(0, 400) : `HTTP ${res.status}`);
    }
    return body;
  });

  ipcMain.handle('pick-audio', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose an audio file',
      properties: ['openFile', 'multiSelections'],
      filters: [{
        name: 'Audio',
        extensions: [...AUDIO_EXTS].map((ext) => ext.slice(1)),
      }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return rememberPickedMedia(result.filePaths[0]);
  });

  ipcMain.handle('import-library-audio', async (_, paths?: string[]) => {
    let files = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p.length > 0) : [];
    if (files.length === 0) {
      const result = await dialog.showOpenDialog({
        title: 'Add audio to library',
        properties: ['openFile', 'multiSelections'],
        filters: [{
          name: 'Audio',
          extensions: [...AUDIO_EXTS].map((ext) => ext.slice(1)),
        }],
      });
      if (result.canceled || result.filePaths.length === 0) return { imported: [] as string[] };
      files = result.filePaths;
    }
    const imported: string[] = [];
    for (const src of files) {
      const dest = importAudioIntoLibrary(src);
      if (dest) imported.push(dest);
    }
    return { imported };
  });

  ipcMain.handle('delete-library-audio', async (_, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath) {
      throw new Error('No file selected');
    }
    const resolved = resolve(filePath);
    if (!isInsideDir(resolved, audioLibraryDir()) || !isAudioExtension(resolved)) {
      throw new Error('Can only delete files from the audio library folder');
    }
    if (micOutPath && resolve(micOutPath) === resolved) {
      throw new Error('Stop recording before deleting this file');
    }
    if (existsSync(resolved)) unlinkSync(resolved);
    pickedMediaPaths.delete(resolved);
    persistPickedMedia();
    return { deleted: true };
  });

  ipcMain.handle('list-media-library', async () => {
    const audioDir = audioLibraryDir();
    const voicePath = join(homedir(), 'Documents/Canvas/Voice/speaker.wav');
    const audio: { path: string; name: string; mtime: number }[] = [];
    if (existsSync(audioDir)) {
      for (const name of readdirSync(audioDir)) {
        if (!isAudioExtension(name)) continue;
        let filePath = join(audioDir, name);
        if (TRANSCODE_AUDIO_EXTS.has(extname(name).toLowerCase())) {
          try {
            const converted = importAudioIntoLibrary(filePath);
            if (converted) filePath = converted;
          } catch {
            /* keep ogg entry; play will retry */
          }
        }
        try {
          audio.push({ path: filePath, name: basename(filePath), mtime: statSync(filePath).mtimeMs });
        } catch {
          // skip unreadable entries
        }
      }
      audio.sort((a, b) => b.mtime - a.mtime);
    }
    return {
      audio,
      voice_path: existsSync(voicePath) ? voicePath : null,
    };
  });

  ipcMain.handle('prepare-library-audio', async (_, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath) {
      throw new Error('No file selected');
    }
    const resolved = resolve(filePath);
    if (!isInsideDir(resolved, audioLibraryDir()) || !isAudioExtension(resolved)) {
      throw new Error('File is not in the audio library');
    }
    if (TRANSCODE_AUDIO_EXTS.has(extname(resolved).toLowerCase())) {
      const converted = importAudioIntoLibrary(resolved);
      if (!converted) throw new Error('Could not convert this audio for playback');
      return { path: converted, converted: converted !== resolved };
    }
    rememberPickedMedia(resolved);
    return { path: resolved, converted: false };
  });

  function findUvBin(): string | null {
    const candidates = ['/opt/homebrew/bin/uv', '/usr/local/bin/uv'];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    try {
      const found = execFileSync('which', ['uv'], { encoding: 'utf8' }).trim();
      return found || null;
    } catch {
      return null;
    }
  }

  ipcMain.handle('get-voice-engine-status', async () => voiceEngineStatusPayload());

  ipcMain.handle('install-voice-engine', async () => {
    if (voiceInstallJob.active) {
      throw new Error('Voice engine install is already running.');
    }
    voiceInstallJob.active = true;
    voiceInstallJob.stage = 'packages';
    voiceInstallJob.percent = 5;
    voiceInstallJob.detail = 'Installing Coqui TTS packages';
    broadcast('voice-engine-updated', voiceEngineStatusPayload());

    const sidecarDir = sidecarRootDir();
    const venvDir = join(sidecarDir, '.venv-tts');
    const venvPy = voiceVenvPython();
    const reqFile = join(sidecarDir, 'requirements-tts.txt');
    const uv = findUvBin();

    try {
      if (!uv) {
        throw new Error('Install uv first (brew install uv), then download XTTS in Studio → Voice.');
      }

      if (!existsSync(venvDir)) {
        const pyInstall = spawnSync(uv, ['python', 'install', '3.11'], {
          cwd: sidecarDir,
          encoding: 'utf8',
          timeout: 10 * 60 * 1000,
        });
        if (pyInstall.status !== 0 && !existsSync(venvPy)) {
          throw new Error((pyInstall.stderr || pyInstall.stdout || 'Could not install Python 3.11').slice(-400));
        }
        voiceInstallJob.percent = 12;
        voiceInstallJob.detail = 'Creating voice engine environment';
        broadcast('voice-engine-updated', voiceEngineStatusPayload());
        const venv = spawnSync(uv, ['venv', '--python', '3.11', '.venv-tts'], {
          cwd: sidecarDir,
          encoding: 'utf8',
          timeout: 2 * 60 * 1000,
        });
        if (venv.status !== 0) {
          throw new Error((venv.stderr || venv.stdout || 'Could not create voice engine environment').slice(-400));
        }
      }

      voiceInstallJob.percent = 18;
      voiceInstallJob.detail = voicePackagesReady()
        ? 'Checking voice engine'
        : existsSync(venvPy)
          ? 'Repairing voice engine dependencies'
          : 'Installing Coqui TTS (~1.7 GB packages)';
      broadcast('voice-engine-updated', voiceEngineStatusPayload());

      const pipArgs = existsSync(reqFile)
        ? ['pip', 'install', '-r', 'requirements-tts.txt', '-p', '.venv-tts']
        : ['pip', 'install', 'TTS==0.22.0', 'transformers>=4.33.0,<4.50.0', '-p', '.venv-tts'];
      const install = spawnSync(uv, pipArgs, {
        cwd: sidecarDir,
        encoding: 'utf8',
        timeout: 45 * 60 * 1000,
        maxBuffer: 16 * 1024 * 1024,
      });
      if (install.status !== 0) {
        throw new Error((install.stderr || install.stdout || 'Could not install Coqui TTS').slice(-500));
      }

      const verifyScript = voiceVerifyScript();
      const verify = spawnSync(venvPy, [verifyScript], {
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, COQUI_TOS_AGREED: '1' },
      });
      if (verify.status !== 0) {
        const detail = (verify.stderr || verify.stdout || 'Voice engine verification failed').trim();
        throw new Error(detail.slice(-500));
      }

      if (!voiceWeightsReady()) {
        await downloadXttsWeights();
      }

      voiceInstallJob.percent = 100;
      voiceInstallJob.stage = 'done';
      voiceInstallJob.detail = 'XTTS ready';
      broadcast('voice-engine-updated', voiceEngineStatusPayload());
      return { ok: true };
    } finally {
      voiceInstallJob.active = false;
      broadcast('voice-engine-updated', voiceEngineStatusPayload());
    }
  });

  ipcMain.handle('delete-voice-engine', async () => {
    if (voiceInstallJob.active) {
      throw new Error('Wait until the voice engine install finishes.');
    }
    const venvDir = join(sidecarRootDir(), '.venv-tts');
    if (existsSync(venvDir)) rmSync(venvDir, { recursive: true, force: true });
    if (existsSync(coquiTtsCacheDir())) rmSync(coquiTtsCacheDir(), { recursive: true, force: true });
    broadcast('voice-engine-updated', voiceEngineStatusPayload());
    return { deleted: true };
  });


  ipcMain.handle('start-mic-record', async (_, format: string = 'wav') => {
    if (micRecorder && !micRecorder.killed) {
      throw new Error('Already recording');
    }
    const ext = ['wav', 'mp3', 'flac'].includes(format) ? format : 'wav';
    const dir = join(homedir(), 'Documents/Canvas/Generated/Audio');
    mkdirSync(dir, { recursive: true });
    micOutPath = join(dir, `mic-${Date.now()}.${ext}`);
    const ffmpeg = ffmpegBin();
    micRecorder = spawn(ffmpeg, [
      '-y',
      '-f', 'avfoundation',
      '-i', ':0',
      '-ac', '1',
      '-ar', '48000',
      ...(ext === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '2'] : ext === 'flac' ? ['-c:a', 'flac'] : ['-c:a', 'pcm_s16le']),
      micOutPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    micRecorder.on('exit', () => {
      micRecorder = null;
    });
    return { file_path: micOutPath };
  });

  ipcMain.handle('stop-mic-record', async () => {
    const out = micOutPath;
    const proc = micRecorder;
    micRecorder = null;
    micOutPath = null;
    if (proc && !proc.killed) {
      proc.kill('SIGINT');
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    if (!out || !existsSync(out)) {
      throw new Error('Recording did not produce a file. Allow microphone access in System Settings.');
    }
    return { file_path: out };
  });

  ipcMain.handle('save-audio-buffer', async (_, payload: { data: ArrayBuffer; format: string; name?: string }) => {
    const dir = join(homedir(), 'Documents/Canvas/Generated/Audio');
    mkdirSync(dir, { recursive: true });
    const webm = join(dir, `capture-${Date.now()}.webm`);
    writeFileSync(webm, Buffer.from(payload.data));
    const fmt = payload.format || 'wav';
    const converted = await sidecarJson('/api/audio/convert', {
      input_path: webm,
      format: fmt,
      output_name: payload.name || `system-${Date.now()}`,
    });
    return { file_path: converted.file_path as string };
  });

  ipcMain.handle('get-voice-profile', async () => {
    const ready = await ensureSidecarReady();
    if (!ready.ok) {
      throw new Error(ready.error || 'Sidecar unavailable');
    }
    const res = await net.fetch(`${SIDECAR_URL}/api/audio/voice`, { signal: AbortSignal.timeout(5000) });
    return res.json();
  });

  ipcMain.handle('get-voice-tts-progress', async () => {
    const ready = await ensureSidecarReady();
    if (!ready.ok) {
      return { active: false, stage: 'idle', percent: 0, detail: '', elapsed_sec: 0, error: null };
    }
    const res = await net.fetch(`${SIDECAR_URL}/api/audio/tts/progress`, { signal: AbortSignal.timeout(3000) });
    return res.json();
  });

  ipcMain.handle('save-voice-sample', async (_, inputPath: string) => sidecarJson('/api/audio/voice', { input_path: inputPath }));

  ipcMain.handle('synthesize-voice', async (_, payload: { text: string; language?: string }) =>
    sidecarJson('/api/audio/tts', payload, 10 * 60 * 1000),
  );

  ipcMain.handle('apply-video-timeline', async (_, payload: {
    prompt: string;
    video_path?: string;
    audio_path?: string;
    dry_run?: boolean;
  }) => sidecarJson('/api/video/timeline', payload, 20 * 60 * 1000));

  ipcMain.handle('get-3d-status', async () => {
    const ready = await ensureSidecarReady();
    if (!ready.ok) {
      return { ready: false, detail: ready.error || 'Sidecar unavailable', weights_local: false };
    }
    const res = await net.fetch(`${SIDECAR_URL}/api/3d/status`, { signal: AbortSignal.timeout(5000) });
    return res.json();
  });

  ipcMain.handle('get-3d-progress', async () => {
    try {
      const res = await net.fetch(`${SIDECAR_URL}/api/3d/progress`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return { stage: 'idle', percent: 0, detail: '', device: '', engine: '', weights_cached: false };
      return res.json();
    } catch {
      return { stage: 'idle', percent: 0, detail: '', device: '', engine: '', weights_cached: false };
    }
  });

  ipcMain.handle('generate-mesh', async (_, payload: {
    image_path: string;
    model_id?: string;
    output_format?: 'glb' | 'obj';
    mc_resolution?: number;
    remove_background?: boolean;
  }) => {
    const sidecarReady = await ensureSidecarReady();
    if (!sidecarReady.ok) {
      throw new Error(sidecarReady.error || 'Sidecar unavailable');
    }
    const modelId = payload.model_id || resolveActive3dModelId() || 'tencent/Hunyuan3D-2mini';
    const res = await net.fetch(`${SIDECAR_URL}/api/3d/mesh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_path: payload.image_path,
        model_id: modelId,
        output_format: payload.output_format ?? 'glb',
        mc_resolution: payload.mc_resolution ?? 256,
        remove_background: payload.remove_background ?? true,
      }),
      signal: AbortSignal.timeout(40 * 60 * 1000),
    });
    const raw = await res.text();
    let body: {
      detail?: unknown;
      job_id?: string;
      file_path?: string | null;
      model_id?: string;
      format?: string;
    } = {};
    try {
      body = raw ? (JSON.parse(raw) as typeof body) : {};
    } catch {
      body = {};
    }
    if (!res.ok) {
      throw new Error(formatSidecarDetail(body.detail, res.status, raw));
    }
    return body;
  });

  ipcMain.handle('open-path', async (_, filePath: string) => {
    await shell.openPath(filePath);
    return true;
  });

  ipcMain.handle('save-mesh-as', async (_, sourcePath: string) => {
    const resolved = resolveAllowedMeshFile(sourcePath);
    if (!resolved) {
      throw new Error('No mesh draft to save');
    }
    const ext = extname(resolved).replace('.', '').toLowerCase() || 'glb';
    const result = await dialog.showSaveDialog({
      title: 'Save mesh',
      defaultPath: `mesh.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (result.canceled || !result.filePath) return null;
    copyFileSync(resolved, result.filePath);
    return result.filePath;
  });

  ipcMain.handle('save-video-as', async (_, sourcePath: string) => {
    const resolved = resolveAllowedVideoFile(sourcePath);
    if (!resolved) {
      throw new Error('No video draft to save');
    }
    const result = await dialog.showSaveDialog({
      title: 'Save video',
      defaultPath: 'video.mp4',
      filters: [{ name: 'MP4', extensions: ['mp4'] }],
    });
    if (result.canceled || !result.filePath) return null;
    copyFileSync(resolved, result.filePath);
    return result.filePath;
  });

  ipcMain.handle('discard-video-draft', async (_, sourcePath: string) => {
    const resolved = resolveAllowedVideoFile(sourcePath);
    if (!resolved) return false;
    unlinkSync(resolved);
    return true;
  });

  ipcMain.handle('read-mesh-file', async (_, sourcePath: string) => {
    const resolved = resolveAllowedMeshFile(sourcePath);
    if (!resolved) throw new Error('Mesh file is not available to preview');
    const buf = readFileSync(resolved);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  ipcMain.handle('read-video-draft', async (_, sourcePath: string) => {
    const resolved = resolveAllowedVideoFile(sourcePath);
    if (!resolved) throw new Error('Video file is not available to preview');
    const buf = readFileSync(resolved);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  ipcMain.handle('read-media-file', async (_, sourcePath: string) => {
    const remembered = rememberPickedMedia(sourcePath);
    const resolved = remembered ?? resolveAllowedMediaFile(sourcePath);
    if (!resolved) throw new Error('Media file is not available to preview');
    const buf = readFileSync(resolved);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  ipcMain.handle('ensure-video-preview', async (_, sourcePath: string, force?: boolean) => {
    const remembered = rememberPickedMedia(sourcePath);
    const resolved = remembered ?? resolveAllowedMediaFile(sourcePath);
    if (!resolved) throw new Error('Video is not available to preview');
    return ensureH264Preview(resolved, Boolean(force));
  });

  ipcMain.handle('discard-mesh-draft', async (_, sourcePath: string) => {
    const resolved = resolveAllowedMeshFile(sourcePath);
    if (!resolved) return false;
    unlinkSync(resolved);
    return true;
  });

  ipcMain.handle('add-model', async (_, model) => {
    // We keep this for adding custom local models manually if needed
    const db = getDb();
    db.insert(models).values({
      id: model.id,
      name: model.name,
      type: model.type,
      status: 'ready',
      createdAt: new Date(),
    }).run();
    return true;
  });

  ipcMain.handle('download-model', async (_, model) => {
    const db = getDb();
    
    return setupDownload(db, model);
  });
  ipcMain.handle('retry-download', async (_, model) => {
    // Stop an in-flight download so we do not run two download.py on one folder.
    killDownload(model.id);
    const db = getDb();
    // Keep any partial download: huggingface_hub resumes .incomplete files,
    // so retrying continues from where the previous attempt stopped.
    db.delete(models).where(eq(models.id, model.id)).run();
    return setupDownload(db, model);
  });

  ipcMain.handle('delete-model', async (_, modelId: string) => {
    const db = getDb();
    db.delete(models).where(eq(models.id, modelId)).run();

    // Kill an in-flight download, then unload RAM, then delete files.
    killDownload(modelId);

    await unloadFromSidecar(modelId);

    const fs = require('fs');
    const modelDir = modelDirFor(modelId);
    if (fs.existsSync(modelDir)) {
      fs.rmSync(modelDir, { recursive: true, force: true });
    }

    if (getSettingValue(ACTIVE_MODEL_KEY) === modelId) {
      const next = listReadyModels('image')[0];
      if (next) putSettingValue(ACTIVE_MODEL_KEY, next.id);
      else getDb().delete(settings).where(eq(settings.key, ACTIVE_MODEL_KEY)).run();
    }
    if (getSettingValue(ACTIVE_3D_MODEL_KEY) === modelId) {
      const next3d = listReadyModels('3d')[0];
      if (next3d) putSettingValue(ACTIVE_3D_MODEL_KEY, next3d.id);
      else getDb().delete(settings).where(eq(settings.key, ACTIVE_3D_MODEL_KEY)).run();
    }

    broadcast('models-updated');
    return true;
  });

  ipcMain.handle('get-setting', async (_, key: string) => {
    const db = getDb();
    // Assuming settings is imported from schema
    const result = db.select().from(settings).where(eq(settings.key, key)).get();
    return result ? result.value : null;
  });

  ipcMain.handle('set-setting', async (_, key: string, value: string) => {
    const db = getDb();
    db.insert(settings).values({ key, value }).onConflictDoUpdate({
      target: settings.key,
      set: { value }
    }).run();
    return true;
  });
}

function setupDownload(db: ReturnType<typeof getDb>, model: any): boolean {
    // Save as downloading
    db.insert(models).values({
      id: model.id,
      name: model.name,
      type: model.type,
      status: 'downloading',
      createdAt: new Date(),
    }).onConflictDoUpdate({
      target: models.id,
      set: { status: 'downloading' }
    }).run();

    broadcast('models-updated');

    const downloadScript = join(__dirname, '../../sidecar/download.py');
    const tokenRecord = db.select().from(settings).where(eq(settings.key, 'HF_TOKEN')).get();
    const args = [downloadScript, model.id];

    // Pass the token via environment instead of argv so it does not show up
    // in the process list.
    const dlProcess = spawn('python3', args, {
      env: tokenRecord && tokenRecord.value
        ? { ...process.env, HF_TOKEN: tokenRecord.value }
        : process.env,
    });

    // Keep the process handle so delete/retry can kill it instead of leaking orphans.
    activeDownloads.set(model.id, dlProcess);

    let finalPath = '';
    let sidecarError = '';

    dlProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Download] ${output}`);
      if (output.includes('DONE:')) {
        finalPath = output.split('DONE:')[1].trim();
      } else if (output.includes('ERROR:')) {
        // The sidecar prints the real error here; stderr only has tqdm bars.
        sidecarError = output.split('ERROR:')[1].trim();
      } else if (output.includes('PROGRESS:')) {
        const line = output.split('PROGRESS:')[1]?.trim().split('\n')[0] ?? '';
        const parts = line.split(':');
        const percent = parseInt(parts[0] ?? '', 10);
        const downloadedBytes = parseInt(parts[1] ?? '', 10);
        const totalBytes = parseInt(parts[2] ?? '', 10);
        if (!Number.isNaN(percent)) {
          broadcast('download-progress', {
            modelId: model.id,
            percent,
            downloadedBytes: Number.isNaN(downloadedBytes) ? 0 : downloadedBytes,
            totalBytes: Number.isNaN(totalBytes) ? 0 : totalBytes,
          });
        }
      }
    });

    dlProcess.stderr.on('data', (data) => {
      // tqdm progress bars — log only. Real progress is reported by the sidecar
      // as byte-based PROGRESS lines on stdout (file-count % is misleading).
      console.log(`[Download stderr] ${data}`);
    });

    dlProcess.on('close', (code) => {
      // Finished (success, error, or killed) — drop the handle.
      activeDownloads.delete(model.id);

      if (code === 0 && finalPath) {
        db.update(models)
          .set({ status: 'ready', path: finalPath, errorMessage: null })
          .where(eq(models.id, model.id))
          .run();
        if (model.type === 'image' && !getSettingValue(ACTIVE_MODEL_KEY)) {
          putSettingValue(ACTIVE_MODEL_KEY, model.id);
        }
      } else {
        const errorMsg = sidecarError || `Download failed with exit code ${code}`;
        db.update(models)
          .set({ status: 'error', errorMessage: errorMsg })
          .where(eq(models.id, model.id))
          .run();
        console.error(`Model ${model.id} failed to download: ${errorMsg}`);
        // Keep the partial download on disk: huggingface_hub resumes .incomplete
        // files, so a retry continues from where it stopped instead of starting over.
      }
      broadcast('models-updated');
    });

    return true;
}

// Register custom protocol for local assets
protocol.registerSchemesAsPrivileged([
  { scheme: 'asset', privileges: { bypassCSP: true, supportFetchAPI: true, secure: true, stream: true } },
]);

const ASSET_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.caf': 'audio/x-caf',
};

function assetPathFromUrl(url: string): string {
  const stripped = url.replace(/^asset:\/\//, '').split('?')[0];
  const decoded = decodeURIComponent(stripped);
  return decoded.startsWith('/') ? decoded : `/${decoded}`;
}

function serveAssetFile(request: Request): Response {
  const filePath = assetPathFromUrl(request.url);
  if (!existsSync(filePath)) {
    return new Response('Not found', { status: 404 });
  }

  const stat = statSync(filePath);
  const fileSize = stat.size;
  const contentType = ASSET_MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const range = request.headers.get('Range');

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
    if (!match) {
      return new Response('Invalid range', { status: 416 });
    }
    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start >= fileSize || end >= fileSize || start > end) {
      return new Response('Range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${fileSize}` },
      });
    }
    const chunkSize = end - start + 1;
    const stream = createReadStream(filePath, { start, end });
    return new Response(stream as unknown as BodyInit, {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(chunkSize),
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
      },
    });
  }

  const stream = createReadStream(filePath);
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(fileSize),
      'Accept-Ranges': 'bytes',
    },
  });
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'AI Creative Workstation',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.aicreativeworkstation.app');

  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      const source = sources[0];
      if (!source) {
        callback({});
        return;
      }
      callback({ video: source, audio: 'loopback' });
    }).catch(() => callback({}));
  });

  // Local files for images and video preview (video needs byte-range + stream privilege).
  protocol.handle('asset', (request) => serveAssetFile(request));

  initDb();
  setupIpc();

  void bootSidecar();

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  engineStatus = 'stopped';
  // Kill leftover download.py so they do not survive as orphans after quit.
  for (const [modelId, proc] of Array.from(activeDownloads.entries())) {
    if (proc && !proc.killed) proc.kill('SIGTERM');
    activeDownloads.delete(modelId);
  }
  if (micRecorder && !micRecorder.killed) {
    micRecorder.kill('SIGINT');
    micRecorder = null;
  }
  if (sidecarProcess) {
    sidecarProcess.kill();
    sidecarProcess = null;
  }
});


