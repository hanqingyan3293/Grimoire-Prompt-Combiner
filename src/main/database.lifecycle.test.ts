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

import { CURRENT_SCHEMA_VERSION, closeDatabase, getDatabase, importDatabase, initDatabase } from './database'

function createLegacyDatabase(filePath: string, settingValue = 'legacy') {
  const database = new DatabaseSync(filePath)
  database.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE categories (id TEXT PRIMARY KEY, en TEXT NOT NULL, zh TEXT NOT NULL, sort_order INTEGER DEFAULT 0);
    CREATE TABLE subcategories (id TEXT PRIMARY KEY, category_id TEXT NOT NULL, en TEXT NOT NULL, zh TEXT NOT NULL, sort_order INTEGER DEFAULT 0);
    CREATE TABLE tags (id TEXT PRIMARY KEY, subcategory_id TEXT NOT NULL, en TEXT NOT NULL, zh TEXT NOT NULL, sort_order INTEGER DEFAULT 0, source TEXT DEFAULT 'builtin');
    CREATE TABLE conversations (id TEXT PRIMARY KEY, group_id TEXT DEFAULT '', provider_id TEXT NOT NULL, title TEXT DEFAULT '新对话', model TEXT NOT NULL DEFAULT '', system_prompt TEXT DEFAULT '', pinned INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE chat_messages (id TEXT PRIMARY KEY, conv_id TEXT DEFAULT '', role TEXT NOT NULL, content TEXT NOT NULL, model TEXT DEFAULT '', token_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, runtime TEXT NOT NULL, provider_id TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'idle', parent_id TEXT, data_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE agent_session_events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, sequence INTEGER NOT NULL, type TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, UNIQUE(session_id, sequence));
  `)
  database.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('test_marker', settingValue)
  database.prepare('INSERT INTO categories (id,en,zh,sort_order) VALUES (?,?,?,?)').run('cat_legacy', 'Character', '人物', 1)
  database.prepare('INSERT INTO subcategories (id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?)').run('sub_legacy', 'cat_legacy', 'Face', '脸部', 1)
  database.prepare('INSERT INTO tags (id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?)').run('tag_legacy', 'sub_legacy', '1girl', '单个女孩', 1, 'builtin')
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
    expect(getDatabase().exec("SELECT normalized_key FROM tag_metadata WHERE tag_id='tag_legacy'")[0].values[0][0]).toBe('1girl')
    expect(getDatabase().exec("SELECT alias FROM tag_aliases WHERE tag_id='tag_legacy'")[0].values.map(row => row[0]).sort()).toEqual(['1girl', '单个女孩'].sort())
    expect(getDatabase().exec("SELECT value FROM schema_meta WHERE key='schema_version'")[0].values[0][0]).toBe(String(CURRENT_SCHEMA_VERSION))
    expect(getDatabase().exec("SELECT name FROM sqlite_master WHERE type='table' AND name='cherry_resource_state'")[0].values.length).toBe(1)
    expect(getDatabase().exec("SELECT value FROM schema_meta WHERE key='cherry_resource_state_migrated'")[0].values.length).toBe(1)
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
    expect(getDatabase().exec("SELECT value FROM schema_meta WHERE key='schema_version'")[0].values[0][0]).toBe(String(CURRENT_SCHEMA_VERSION))
    expect(getDatabase().exec("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_attachments'")[0].values.length).toBe(1)
    expect(fs.readdirSync(testRoot).some(name => name.startsWith('grimoire.db.before-import-'))).toBe(true)
  })

  it('migrates legacy chat and agent history into unified AI sessions', async () => {
    const databasePath = path.join(testRoot, 'grimoire.db')
    createLegacyDatabase(databasePath)
    const legacy = new DatabaseSync(databasePath)
    legacy.prepare('INSERT INTO conversations (id,provider_id,title,model) VALUES (?,?,?,?)').run('conv_1', 'provider_1', '旧聊天', 'model_1')
    legacy.prepare('INSERT INTO chat_messages (id,conv_id,role,content,model) VALUES (?,?,?,?,?)').run('msg_1', 'conv_1', 'user', '你好', 'model_1')
    legacy.prepare('INSERT INTO agent_sessions (id,runtime,model,title,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('agent_1', 'pi', 'pi-model', '旧 Agent', 'completed', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    legacy.prepare('INSERT INTO agent_session_events (id,session_id,sequence,type,data_json,created_at) VALUES (?,?,?,?,?,?)').run('event_1', 'agent_1', 0, 'message', JSON.stringify({ role: 'assistant', content: '完成' }), '2026-01-01T00:00:01.000Z')
    legacy.close()

    await initDatabase()
    expect(getDatabase().exec('SELECT COUNT(*) FROM ai_sessions')[0].values[0][0]).toBe(2)
    expect(getDatabase().exec('SELECT role FROM ai_messages WHERE id=?', ['legacy_chat_message_msg_1'])[0].values[0][0]).toBe('user')
    expect(getDatabase().exec('SELECT event_type FROM ai_events WHERE id=?', ['legacy_agent_event_event_1'])[0].values[0][0]).toBe('message')
    expect(getDatabase().exec("SELECT value FROM schema_meta WHERE key='ai_sessions_migrated'")[0].values.length).toBe(1)
  })
})
