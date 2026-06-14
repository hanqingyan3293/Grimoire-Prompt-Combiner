// 魔导书 Grimoire v7 — SQLite 数据库管理
import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'

let SQL: SqlJsStatic | null = null
let db: SqlJsDatabase | null = null
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
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS image_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
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

CREATE INDEX IF NOT EXISTS idx_sub_cat ON subcategories(category_id);
CREATE INDEX IF NOT EXISTS idx_tag_sub ON tags(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_cat_group ON categories(group_id);
CREATE INDEX IF NOT EXISTS idx_sub_group ON subcategories(group_id);
CREATE INDEX IF NOT EXISTS idx_tag_group ON tags(group_id);
CREATE INDEX IF NOT EXISTS idx_sub_fav ON sub_favorites(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_fav_tag ON favorites(tag_id);
CREATE INDEX IF NOT EXISTS idx_presets_name ON presets(name);
CREATE INDEX IF NOT EXISTS idx_history_time ON history(created_at DESC);
`

export async function initDatabase(): Promise<SqlJsDatabase> {
  SQL = await initSqlJs()
  // 便携模式：exe同目录有 portable 文件则数据存本地 data/ 文件夹
  const exeDir = path.dirname(app.getPath('exe'))
  if (fs.existsSync(path.join(exeDir, 'portable'))) {
    const pDir = path.join(exeDir, 'data')
    if (!fs.existsSync(pDir)) fs.mkdirSync(pDir, { recursive: true })
    dbPath = path.join(pDir, 'grimoire.db')
  } else {
    dbPath = path.join(app.getPath('userData'), 'grimoire.db')
  }
  
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }
  
  db.run('PRAGMA journal_mode=WAL;')
  db.run('PRAGMA foreign_keys=ON;')
  db.run('PRAGMA busy_timeout=5000;')
  
  db.run(SCHEMA_SQL)

// Migration: add group_id to existing tables
try {
  db.run("ALTER TABLE categories ADD COLUMN group_id TEXT DEFAULT 'default'");
} catch {}
try {
  db.run("ALTER TABLE subcategories ADD COLUMN group_id TEXT DEFAULT 'default'");
} catch {}
try {
  db.run("ALTER TABLE tags ADD COLUMN group_id TEXT DEFAULT 'default'");
} catch {}

// Migration: add conv_id and token_count to existing chat_messages
try {
  db.run("ALTER TABLE chat_messages ADD COLUMN conv_id TEXT DEFAULT ''");
} catch {}
try {
  db.run("ALTER TABLE chat_messages ADD COLUMN token_count INTEGER DEFAULT 0");
} catch {}

  saveDatabase()
  
  return db
}

export function getDatabase(): SqlJsDatabase {
  if (!db) throw new Error('数据库未初始化')
  return db
}

export function saveDatabase(): void {
  if (!db) return
  const data = db.export()
  const buffer = Buffer.from(data)
  fs.writeFileSync(dbPath, buffer)
}

export function getDatabasePath(): string {
  return dbPath
}

export function exportDatabase(exportPath: string): void {
  if (!db) throw new Error('数据库未初始化')
  saveDatabase()
  fs.copyFileSync(dbPath, exportPath)
}

export function importDatabase(importPath: string): void {
  if (!db || !SQL) throw new Error('数据库未初始化')
  if (!fs.existsSync(importPath)) throw new Error('导入文件不存在')
  
  const buffer = fs.readFileSync(importPath)
  db.close()
  db = new SQL.Database(buffer)
  
  db.run(SCHEMA_SQL)
  
  const data = db.export()
  fs.writeFileSync(dbPath, Buffer.from(data))
}

export function closeDatabase(): void {
  if (db) {
    saveDatabase()
    db.close()
    db = null
  }
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