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

function createLegacyDatabaseWithMediaData(filePath: string) {
  const database = new DatabaseSync(filePath)
  database.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE categories (id TEXT PRIMARY KEY, en TEXT NOT NULL, zh TEXT NOT NULL, sort_order INTEGER DEFAULT 0);
    CREATE TABLE subcategories (id TEXT PRIMARY KEY, category_id TEXT NOT NULL, en TEXT NOT NULL, zh TEXT NOT NULL, sort_order INTEGER DEFAULT 0);
    CREATE TABLE tags (id TEXT PRIMARY KEY, subcategory_id TEXT NOT NULL, en TEXT NOT NULL, zh TEXT NOT NULL, sort_order INTEGER DEFAULT 0, source TEXT DEFAULT 'builtin');
    CREATE TABLE asset_tag_links (id TEXT PRIMARY KEY, asset_type TEXT NOT NULL, asset_key TEXT NOT NULL, tag_id TEXT NOT NULL, polarity TEXT NOT NULL DEFAULT 'neutral', weight REAL NOT NULL DEFAULT 1, confidence REAL NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'accepted', created_at TEXT NOT NULL, UNIQUE(asset_type, asset_key, tag_id, polarity));
    CREATE TABLE image_generation_metadata (media_asset_id TEXT PRIMARY KEY, prompt TEXT NOT NULL DEFAULT '', negative_prompt TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', checkpoint TEXT NOT NULL DEFAULT '', loras_json TEXT NOT NULL DEFAULT '[]', seed INTEGER, sampler TEXT NOT NULL DEFAULT '', scheduler TEXT NOT NULL DEFAULT '', steps INTEGER, cfg REAL, width INTEGER, height INTEGER, raw_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
  `)
  database.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('test_marker', 'legacy')
  database.prepare('INSERT INTO categories (id,en,zh,sort_order) VALUES (?,?,?,?)').run('cat_legacy', 'Character', '人物', 1)
  database.prepare('INSERT INTO subcategories (id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?)').run('sub_legacy', 'cat_legacy', 'Face', '脸部', 1)
  const insertTag = database.prepare('INSERT INTO tags (id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?)')
  insertTag.run('tag_a', 'sub_legacy', '1girl', '单个女孩', 1, 'builtin')
  insertTag.run('tag_b', 'sub_legacy', 'solo', '单人', 2, 'builtin')
  const insertLink = database.prepare('INSERT INTO asset_tag_links (id,asset_type,asset_key,tag_id,polarity,source,status,created_at) VALUES (?,?,?,?,?,?,?,?)')
  insertLink.run('l1', 'image', 'image:12', 'tag_a', 'neutral', 'wd14', 'accepted', '2026-01-01T00:00:00.000Z')
  insertLink.run('l2', 'image', 'image:7', 'tag_a', 'neutral', 'wd14', 'accepted', '2026-01-01T00:00:00.000Z')
  insertLink.run('l3', 'image', 'image:12x', 'tag_a', 'neutral', 'wd14', 'accepted', '2026-01-01T00:00:00.000Z')
  insertLink.run('l4', 'image', 'image:0', 'tag_a', 'neutral', 'wd14', 'accepted', '2026-01-01T00:00:00.000Z')
  insertLink.run('l5', 'prompt', 'prompt:asset:abc', 'tag_b', 'neutral', 'parsed', 'accepted', '2026-01-01T00:00:00.000Z')
  database.prepare('INSERT INTO image_generation_metadata (media_asset_id,prompt,raw_json,created_at) VALUES (?,?,?,?)').run('m1', 'a prompt', '{"k":1}', '2026-01-01T00:00:00.000Z')
  database.close()
}

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-database-v22-'))
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(testRoot, { recursive: true, force: true })
})

describe('database v22 media metadata migration', () => {
  it('backfills asset_ref_id for numeric image keys and generation metadata origin', async () => {
    const databasePath = path.join(testRoot, 'grimoire.db')
    createLegacyDatabaseWithMediaData(databasePath)

    await initDatabase()

    const refs = getDatabase().exec("SELECT id,asset_ref_id FROM asset_tag_links ORDER BY id")[0].values
    expect(refs).toEqual([
      ['l1', 12],
      ['l2', 7],
      ['l3', null],
      ['l4', null],
      ['l5', null],
    ])
    expect(getDatabase().exec("SELECT origin FROM image_generation_metadata WHERE media_asset_id='m1'")[0].values[0][0]).toBe('comfyui-grimoire')

    const imageRefColumns = getDatabase().exec('PRAGMA table_info(image_refs)')[0].values.map(row => String(row[1]))
    expect(imageRefColumns).toEqual(expect.arrayContaining(['width', 'height', 'file_mtime']))
    expect(getDatabase().exec("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_asset_tag_links_ref'")[0].values.length).toBe(1)

    for (const marker of ['asset_ref_backfilled', 'generation_metadata_origin_backfilled']) {
      expect(getDatabase().exec('SELECT value FROM schema_meta WHERE key=?', [marker])[0].values.length).toBe(1)
    }
    expect(getDatabase().exec("SELECT value FROM schema_meta WHERE key='schema_version'")[0].values[0][0]).toBe(String(CURRENT_SCHEMA_VERSION))
    expect(fs.readdirSync(testRoot).some(name => name.startsWith('grimoire.db.pre-migration-'))).toBe(true)
  })

  it('is idempotent and never rewrites origins of new rows after the marker', async () => {
    const databasePath = path.join(testRoot, 'grimoire.db')
    createLegacyDatabaseWithMediaData(databasePath)

    await initDatabase()
    getDatabase().run('INSERT INTO image_generation_metadata (media_asset_id,prompt,raw_json,created_at) VALUES (?,?,?,?)', ['m2', 'new row', '{}', '2026-01-02T00:00:00.000Z'])
    closeDatabase()
    await initDatabase()

    expect(getDatabase().exec("SELECT origin FROM image_generation_metadata WHERE media_asset_id='m2'")[0].values[0][0]).toBe('')
    expect(getDatabase().exec("SELECT asset_ref_id FROM asset_tag_links WHERE id='l1'")[0].values[0][0]).toBe(12)
    expect(getDatabase().exec("SELECT COUNT(*) FROM asset_tag_links")[0].values[0][0]).toBe(5)
  })
})