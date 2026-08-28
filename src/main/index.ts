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
let sidecarProcess: ChildProcess | null = null;

async function isSidecarAlive(): Promise<boolean> {
  try {
    const res = await net.fetch(`${SIDECAR_URL}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function startSidecar(): Promise<void> {
  // Если живой sidecar уже слушает порт (например, сирота после прошлого запуска) —
  // не спавним новый процесс, а используем существующий.
  if (await isSidecarAlive()) {
    console.warn('Sidecar already running on port 57291 — reusing the existing process.');
    return;
  }

  const sidecarPath = join(__dirname, '../../sidecar/main.py');
  console.log('Starting Python Sidecar:', sidecarPath);

  sidecarProcess = spawn('python3', [sidecarPath], {
    stdio: 'inherit'
  });

  sidecarProcess.on('error', (err) => {
    console.error('Failed to start sidecar:', err);
  });

  sidecarProcess.on('exit', (code) => {
    console.error(`Sidecar exited with code ${code}`);
  });

  // Импорты torch/diffusers занимают 10-30 c — поллим /health, пока sidecar не готов.
  // До этого момента запросы на генерацию будут получать честную ошибку "движок недоступен".
  const startedAt = Date.now();
  const poll = setInterval(async () => {
    if (await isSidecarAlive()) {
      clearInterval(poll);
      console.log(`Sidecar ready in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    } else if (Date.now() - startedAt > 120_000) {
      clearInterval(poll);
      console.error('Sidecar failed to become ready within 120s — check the logs above.');
    }
  }, 1000);
}

function broadcast(channel: string, ...args: any[]) {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(channel, ...args);
  });
}

function setupIpc() {
  ipcMain.handle('get-models', async () => {
    const db = getDb();
    return db.select().from(models).all();
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
    const db = getDb();
    // Keep any partial download: huggingface_hub resumes .incomplete files,
    // so retrying continues from where the previous attempt stopped.
    db.delete(models).where(eq(models.id, model.id)).run();
    return setupDownload(db, model);
  });

  ipcMain.handle('delete-model', async (_, modelId: string) => {
    const db = getDb();
    db.delete(models).where(eq(models.id, modelId)).run();
    
    // Удаляем физические файлы модели
    const fs = require('fs');
    const os = require('os');
    const modelDir = join(os.homedir(), 'Documents/Canvas/Models', modelId.replace('/', '__'));
    if (fs.existsSync(modelDir)) {
      fs.rmSync(modelDir, { recursive: true, force: true });
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
      if (code === 0 && finalPath) {
        db.update(models)
          .set({ status: 'ready', path: finalPath, errorMessage: null })
          .where(eq(models.id, model.id))
          .run();
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
  void startSidecar();

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
  if (sidecarProcess) {
    sidecarProcess.kill();
  }
});


