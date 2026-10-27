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

import { CURRENT_SCHEMA_VERSION, closeDatabase, getDatabase, initDatabase } from './database'

function createLegacyDatabaseWithTagData(filePath: string) {
  const database = new DatabaseSync(filePath)
  database.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE categories (id TEXT PRIMARY KEY, en TEXT NOT NULL, zh TEXT NOT NULL, sort_order INTEGER DEFAULT 0);
    CREATE TABLE subcategories (id TEXT PRIMARY KEY, category_id TEXT NOT NULL, en TEXT NOT NULL, zh TEXT NOT NULL, sort_order INTEGER DEFAULT 0);
    CREATE TABLE tags (id TEXT PRIMARY KEY, subcategory_id TEXT NOT NULL, en TEXT NOT NULL, zh TEXT NOT NULL, sort_order INTEGER DEFAULT 0, source TEXT DEFAULT 'builtin');
    CREATE TABLE tag_relations (id TEXT PRIMARY KEY, source_tag_id TEXT NOT NULL, target_tag_id TEXT NOT NULL, relation_type TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'manual', enabled INTEGER NOT NULL DEFAULT 1, UNIQUE(source_tag_id, target_tag_id, relation_type));
    CREATE TABLE asset_tag_links (id TEXT PRIMARY KEY, asset_type TEXT NOT NULL, asset_key TEXT NOT NULL, tag_id TEXT NOT NULL, polarity TEXT NOT NULL DEFAULT 'neutral', weight REAL NOT NULL DEFAULT 1, confidence REAL NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'accepted', created_at TEXT NOT NULL, UNIQUE(asset_type, asset_key, tag_id, polarity));
    CREATE TABLE tag_suggestions (id TEXT PRIMARY KEY, asset_type TEXT NOT NULL, asset_key TEXT NOT NULL, raw_value TEXT NOT NULL, normalized_value TEXT NOT NULL, tag_id TEXT, namespace TEXT NOT NULL DEFAULT '', confidence REAL NOT NULL DEFAULT 0, source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', metadata_json TEXT NOT NULL DEFAULT '{}', resolved_at TEXT);
  `)
  database.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('test_marker', 'legacy')
  database.prepare('INSERT INTO categories (id,en,zh,sort_order) VALUES (?,?,?,?)').run('cat_legacy', 'Character', '人物', 1)
  database.prepare('INSERT INTO subcategories (id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?)').run('sub_legacy', 'cat_legacy', 'Face', '脸部', 1)
  const insertTag = database.prepare('INSERT INTO tags (id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?)')
  insertTag.run('tag_a', 'sub_legacy', '1girl', '单个女孩', 1, 'builtin')
  insertTag.run('tag_b', 'sub_legacy', 'solo', '单人', 2, 'builtin')
  insertTag.run('tag_parent', 'sub_legacy', 'expression', '表情', 3, 'builtin')
  insertTag.run('tag_child', 'sub_legacy', 'smile', '微笑', 4, 'builtin')
  // Legacy `child` row: read as (parent -> child), normalized into canonical `parent` rows.
  database.prepare('INSERT INTO tag_relations (id,source_tag_id,target_tag_id,relation_type,confidence,source,enabled) VALUES (?,?,?,?,?,?,?)').run('rel_child', 'tag_parent', 'tag_child', 'child', 0.8, 'legacy', 1)
  const insertLink = database.prepare('INSERT INTO asset_tag_links (id,asset_type,asset_key,tag_id,polarity,source,status,created_at) VALUES (?,?,?,?,?,?,?,?)')
  // Duplicate prompt keys: the bare key must be dropped, the prefixed one kept.
  insertLink.run('link_dup_bare', 'prompt', 'asset:dup', 'tag_a', 'neutral', 'parsed', 'accepted', '2026-01-01T00:00:00.000Z')
  insertLink.run('link_dup_prefixed', 'prompt', 'prompt:asset:dup', 'tag_a', 'neutral', 'parsed', 'accepted', '2026-01-01T00:00:00.000Z')
  insertLink.run('link_bare', 'prompt', 'asset:solo', 'tag_b', 'neutral', 'parsed', 'suggested', '2026-01-02T00:00:00.000Z')
  insertLink.run('link_usage_1', 'image', 'image:1', 'tag_a', 'neutral', 'wd14', 'accepted', '2026-01-03T00:00:00.000Z')
  insertLink.run('link_usage_2', 'image', 'image:2', 'tag_a', 'neutral', 'wd14', 'accepted', '2026-01-04T00:00:00.000Z')
  insertLink.run('link_usage_rejected', 'image', 'image:3', 'tag_b', 'neutral', 'wd14', 'rejected', '2026-01-05T00:00:00.000Z')
  database.prepare('INSERT INTO tag_suggestions (id,asset_type,asset_key,raw_value,normalized_value,source,status) VALUES (?,?,?,?,?,?,?)').run('sug_1', 'prompt', 'asset:prompt1', '1girl', '1girl', 'parsed', 'pending')
  database.close()
}

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-database-v21-'))
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(testRoot, { recursive: true, force: true })
})

describe('database v21 tag-data migration', () => {
  it('normalizes prompt keys, backfills usage and relation directions', async () => {
    const databasePath = path.join(testRoot, 'grimoire.db')
    createLegacyDatabaseWithTagData(databasePath)

    await initDatabase()

    const promptKeys = getDatabase().exec("SELECT asset_key FROM asset_tag_links WHERE asset_type='prompt' ORDER BY asset_key")[0].values.map(row => row[0])
    expect(promptKeys).toEqual(['prompt:asset:dup', 'prompt:asset:solo'])
    expect(getDatabase().exec("SELECT asset_key FROM tag_suggestions WHERE id='sug_1'")[0].values[0][0]).toBe('prompt:asset:prompt1')

    const usage = getDatabase().exec("SELECT count FROM tag_usage WHERE tag_id='tag_a'")[0].values
    expect(usage.length).toBe(1)
    expect(usage[0][0]).toBe(3)
    expect(getDatabase().exec("SELECT COUNT(*) FROM tag_usage WHERE tag_id='tag_b'")[0].values[0][0]).toBe(0)

    expect(getDatabase().exec("SELECT COUNT(*) FROM tag_relations WHERE relation_type='child'")[0].values[0][0]).toBe(0)
    const parentRows = getDatabase().exec("SELECT source_tag_id,target_tag_id FROM tag_relations WHERE relation_type='parent'")[0].values
    expect(parentRows).toEqual([['tag_child', 'tag_parent']])

    for (const marker of ['asset_key_prompt_prefix_migrated', 'tag_usage_backfilled', 'tag_relation_direction_normalized']) {
      expect(getDatabase().exec('SELECT value FROM schema_meta WHERE key=?', [marker])[0].values.length).toBe(1)
    }
    expect(getDatabase().exec("SELECT value FROM schema_meta WHERE key='schema_version'")[0].values[0][0]).toBe(String(CURRENT_SCHEMA_VERSION))
    expect(fs.readdirSync(testRoot).some(name => name.startsWith('grimoire.db.pre-migration-'))).toBe(true)
  })

  it('is idempotent across restarts', async () => {
    const databasePath = path.join(testRoot, 'grimoire.db')
    createLegacyDatabaseWithTagData(databasePath)

    await initDatabase()
    closeDatabase()
    await initDatabase()

    const promptKeys = getDatabase().exec("SELECT asset_key FROM asset_tag_links WHERE asset_type='prompt' ORDER BY asset_key")[0].values.map(row => row[0])
    expect(promptKeys).toEqual(['prompt:asset:dup', 'prompt:asset:solo'])
    expect(getDatabase().exec("SELECT count FROM tag_usage WHERE tag_id='tag_a'")[0].values[0][0]).toBe(3)
    expect(getDatabase().exec("SELECT COUNT(*) FROM tag_relations WHERE relation_type='parent'")[0].values[0][0]).toBe(1)
    expect(getDatabase().exec("SELECT COUNT(*) FROM asset_tag_links WHERE asset_type='prompt'")[0].values[0][0]).toBe(2)
  })
})