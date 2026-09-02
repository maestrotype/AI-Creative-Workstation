import type { IpcMain } from 'electron';
import { net } from 'electron';
import { ChildProcess, spawn, spawnSync } from 'child_process';

export const DEFAULT_LLM_MODEL = 'qwen2.5:7b';
const OLLAMA_TAGS_URL = 'http://127.0.0.1:11434/api/tags';

export interface OllamaEngineStatus {
  binary_found: boolean;
  server_running: boolean;
  model_ready: boolean;
  installing: boolean;
  stage: string;
  percent: number;
  detail: string;
  model: string;
  started_by_app: boolean;
}

type BroadcastFn = (channel: string, ...args: unknown[]) => void;

const ollamaInstallJob = {
  active: false,
  stage: 'idle',
  percent: 0,
  detail: '',
};

let ollamaServeProc: ChildProcess | null = null;
let ollamaStartedByApp = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ollamaBin(): string | null {
  try {
    const path = spawnSync('which', ['ollama'], { encoding: 'utf8' }).stdout.trim();
    return path || null;
  } catch {
    return null;
  }
}

function brewBin(): string | null {
  try {
    const path = spawnSync('which', ['brew'], { encoding: 'utf8' }).stdout.trim();
    return path || null;
  } catch {
    return null;
  }
}

async function ollamaServerRunning(): Promise<boolean> {
  try {
    const res = await net.fetch(OLLAMA_TAGS_URL, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ollamaModelPulled(model: string): Promise<boolean> {
  try {
    const res = await net.fetch(OLLAMA_TAGS_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { models?: Array<{ name?: string }> };
    return (body.models ?? []).some((entry) => {
      const name = entry.name ?? '';
      return name === model || name.startsWith(`${model}:`);
    });
  } catch {
    return false;
  }
}

function broadcastStatus(broadcast: BroadcastFn): void {
  void ollamaEngineStatusPayload().then((payload) => {
    broadcast('ollama-engine-updated', payload);
  });
}

export async function ollamaEngineStatusPayload(): Promise<OllamaEngineStatus> {
  const binary = Boolean(ollamaBin());
  const server = binary ? await ollamaServerRunning() : false;
  const model = server ? await ollamaModelPulled(DEFAULT_LLM_MODEL) : false;
  return {
    binary_found: binary,
    server_running: server,
    model_ready: model,
    installing: ollamaInstallJob.active,
    stage: ollamaInstallJob.stage,
    percent: ollamaInstallJob.percent,
    detail: ollamaInstallJob.detail,
    model: DEFAULT_LLM_MODEL,
    started_by_app: ollamaStartedByApp,
  };
}

function parseOllamaPullLine(line: string, broadcast: BroadcastFn): void {
  const pct = line.match(/(\d+)%/);
  if (pct) {
    ollamaInstallJob.percent = Math.min(99, Number(pct[1]));
    broadcastStatus(broadcast);
    return;
  }
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('\u001b')) {
    ollamaInstallJob.detail = trimmed.slice(-200);
    broadcastStatus(broadcast);
  }
}

async function ensureOllamaServe(broadcast: BroadcastFn): Promise<void> {
  if (await ollamaServerRunning()) return;
  const bin = ollamaBin();
  if (!bin) throw new Error('Ollama is not installed.');

  ollamaInstallJob.stage = 'serve';
  ollamaInstallJob.detail = 'Starting Ollama server';
  broadcastStatus(broadcast);

  ollamaServeProc = spawn(bin, ['serve'], {
    stdio: 'ignore',
    detached: false,
    env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' },
  });
  ollamaStartedByApp = true;
  ollamaServeProc.on('exit', () => {
    ollamaServeProc = null;
    ollamaStartedByApp = false;
  });

  for (let i = 0; i < 45; i += 1) {
    if (await ollamaServerRunning()) return;
    await sleep(1000);
  }
  throw new Error('Ollama server did not start in time.');
}

async function installOllamaBinary(broadcast: BroadcastFn): Promise<void> {
  if (ollamaBin()) return;
  const brew = brewBin();
  if (!brew) {
    throw new Error('Install Homebrew first (brew.sh), then download the LLM in Studio → Script.');
  }
  ollamaInstallJob.stage = 'brew';
  ollamaInstallJob.percent = 5;
  ollamaInstallJob.detail = 'Installing Ollama via Homebrew (~200 MB app)';
  broadcastStatus(broadcast);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(brew, ['install', 'ollama'], { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) ollamaInstallJob.detail = text.slice(-200);
      broadcastStatus(broadcast);
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) ollamaInstallJob.detail = text.slice(-200);
      broadcastStatus(broadcast);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 && ollamaBin()) resolve();
      else reject(new Error(ollamaInstallJob.detail || 'Could not install Ollama via Homebrew.'));
    });
  });
}

async function pullOllamaModel(broadcast: BroadcastFn): Promise<void> {
  const bin = ollamaBin();
  if (!bin) throw new Error('Ollama is not installed.');
  ollamaInstallJob.stage = 'pull';
  ollamaInstallJob.percent = Math.max(ollamaInstallJob.percent, 10);
  ollamaInstallJob.detail = `Downloading ${DEFAULT_LLM_MODEL} (~4.7 GB)`;
  broadcastStatus(broadcast);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(bin, ['pull', DEFAULT_LLM_MODEL], { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) parseOllamaPullLine(line, broadcast);
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) parseOllamaPullLine(line, broadcast);
    });
    proc.on('error', reject);
    proc.on('close', async (code) => {
      if (code === 0 && await ollamaModelPulled(DEFAULT_LLM_MODEL)) resolve();
      else reject(new Error(ollamaInstallJob.detail || `Could not pull ${DEFAULT_LLM_MODEL}.`));
    });
  });
}

export function stopOllamaIfStartedByApp(): void {
  if (ollamaStartedByApp && ollamaServeProc && !ollamaServeProc.killed) {
    ollamaServeProc.kill('SIGTERM');
  }
  ollamaServeProc = null;
  ollamaStartedByApp = false;
}

/** Start Ollama server before script generation when the model is already on disk. */
export async function prepareOllamaForScript(broadcast: BroadcastFn): Promise<void> {
  const status = await ollamaEngineStatusPayload();
  if (!status.model_ready || status.server_running) return;
  await ensureOllamaServe(broadcast);
}

export function registerOllamaIpc(ipcMain: IpcMain, broadcast: BroadcastFn): void {
  ipcMain.handle('get-ollama-engine-status', async () => ollamaEngineStatusPayload());

  ipcMain.handle('start-ollama-serve', async () => {
    if (ollamaInstallJob.active) throw new Error('Wait until the LLM install finishes.');
    await ensureOllamaServe(broadcast);
    broadcastStatus(broadcast);
    return { ok: true };
  });

  ipcMain.handle('install-ollama-engine', async () => {
    if (ollamaInstallJob.active) throw new Error('LLM install is already running.');
    ollamaInstallJob.active = true;
    ollamaInstallJob.stage = 'prepare';
    ollamaInstallJob.percent = 2;
    ollamaInstallJob.detail = 'Preparing script model';
    broadcastStatus(broadcast);

    try {
      await installOllamaBinary(broadcast);
      await ensureOllamaServe(broadcast);
      if (!(await ollamaModelPulled(DEFAULT_LLM_MODEL))) {
        await pullOllamaModel(broadcast);
      }
      ollamaInstallJob.percent = 100;
      ollamaInstallJob.stage = 'done';
      ollamaInstallJob.detail = `${DEFAULT_LLM_MODEL} ready`;
      broadcastStatus(broadcast);
      return { ok: true };
    } finally {
      ollamaInstallJob.active = false;
      broadcastStatus(broadcast);
    }
  });

  ipcMain.handle('delete-ollama-model', async () => {
    if (ollamaInstallJob.active) throw new Error('Wait until the LLM install finishes.');
    const bin = ollamaBin();
    if (!bin) return { deleted: false };
    if (!(await ollamaServerRunning())) {
      await ensureOllamaServe(broadcast);
    }
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bin, ['rm', DEFAULT_LLM_MODEL], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      proc.stderr?.on('data', (chunk: Buffer) => { err += chunk.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(err.trim() || `Could not remove ${DEFAULT_LLM_MODEL}.`));
      });
    });
    broadcastStatus(broadcast);
    return { deleted: true };
  });
}
