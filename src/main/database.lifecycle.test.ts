import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => name === 'exe' ? path.join(testRoot, 'Grimoire.exe') : testRoot,
  },
}))

import { closeDatabase, getDatabase, importDatabase, initDatabase } from './database'

function createLegacyDatabase(filePath: string, settingValue = 'legacy') {
  const database = new DatabaseSync(filePath)
  database.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE categories (id TEXT PRIMARY KEY, en TEXT NOT NULL, zh TEXT NOT NULL, sort_order INTEGER DEFAULT 0);
    CREATE TABLE subcategories (id TEXT PRIMARY KEY, category_id TEXT NOT NULL, en TEXT NOT NULL, zh TEXT NOT NULL, sort_order INTEGER DEFAULT 0);
    CREATE TABLE tags (id TEXT PRIMARY KEY, subcategory_id TEXT NOT NULL, en TEXT NOT NULL, zh TEXT NOT NULL, sort_order INTEGER DEFAULT 0, source TEXT DEFAULT 'builtin');
  `)
  database.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('test_marker', settingValue)
  database.close()
}

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-database-'))
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(testRoot, { recursive: true, force: true })
})

describe('database lifecycle', () => {
  it('upgrades a legacy database before creating indexes that use new columns', async () => {
    const databasePath = path.join(testRoot, 'grimoire.db')
    createLegacyDatabase(databasePath)

    await initDatabase()

    const categoryColumns = getDatabase().exec('PRAGMA table_info(categories)')[0].values.map(row => row[1])
    expect(categoryColumns).toContain('group_id')
    expect(getDatabase().exec("SELECT value FROM schema_meta WHERE key='schema_version'")[0].values[0][0]).toBe('7')
    expect(fs.readdirSync(testRoot).some(name => name.startsWith('grimoire.db.pre-migration-'))).toBe(true)
  })

  it('rejects an unrelated SQLite file and keeps the active database usable', async () => {
    await initDatabase()
    getDatabase().run('INSERT INTO settings (key, value) VALUES (?, ?)', ['test_marker', 'current'])
    const unrelatedPath = path.join(testRoot, 'unrelated.db')
    const unrelated = new DatabaseSync(unrelatedPath)
    unrelated.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)')
    unrelated.close()

    expect(() => importDatabase(unrelatedPath)).toThrow('不是可识别的魔导书数据库')
    expect(getDatabase().exec("SELECT value FROM settings WHERE key='test_marker'")[0].values[0][0]).toBe('current')
  })

  it('imports and upgrades a valid legacy database while creating a recovery backup', async () => {
    await initDatabase()
    getDatabase().run('INSERT INTO settings (key, value) VALUES (?, ?)', ['test_marker', 'current'])
    const importPath = path.join(testRoot, 'legacy-import.db')
    createLegacyDatabase(importPath, 'imported')

    importDatabase(importPath)

    expect(getDatabase().exec("SELECT value FROM settings WHERE key='test_marker'")[0].values[0][0]).toBe('imported')
    expect(getDatabase().exec("SELECT value FROM schema_meta WHERE key='schema_version'")[0].values[0][0]).toBe('7')
    expect(fs.readdirSync(testRoot).some(name => name.startsWith('grimoire.db.before-import-'))).toBe(true)
  })
})
