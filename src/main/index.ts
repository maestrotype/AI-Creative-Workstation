import { app, shell, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
// import icon from '../../resources/icon.png?asset'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    // icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
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

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

import { spawn, ChildProcess } from 'child_process';

let sidecarProcess: ChildProcess | null = null;

function startSidecar() {
  const sidecarPath = join(__dirname, '../../sidecar/main.py');
  console.log('Starting Python Sidecar:', sidecarPath);
  
  sidecarProcess = spawn('python3', [sidecarPath], {
    stdio: 'inherit'
  });

  sidecarProcess.on('error', (err) => {
    console.error('Failed to start sidecar:', err);
  });
}

import { initDb, getDb } from './db';
import { models } from './db/schema';
import { eq } from 'drizzle-orm';

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
    
    // 1. Save as downloading
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

    // Notify UI immediately so it shows 'downloading'
    broadcast('models-updated');

    // 2. Spawn Python downloader
    const downloadScript = join(__dirname, '../../sidecar/download.py');
    const dlProcess = spawn('python3', [downloadScript, model.id]);

    let finalPath = '';

    dlProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Download] ${output}`);
      if (output.includes('DONE:')) {
        finalPath = output.split('DONE:')[1].trim();
      }
    });

    dlProcess.stderr.on('data', (data) => {
      console.error(`[Download Error] ${data.toString()}`);
    });

    dlProcess.on('close', (code) => {
      if (code === 0 && finalPath) {
        db.update(models)
          .set({ status: 'ready', path: finalPath })
          .where(eq(models.id, model.id))
          .run();
        console.log(`Model ${model.id} marked as ready.`);
      } else {
        db.update(models)
          .set({ status: 'error' })
          .where(eq(models.id, model.id))
          .run();
        console.error(`Model ${model.id} failed to download.`);
      }
      broadcast('models-updated');
    });

    return true;
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.canvas.app');

  // Initialize SQLite database
  initDb();
  setupIpc();

  startSidecar();

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
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

