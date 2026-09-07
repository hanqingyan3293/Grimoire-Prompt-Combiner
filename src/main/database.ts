// 魔导书 Grimoire v7 — SQLite 数据库管理
import { DatabaseSync } from 'node:sqlite'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { createLegacyDatabase, type LegacyDatabase } from './services/sqlite.compat'

const CURRENT_SCHEMA_VERSION = 7
let nativeDb: DatabaseSync | null = null
let db: LegacyDatabase | null = null
let dbPath = ''

const SCHEMA_SQL = `

CREATE TABLE IF NOT EXISTS tag_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  group_id TEXT DEFAULT 'default',
  en TEXT NOT NULL,
  zh TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS subcategories (
  id TEXT PRIMARY KEY,
  group_id TEXT DEFAULT 'default',
  category_id TEXT NOT NULL,
  en TEXT NOT NULL,
  zh TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  group_id TEXT DEFAULT 'default',
  subcategory_id TEXT NOT NULL,
  en TEXT NOT NULL,
  zh TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  source TEXT DEFAULT 'builtin',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_id TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sub_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subcategory_id TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tag_usage (
  tag_id TEXT PRIMARY KEY,
  count INTEGER DEFAULT 0,
  last_used TEXT,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  positive_count INTEGER DEFAULT 0,
  negative_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  task_id TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS image_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  storage_mode TEXT NOT NULL DEFAULT 'external',
  asset_hash TEXT,
  mime_type TEXT,
  file_size INTEGER,
  original_name TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS prompt_assets (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  chapter TEXT DEFAULT '',
  section TEXT DEFAULT '',
  subsection TEXT DEFAULT '',
  nsfw INTEGER NOT NULL DEFAULT 0,
  variant_count INTEGER NOT NULL DEFAULT 0,
  source_fingerprint TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS migration_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  added_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS task_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  error_code TEXT,
  error_message TEXT,
  progress REAL NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comfy_workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  bindings_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'imported',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_image_refs (
  task_id TEXT NOT NULL,
  image_id INTEGER NOT NULL,
  source_filename TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (task_id, image_id),
  FOREIGN KEY (task_id) REFERENCES task_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (image_id) REFERENCES image_refs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS canvas_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

INSERT OR IGNORE INTO chat_groups (id, name, sort_order) VALUES ('default', '默认', 0);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  group_id TEXT DEFAULT '',
  provider_id TEXT NOT NULL,
  title TEXT DEFAULT '新对话',
  model TEXT NOT NULL DEFAULT '',
  system_prompt TEXT DEFAULT '',
  pinned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conv_id TEXT DEFAULT '',
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  model TEXT DEFAULT '',
  token_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);


CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  access_mode TEXT DEFAULT 'api',
  protocol TEXT DEFAULT 'chat_completions',
  base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
  api_key TEXT DEFAULT '',
  default_model TEXT DEFAULT 'gpt-4o',
  test_model TEXT DEFAULT 'gpt-4o-mini',
  context_size INTEGER,
  models TEXT DEFAULT '[]',
  is_active INTEGER DEFAULT 0,
  config_toml TEXT DEFAULT '',
  auth_json TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS error_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  stack TEXT DEFAULT '',
  context TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

`

const INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_sub_cat ON subcategories(category_id);
CREATE INDEX IF NOT EXISTS idx_tag_sub ON tags(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_cat_group ON categories(group_id);
CREATE INDEX IF NOT EXISTS idx_sub_group ON subcategories(group_id);
CREATE INDEX IF NOT EXISTS idx_tag_group ON tags(group_id);
CREATE INDEX IF NOT EXISTS idx_sub_fav ON sub_favorites(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_fav_tag ON favorites(tag_id);
CREATE INDEX IF NOT EXISTS idx_presets_name ON presets(name);
CREATE INDEX IF NOT EXISTS idx_prompt_assets_name ON prompt_assets(name);
CREATE INDEX IF NOT EXISTS idx_prompt_assets_source ON prompt_assets(source);
CREATE INDEX IF NOT EXISTS idx_task_jobs_status ON task_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_comfy_workflows_name ON comfy_workflows(name);
CREATE INDEX IF NOT EXISTS idx_canvas_projects_updated ON canvas_projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_time ON history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_image_refs_image ON task_image_refs(image_id);
`

const REQUIRED_GRIMOIRE_TABLES = ['settings', 'categories', 'subcategories', 'tags'] as const

function assertGrimoireDatabase(connection: DatabaseSync): void {
  const rows = connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
  const tables = new Set(rows.map(row => row.name))
  const missing = REQUIRED_GRIMOIRE_TABLES.filter(table => !tables.has(table))
  if (missing.length) throw new Error('导入文件不是可识别的魔导书数据库')

  if (tables.has('schema_meta')) {
    const row = connection.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get() as { value?: string } | undefined
    const version = Number(row?.value)
    if (Number.isFinite(version) && version > CURRENT_SCHEMA_VERSION) {
      throw new Error(`导入数据库版本 ${version} 高于当前支持版本 ${CURRENT_SCHEMA_VERSION}`)
    }
  }
}

function assertIntegrity(connection: DatabaseSync, message = '数据库完整性检查失败'): void {
  const row = connection.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined
  if (row?.integrity_check !== 'ok') throw new Error(message)
}

function configureConnection(connection: DatabaseSync): void {
  connection.exec('PRAGMA journal_mode=WAL;')
  connection.exec('PRAGMA foreign_keys=ON;')
  connection.exec('PRAGMA busy_timeout=5000;')
}

export function initializeDatabaseConnection(connection: DatabaseSync, requireExistingGrimoire = false): LegacyDatabase {
  if (requireExistingGrimoire) assertGrimoireDatabase(connection)
  configureConnection(connection)
  const legacy = createLegacyDatabase(connection)
  legacy.exec(SCHEMA_SQL)

  // Columns must be added before indexes that reference them are created.
  try { legacy.run("ALTER TABLE categories ADD COLUMN group_id TEXT DEFAULT 'default'") } catch {}
  try { legacy.run("ALTER TABLE subcategories ADD COLUMN group_id TEXT DEFAULT 'default'") } catch {}
  try { legacy.run("ALTER TABLE tags ADD COLUMN group_id TEXT DEFAULT 'default'") } catch {}
  try { legacy.run("ALTER TABLE chat_messages ADD COLUMN conv_id TEXT DEFAULT ''") } catch {}
  try { legacy.run("ALTER TABLE chat_messages ADD COLUMN token_count INTEGER DEFAULT 0") } catch {}
  try { legacy.run("ALTER TABLE image_refs ADD COLUMN storage_mode TEXT NOT NULL DEFAULT 'external'") } catch {}
  try { legacy.run("ALTER TABLE image_refs ADD COLUMN asset_hash TEXT") } catch {}
  try { legacy.run("ALTER TABLE image_refs ADD COLUMN mime_type TEXT") } catch {}
  try { legacy.run("ALTER TABLE image_refs ADD COLUMN file_size INTEGER") } catch {}
  try { legacy.run("ALTER TABLE image_refs ADD COLUMN original_name TEXT") } catch {}
  try { legacy.run("ALTER TABLE image_refs ADD COLUMN available INTEGER NOT NULL DEFAULT 1") } catch {}
  try { legacy.run("ALTER TABLE history ADD COLUMN task_id TEXT") } catch {}

  legacy.exec(INDEX_SQL)
  legacy.run("CREATE INDEX IF NOT EXISTS idx_history_task ON history(task_id)")
  legacy.run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)", [String(CURRENT_SCHEMA_VERSION)])
  return legacy
}

function resolveDatabasePath(): string {
  // 便携模式：exe同目录有 portable 文件则数据存本地 data/ 文件夹
  const exeDir = path.dirname(app.getPath('exe'))
  if (fs.existsSync(path.join(exeDir, 'portable'))) {
    const pDir = path.join(exeDir, 'data')
    if (!fs.existsSync(pDir)) fs.mkdirSync(pDir, { recursive: true })
    return path.join(pDir, 'grimoire.db')
  }
  return path.join(app.getPath('userData'), 'grimoire.db')
}

function readSchemaVersion(filePath: string): number | null {
  if (!fs.existsSync(filePath)) return null
  let probe: DatabaseSync | null = null
  try {
    probe = new DatabaseSync(filePath, { readOnly: true })
    const table = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'").get()
    if (!table) return null
    const row = probe.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get() as { value?: string } | undefined
    const version = Number(row?.value)
    return Number.isFinite(version) ? version : null
  } catch {
    return null
  } finally {
    probe?.close()
  }
}

function backupBeforeMigration(filePath: string): void {
  if (!fs.existsSync(filePath) || readSchemaVersion(filePath) === CURRENT_SCHEMA_VERSION) return
  const backupPath = filePath + '.pre-migration-' + new Date().toISOString().replace(/[:.]/g, '-') + '.bak'
  fs.copyFileSync(filePath, backupPath)
}

export async function initDatabase(): Promise<LegacyDatabase> {
  dbPath = resolveDatabasePath()
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  backupBeforeMigration(dbPath)

  nativeDb = new DatabaseSync(dbPath, { timeout: 5000, enableForeignKeyConstraints: true })
  db = initializeDatabaseConnection(nativeDb)
  return db
}

export function getDatabase(): LegacyDatabase {
  if (!db) throw new Error('数据库未初始化')
  return db
}

export function saveDatabase(): void {
  // Native SQLite persists each completed statement. Retained for IPC compatibility.
}

export function getDatabasePath(): string {
  return dbPath
}

export function getResourceRoot(): string {
  if (!dbPath) throw new Error('数据库未初始化')
  return path.join(path.dirname(dbPath), 'resources')
}

export function exportDatabase(exportPath: string): void {
  if (!db || !nativeDb) throw new Error('数据库未初始化')
  nativeDb.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  fs.copyFileSync(dbPath, exportPath)
}

export function importDatabase(importPath: string): void {
  if (!db || !nativeDb) throw new Error('数据库未初始化')
  if (!fs.existsSync(importPath)) throw new Error('导入文件不存在')
  if (path.resolve(importPath) === path.resolve(dbPath)) throw new Error('不能从当前正在使用的数据库导入')

  const token = crypto.randomUUID().replaceAll('-', '')
  const stagedPath = dbPath + `.import-${token}.tmp`
  const displacedPath = dbPath + `.replace-${token}.tmp`
  const importedBackupPath = dbPath + '.before-import-' + new Date().toISOString().replace(/[:.]/g, '-') + '.bak'
  let staged: DatabaseSync | null = null
  let originalMoved = false
  try {
    fs.copyFileSync(importPath, stagedPath)
    staged = new DatabaseSync(stagedPath, { timeout: 5000, enableForeignKeyConstraints: true })
    initializeDatabaseConnection(staged, true)
    assertIntegrity(staged, '导入数据库完整性检查失败')
    staged.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    staged.close()
    staged = null

    nativeDb.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    fs.copyFileSync(dbPath, importedBackupPath)
    nativeDb.close()
    nativeDb = null
    db = null

    fs.renameSync(dbPath, displacedPath)
    originalMoved = true
    fs.renameSync(stagedPath, dbPath)
    fs.rmSync(dbPath + '-wal', { force: true })
    fs.rmSync(dbPath + '-shm', { force: true })

    nativeDb = new DatabaseSync(dbPath, { timeout: 5000, enableForeignKeyConstraints: true })
    db = initializeDatabaseConnection(nativeDb, true)
    assertIntegrity(nativeDb)
    nativeDb.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    fs.rmSync(displacedPath, { force: true })
    originalMoved = false
  } catch (error) {
    try { staged?.close() } catch {}
    try { nativeDb?.close() } catch {}
    nativeDb = null
    db = null

    if (originalMoved) {
      fs.rmSync(dbPath, { force: true })
      fs.renameSync(displacedPath, dbPath)
    }

    nativeDb = new DatabaseSync(dbPath, { timeout: 5000, enableForeignKeyConstraints: true })
    db = initializeDatabaseConnection(nativeDb)
    throw error
  } finally {
    fs.rmSync(stagedPath, { force: true })
    fs.rmSync(stagedPath + '-wal', { force: true })
    fs.rmSync(stagedPath + '-shm', { force: true })
    if (!originalMoved) fs.rmSync(displacedPath, { force: true })
  }
}

export function closeDatabase(): void {
  if (!nativeDb) return
  try { nativeDb.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch {}
  nativeDb.close()
  nativeDb = null
  db = null
}

export async function importDefaultTags(tagsData: string): Promise<void> {
  const database = getDatabase()
  const categories = JSON.parse(tagsData) as Array<{
    id: string; en: string; zh: string; sort_order: number;
    subcategories: Array<{
      id: string; en: string; zh: string; sort_order: number;
      tags: Array<{
        id: string; en: string; zh: string; sort_order: number;
        source: string;
      }>;
    }>;
  }>
  
  const insertCat = database.prepare(
    `INSERT OR REPLACE INTO categories (id, group_id, en, zh, sort_order) VALUES (?,'default', ?, ?, ?)`
  )
  const insertSub = database.prepare(
    `INSERT OR REPLACE INTO subcategories (id, group_id, category_id, en, zh, sort_order) VALUES (?,'default', ?, ?, ?, ?)`
  )
  const insertTag = database.prepare(
    `INSERT OR REPLACE INTO tags (id, group_id, subcategory_id, en, zh, sort_order, source) VALUES (?,'default', ?, ?, ?, ?, ?)`
  )
  
  for (const cat of categories) {
    insertCat.run([cat.id, cat.en, cat.zh, cat.sort_order])
    for (const sub of cat.subcategories) {
      insertSub.run([sub.id, cat.id, sub.en, sub.zh, sub.sort_order])
      for (const tag of sub.tags) {
        insertTag.run([tag.id, sub.id, tag.en, tag.zh, tag.sort_order, tag.source || 'builtin'])
      }
    }
  }
  
  insertCat.free()
  insertSub.free()
  insertTag.free()
  saveDatabase()
}
