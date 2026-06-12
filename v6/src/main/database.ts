// ============================================================
// 魔导书 v5 — SQLite 数据库层
// ============================================================

import initSqlJs, { Database, SqlJsStatic } from 'sql.js'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'

let SQL: SqlJsStatic | null = null
let db: Database | null = null

function getDbPath(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'grimoire.db')
}

export async function initDatabase(): Promise<Database> {
  if (db) return db

  SQL = await initSqlJs()
  const dbPath = getDbPath()

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
    console.log('[Database] Opened existing database:', dbPath)
  } else {
    db = new SQL.Database()
    console.log('[Database] Created new database')
  }

  db.run('PRAGMA journal_mode=WAL')
  db.run('PRAGMA foreign_keys=ON')
  db.run('PRAGMA busy_timeout=5000')

  createSchema()
  saveDatabase()

  return db
}

function createSchema(): void {
  if (!db) throw new Error('Database not initialized')

  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS subcategories (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      subcategory_id TEXT NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE,
      en TEXT NOT NULL,
      zh TEXT NOT NULL DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      source TEXT DEFAULT 'builtin',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `)
  db.run('CREATE INDEX IF NOT EXISTS idx_tags_en ON tags(en COLLATE NOCASE)')
  db.run('CREATE INDEX IF NOT EXISTS idx_tags_source ON tags(source)')

  db.run(`
    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(tag_id)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS tag_usage (
      tag_id TEXT PRIMARY KEY REFERENCES tags(id) ON DELETE CASCADE,
      count INTEGER DEFAULT 0,
      last_used TEXT
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS image_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS migration_status (
      version INTEGER PRIMARY KEY,
      migrated_at TEXT DEFAULT (datetime('now','localtime')),
      source_version TEXT
    )
  `)
}

export function saveDatabase(): void {
  if (!db) return
  const dbPath = getDbPath()
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const data = db.export()
  const buffer = Buffer.from(data)
  fs.writeFileSync(dbPath, buffer)
}

export function getDatabase(): Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function closeDatabase(): void {
  if (db) {
    saveDatabase()
    db.close()
    db = null
  }
}
