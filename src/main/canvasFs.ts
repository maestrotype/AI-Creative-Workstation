/**
 * Canvas data prefers ~/Documents/Canvas. On macOS the Electron app may be denied
 * that folder (TCC). The user can pick the folder once; the path is remembered in
 * userData. Until then Generated falls back to userData/Canvas.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

let resolvedRoot: string | null = null;
let userDataCanvas: string | null = null;
let overrideRoot: string | null = null;

function overrideFile(): string | null {
  if (!userDataCanvas) return null;
  return join(userDataCanvas, 'canvas-root.json');
}

function loadOverride(): string | null {
  const file = overrideFile();
  if (!file || !existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { path?: string };
    const path = (parsed.path || '').trim();
    return path && existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

export function setCanvasUserDataRoot(dir: string): void {
  userDataCanvas = dir;
  mkdirSync(dir, { recursive: true });
  overrideRoot = loadOverride();
  resolvedRoot = null;
}

export function documentsCanvasRoot(): string {
  return join(homedir(), 'Documents/Canvas');
}

export function rememberCanvasRoot(path: string): string {
  const root = path.trim();
  if (!root) throw new Error('Папка не выбрана');
  mkdirSync(root, { recursive: true });
  const file = overrideFile();
  if (file) {
    writeFileSync(file, JSON.stringify({ path: root }, null, 2));
  }
  overrideRoot = root;
  resolvedRoot = root;
  return root;
}

export function clearCanvasRootOverride(): void {
  const file = overrideFile();
  if (file && existsSync(file)) unlinkSync(file);
  overrideRoot = null;
  resolvedRoot = null;
}

function probeWritable(dir: string): boolean {
  const probe = join(dir, '.acw-write-test');
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(probe, 'ok');
    unlinkSync(probe);
    return true;
  } catch {
    try {
      if (existsSync(probe)) unlinkSync(probe);
    } catch {
      /* ignore */
    }
    return false;
  }
}

function probeReadable(dir: string): boolean {
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    readdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

/** Writable/readable Canvas root for this process. Cached after the first probe. */
export function canvasRoot(): string {
  if (resolvedRoot) return resolvedRoot;
  if (overrideRoot && probeReadable(overrideRoot)) {
    resolvedRoot = overrideRoot;
    return resolvedRoot;
  }
  const preferred = documentsCanvasRoot();
  if (probeWritable(preferred)) {
    resolvedRoot = preferred;
    return resolvedRoot;
  }
  if (probeReadable(preferred)) {
    resolvedRoot = preferred;
    return resolvedRoot;
  }
  const fallback = userDataCanvas || join(homedir(), 'Library/Application Support/canvas/Canvas');
  mkdirSync(fallback, { recursive: true });
  resolvedRoot = fallback;
  console.warn(`[canvas] Documents unavailable — using ${fallback}`);
  return resolvedRoot;
}

/** Projects stay on Documents when readable; otherwise the active canvas root. */
export function projectsRootDir(): string {
  if (overrideRoot && probeReadable(join(overrideRoot, 'Projects'))) {
    return join(overrideRoot, 'Projects');
  }
  const docs = join(documentsCanvasRoot(), 'Projects');
  if (probeReadable(docs)) return docs;
  return join(canvasRoot(), 'Projects');
}

export function canvasRootStatus(): {
  root: string;
  documents: string;
  usingDocuments: boolean;
  deniedDocuments: boolean;
  override: string | null;
} {
  const documents = documentsCanvasRoot();
  const deniedDocuments = !probeReadable(documents);
  const root = canvasRoot();
  return {
    root,
    documents,
    usingDocuments: root === documents,
    deniedDocuments,
    override: overrideRoot,
  };
}

export function ensureCanvasDir(...parts: string[]): string {
  const dir = join(canvasRoot(), ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function isDeniedFsError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === 'EPERM' || code === 'EACCES';
}

export function canvasAccessMessage(err?: unknown): string {
  if (err && !isDeniedFsError(err) && !/Operation not permitted/i.test(String(err))) {
    return err instanceof Error ? err.message : String(err);
  }
  return (
    'Нет доступа к папке ~/Documents/Canvas. '
    + 'Откройте Системные настройки → Конфиденциальность и безопасность → '
    + 'Файлы и папки (или Полный доступ к диску), разрешите AI Creative Workstation '
    + '(или Electron) доступ к Документам — либо нажмите «Выбрать папку Canvas…» '
    + 'и укажите Documents/Canvas, затем перезапустите приложение.'
  );
}

/** Empty list when the folder is missing or the OS denies access. */
export function safeListDir(dir: string): string[] {
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir);
  } catch (err) {
    if (isDeniedFsError(err)) return [];
    throw err;
  }
}

export function tryEnsureCanvasDir(...parts: string[]): string | null {
  try {
    return ensureCanvasDir(...parts);
  } catch (err) {
    if (isDeniedFsError(err)) return null;
    throw err;
  }
}
