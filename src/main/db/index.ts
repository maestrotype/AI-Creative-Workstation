import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import * as schema from './schema';

let dbInstance: ReturnType<typeof drizzle> | null = null;

export function initDb() {
  const userDataPath = app.getPath('userData'); // ~/Library/Application Support/canvas
  const dbDir = path.join(userDataPath, 'db');
  
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = path.join(dbDir, 'canvas.sqlite');
  console.log('Initializing DB at:', dbPath);

  const sqlite = new Database(dbPath);
  
  // Create tables manually for now since we aren't running drizzle-kit migrations yet in production runtime
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      path TEXT,
      status TEXT NOT NULL DEFAULT 'available',
      error_message TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  // Migrate existing DBs created before error_message was added
  const modelCols = sqlite.prepare(`PRAGMA table_info(models)`).all() as { name: string }[];
  if (!modelCols.some((c) => c.name === 'error_message')) {
    console.log('Migrating models table: adding error_message column');
    sqlite.exec(`ALTER TABLE models ADD COLUMN error_message TEXT`);
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      prompt TEXT NOT NULL,
      image_url TEXT NOT NULL,
      model_id TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  dbInstance = drizzle(sqlite, { schema });
  return dbInstance;
}

export function getDb() {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return dbInstance;
}
