import { app, shell, BrowserWindow, ipcMain, protocol, net } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
// import icon from '../../resources/icon.png?asset'

import { spawn, ChildProcess } from 'child_process';

// Prevent EPIPE crashes from console.log when stdout is closed
process.on('uncaughtException', (err) => {
  if (err.message.includes('EPIPE')) {
    // Ignore EPIPE errors
    return;
  }
  console.error('Uncaught Exception:', err);
});

import { initDb, getDb } from './db';
import { models, settings } from './db/schema';
import { eq } from 'drizzle-orm';

const SIDECAR_URL = 'http://127.0.0.1:57291';
const SIDECAR_PORT = 57291;
const ACTIVE_MODEL_KEY = 'active_model_id';
let sidecarProcess: ChildProcess | null = null;
let engineStatus: 'stopped' | 'starting' | 'ready' | 'error' = 'stopped';
let engineDetail = '';
let ignoreSidecarExit = false;

// Реестр активных процессов скачивания по model.id. Раньше dlProcess жил только
// внутри setupDownload как локальная переменная: при удалении модели / перезапуске
// приложения дочерний python (download.py) умирал в сироты (PPID=1) и продолжал
// держать RAM (3-4GB) и качать — отсюда своп и дублирующиеся загрузки.
const activeDownloads: Map<string, ChildProcess> = new Map();

// Гарантированно завершает процесс скачивания для модели (если он запущен).
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

function listReadyModels(): { id: string; name: string }[] {
  const db = getDb();
  return db
    .select()
    .from(models)
    .all()
    .filter((m) => m.status === 'ready')
    .map((m) => ({ id: m.id, name: m.name }));
}

function resolveActiveModelId(): string | null {
  const ready = listReadyModels();
  if (ready.length === 0) return null;
  const stored = getSettingValue(ACTIVE_MODEL_KEY);
  if (stored && ready.some((m) => m.id === stored)) return stored;
  putSettingValue(ACTIVE_MODEL_KEY, ready[0].id);
  return ready[0].id;
}

function startSidecar(): void {
  const sidecarDir = join(__dirname, '../../sidecar');
  const sidecarPath = join(sidecarDir, 'main.py');
  console.log('Starting Python Sidecar:', sidecarPath);
  setEngineStatus('starting');

  sidecarProcess = spawn('python3', ['-u', sidecarPath], {
    cwd: sidecarDir,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
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
  const os = require('os');
  return join(os.homedir(), 'Documents/Canvas/Models', toCacheKey(modelId));
}

async function unloadFromSidecar(modelId: string): Promise<{ unloaded: boolean; reason?: string }> {
  const cacheKey = toCacheKey(modelId);
  try {
    const res = await net.fetch(
      `${SIDECAR_URL}/api/models/${encodeURIComponent(cacheKey)}/unload`,
      { method: 'POST', signal: AbortSignal.timeout(120_000) },
    );
    if (!res.ok) {
      console.warn(`unload-model: sidecar returned ${res.status} for ${cacheKey}`);
      return { unloaded: false, reason: `http-${res.status}` };
    }
    const body = (await res.json()) as { unloaded?: boolean; reason?: string };
    return { unloaded: Boolean(body.unloaded), reason: body.reason };
  } catch (e) {
    console.warn(`unload-model: could not unload ${cacheKey} from sidecar memory:`, e);
    return { unloaded: false, reason: 'sidecar-unavailable' };
  }
}

function setupIpc() {
  ipcMain.handle('get-models', async () => {
    const db = getDb();
    return db.select().from(models).all();
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

  ipcMain.handle('get-active-model', async () => resolveActiveModelId());

  ipcMain.handle('set-active-model', async (_, modelId: string) => {
    const ready = listReadyModels();
    if (!ready.some((m) => m.id === modelId)) {
      throw new Error('Model is not installed');
    }
    putSettingValue(ACTIVE_MODEL_KEY, modelId);
    broadcast('models-updated');
    return true;
  });

  ipcMain.handle('generate-image', async (_, payload: { prompt: string; format: string; style: string; model_id?: string; image_base64?: string }) => {
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
    // Убиваем возможный незавершённый процесс скачивания той же модели,
    // иначе получим два download.py на одну папку (дубликат в RAM/диске).
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

    // Убиваем активный процесс скачивания (если качается) — иначе он станет
    // сиротой, зависнет в RAM и продолжит писать файлы удалённой модели.
    killDownload(modelId);

    // Сначала выгружаем из ОЗУ, потом стираем файлы на SSD.
    await unloadFromSidecar(modelId);

    const fs = require('fs');
    const modelDir = modelDirFor(modelId);
    if (fs.existsSync(modelDir)) {
      fs.rmSync(modelDir, { recursive: true, force: true });
    }

    if (getSettingValue(ACTIVE_MODEL_KEY) === modelId) {
      const next = listReadyModels()[0];
      if (next) putSettingValue(ACTIVE_MODEL_KEY, next.id);
      else getDb().delete(settings).where(eq(settings.key, ACTIVE_MODEL_KEY)).run();
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

    // Держим handle процесса, чтобы delete-model/retry-download могли его убить,
    // а не ждать, пока python уйдёт в сироты и зависнет в RAM со свопом.
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
        // Byte-based progress reported by the sidecar.
        const percent = parseInt(output.split('PROGRESS:')[1].trim(), 10);
        if (!Number.isNaN(percent)) {
          broadcast('download-progress', { modelId: model.id, percent });
        }
      }
    });

    dlProcess.stderr.on('data', (data) => {
      // tqdm progress bars — log only. Real progress is reported by the sidecar
      // as byte-based PROGRESS lines on stdout (file-count % is misleading).
      console.log(`[Download stderr] ${data}`);
    });

    dlProcess.on('close', (code) => {
      // Процесс завершился (естественно или через killDownload) — убираем из реестра.
      activeDownloads.delete(model.id);

      if (code === 0 && finalPath) {
        db.update(models)
          .set({ status: 'ready', path: finalPath, errorMessage: null })
          .where(eq(models.id, model.id))
          .run();
        if (!getSettingValue(ACTIVE_MODEL_KEY)) {
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
  { scheme: 'asset', privileges: { bypassCSP: true, supportFetchAPI: true, secure: true } }
]);

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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
  electronApp.setAppUserModelId('com.canvas.app');

  // Handle custom asset:// protocol to load generated images
  protocol.handle('asset', (request) => {
    const url = request.url.slice('asset://'.length);
    const decodedPath = decodeURIComponent(url);
    // On Mac/Unix absolute paths start with /
    const absolutePath = decodedPath.startsWith('/') ? decodedPath : `/${decodedPath}`;
    return net.fetch(`file://${absolutePath}`);
  });

  initDb();
  setupIpc();

  // Не блокируем создание окна: sidecar стартует в фоне, readiness проверяется поллингом.
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
  // Убиваем все незавершённые процессы скачивания — иначе python download.py
  // переживут приложение как сироты (PPID=1) и будут держать RAM + качать впустую.
  for (const [modelId, proc] of Array.from(activeDownloads.entries())) {
    if (proc && !proc.killed) proc.kill('SIGTERM');
    activeDownloads.delete(modelId);
  }
  if (sidecarProcess) {
    sidecarProcess.kill();
    sidecarProcess = null;
  }
});


