import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createLegacyDatabase } from './sqlite.compat'
import {
  deletePromptAsset,
  isImportedPromptRow,
  orderedPromptAssetIds,
  queryPromptAssets,
  reorderPromptAsset,
  updatePromptAsset,
  validatePromptAssetQuery
} from './prompt-asset-browser'

function createDatabase() {
  const native = new DatabaseSync(':memory:')
  const db = createLegacyDatabase(native)
  db.exec(`
    CREATE TABLE prompt_assets (id TEXT, source_id TEXT, source TEXT, name TEXT, prompt TEXT, chapter TEXT, section TEXT, subsection TEXT, nsfw INTEGER, variant_count INTEGER, source_fingerprint TEXT, created_at TEXT, updated_at TEXT, visibility TEXT NOT NULL DEFAULT 'global');
    CREATE TABLE history (id TEXT, prompt TEXT, positive_count INTEGER, negative_count INTEGER, created_at TEXT);
    CREATE TABLE presets (id TEXT, name TEXT, data TEXT, updated_at TEXT);
    CREATE TABLE favorites (tag_id TEXT, created_at TEXT);
    CREATE TABLE tags (id TEXT, en TEXT, zh TEXT, subcategory_id TEXT);
    CREATE TABLE subcategories (id TEXT, zh TEXT, category_id TEXT);
    CREATE TABLE categories (id TEXT, zh TEXT);
    CREATE TABLE cherry_resource_state (entity_type TEXT, entity_id TEXT, archived INTEGER DEFAULT 0, deleted_at TEXT, pinned INTEGER DEFAULT 0, order_key TEXT DEFAULT '', group_id TEXT, owner_id TEXT, last_activity_at TEXT, created_at TEXT, updated_at TEXT, PRIMARY KEY (entity_type, entity_id));
  `)
  db.run('INSERT INTO categories VALUES (?,?)', ['cat', '人物'])
  db.run('INSERT INTO subcategories VALUES (?,?,?)', ['sub', '发型', 'cat'])
  db.run('INSERT INTO tags VALUES (?,?,?,?)', ['tag_hair', 'long hair', '长发', 'sub'])
  db.run('INSERT INTO tags VALUES (?,?,?,?)', ['tag_bad', 'low quality', '低质量', 'sub'])
  db.run('INSERT INTO prompt_assets (id,source_id,source,name,prompt,chapter,section,subsection,nsfw,variant_count,source_fingerprint,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['asset1', 'source1', 'suigu-search-index', '肖像', 'long hair', '人物', '发型', '', 0, 2, '', '2026-01-04', '2026-01-04', 'global'])
  db.run('INSERT INTO history VALUES (?,?,?,?,?)', ['hist1', 'long hair', 1, 0, '2026-01-03'])
  db.run('INSERT INTO presets VALUES (?,?,?,?)', ['preset1', '质量预设', JSON.stringify({ positive: [{ tag_id: 'tag_hair', weight: 1 }], negative: [{ tag_id: 'tag_bad', weight: 1 }] }), '2026-01-02'])
  db.run('INSERT INTO favorites VALUES (?,?)', ['tag_hair', '2026-01-01'])
  return { native, db }
}

describe('prompt asset browser', () => {
  it('aggregates all existing prompt sources without duplicating data', () => {
    const { native, db } = createDatabase()
    const page = queryPromptAssets(db, {})
    expect(page.total).toBe(4)
    expect(new Set(page.items.map(item => item.source))).toEqual(new Set(['asset', 'history', 'preset', 'favorite']))
    expect(page.items.find(item => item.source === 'preset')?.prompt).toContain('--neg low quality')
    native.close()
  })

  it('filters by source, searches text, and treats wildcard characters literally', () => {
    const { native, db } = createDatabase()
    expect(queryPromptAssets(db, { source: 'asset', query: '肖像' }).items).toHaveLength(1)
    expect(queryPromptAssets(db, { query: 'long hair' }).total).toBe(4)
    expect(queryPromptAssets(db, { query: '%' }).total).toBe(0)
    expect(queryPromptAssets(db, { query: String.fromCharCode(92) }).total).toBe(0)
    native.close()
  })

  it('validates paging and source boundaries', () => {
    expect(validatePromptAssetQuery({ limit: 100, offset: 5 }).limit).toBe(100)
    expect(() => validatePromptAssetQuery({ limit: 101 })).toThrow('每页数量')
    expect(() => validatePromptAssetQuery({ source: 'unknown' })).toThrow('来源')
  })

  it('returns stable pages in newest-first order', () => {
    const { native, db } = createDatabase()
    const first = queryPromptAssets(db, { limit: 2, offset: 0 })
    const second = queryPromptAssets(db, { limit: 2, offset: 2 })
    expect(first.items.map(item => item.source)).toEqual(['asset', 'history'])
    expect(second.items.map(item => item.source)).toEqual(['preset', 'favorite'])
    native.close()
  })

  it('ignores malformed legacy preset JSON instead of failing the whole browser', () => {
    const { native, db } = createDatabase()
    db.run('INSERT INTO presets VALUES (?,?,?,?)', ['broken', '损坏预设', '{bad json', '2026-01-05'])
    expect(queryPromptAssets(db, {}).total).toBe(4)
    native.close()
  })

  it('deletes only canvas-owned prompt assets by source reference', () => {
    const { native, db } = createDatabase()
    db.run('INSERT INTO prompt_assets (id,source_id,source,name,prompt,chapter,section,subsection,nsfw,variant_count,source_fingerprint,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['asset2', 'canvas-ref', 'asset', '画布资产', 'blue sky', '', '', '', 0, 0, '', '2026-01-06', '2026-01-06', 'global'])
    db.run('INSERT INTO prompt_assets (id,source_id,source,name,prompt,chapter,section,subsection,nsfw,variant_count,source_fingerprint,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['legacy1', 'canvas-ref', 'suigu-search-index', '外部索引', 'blue sky', '', '', '', 0, 0, '', '2026-01-06', '2026-01-06', 'global'])
    expect(deletePromptAsset(db, 'canvas-ref')).toBe(true)
    expect(queryPromptAssets(db, { source: 'asset' }).items.map(item => item.sourceRef)).not.toContain('canvas-ref')
    expect(db.exec("SELECT source FROM prompt_assets WHERE source_id='canvas-ref'")[0]?.values).toEqual([['suigu-search-index']])
    native.close()
  })
})

describe('prompt asset write protection', () => {
  // A real built-in row carries `source='asset'` exactly like a user-created one — verified
  // against the live library, where all 1,742 imported rows have it. So the discriminator
  // must be the id prefix `createPromptAsset` mints, and these tests pin that.
  it('recognises imported rows, and NOT canvas-created ones', () => {
    // The marker is the builtin_ prefix an importer assigns. An earlier version tested the
    // inverse (`asset:` = user-created) and classified canvas rows as non-user, breaking
    // their deletion — the existing delete test caught it.
    expect(isImportedPromptRow('builtin_01bbb053a8fac80fc510157e')).toBe(true)
    expect(isImportedPromptRow('asset:8e1cf342-8615-49f1-ac2f-315ca4211850')).toBe(false)
    expect(isImportedPromptRow('asset2')).toBe(false)
  })

  it('refuses to edit an imported row even though its source is "asset"', () => {
    const { native, db } = createDatabase()
    // Same `source` value as a user row; only the id distinguishes them.
    db.run('INSERT INTO prompt_assets (id,source_id,source,name,prompt,chapter,section,subsection,nsfw,variant_count,source_fingerprint,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['builtin_abc', 'builtin:pack:x', 'asset', '内置条目', 'content', '', '', '', 0, 0, '', '2026-01-01', '2026-01-01', 'global'])
    expect(updatePromptAsset(db, 'builtin_abc', { name: 'changed' })).toBeNull()
    // And it is genuinely untouched, not merely reported as refused.
    expect(String(native.prepare('SELECT name FROM prompt_assets WHERE id=?').get('builtin_abc')?.name)).toBe('内置条目')
    native.close()
  })

  it('refuses to delete an imported row', () => {
    const { native, db } = createDatabase()
    db.run('INSERT INTO prompt_assets (id,source_id,source,name,prompt,chapter,section,subsection,nsfw,variant_count,source_fingerprint,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['builtin_abc', 'builtin:pack:x', 'asset', '内置条目', 'content', '', '', '', 0, 0, '', '2026-01-01', '2026-01-01', 'global'])
    expect(deletePromptAsset(db, 'builtin:pack:x')).toBe(false)
    // Assert the ROW survived rather than a raw count: the harness seeds its own rows, so a
    // count assertion couples this test to the fixture and says nothing about the row.
    expect(native.prepare('SELECT count(*) c FROM prompt_assets WHERE source_id=?').get('builtin:pack:x')?.c).toBe(1)
    native.close()
  })

  it('edits a user-created row and leaves the untouched field alone', () => {
    const { native, db } = createDatabase()
    db.run('INSERT INTO prompt_assets (id,source_id,source,name,prompt,chapter,section,subsection,nsfw,variant_count,source_fingerprint,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['asset:uuid-1', 'asset-src-1', 'asset', '原名', '原内容', '', '', '', 0, 0, '', '2026-01-01', '2026-01-01', 'global'])
    const updated = updatePromptAsset(db, 'asset:uuid-1', { name: '新名' })
    expect(updated).toMatchObject({ name: '新名', prompt: '原内容' })
    // The stored row agrees with the returned projection.
    const stored = native.prepare('SELECT name, prompt FROM prompt_assets WHERE id=?').get('asset:uuid-1')
    expect(stored).toMatchObject({ name: '新名', prompt: '原内容' })
    native.close()
  })
})

describe('prompt asset ordering', () => {
  function seedTwo() {
    const { native, db } = createDatabase()
    db.run('INSERT INTO prompt_assets (id,source_id,source,name,prompt,chapter,section,subsection,nsfw,variant_count,source_fingerprint,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['asset:a', 'src-a', 'asset', 'A', 'pa', '', '', '', 0, 0, '', '2026-01-02', '2026-01-02', 'global'])
    db.run('INSERT INTO prompt_assets (id,source_id,source,name,prompt,chapter,section,subsection,nsfw,variant_count,source_fingerprint,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['asset:b', 'src-b', 'asset', 'B', 'pb', '', '', '', 0, 0, '', '2026-01-01', '2026-01-01', 'global'])
    return { native, db }
  }

  it('lists in stored-id space, matching what the route compares against', () => {
    const { native, db } = seedTwo()
    // Recency decides the default order (A is newer), and ids come back as stored.
    expect(orderedPromptAssetIds(db)).toEqual(['asset:a', 'asset:b'])
    native.close()
  })

  it('creates a resource-state row for an asset that has none', () => {
    const { native, db } = seedTwo()
    // Assets predating this feature have no projection row; an UPDATE-only write would
    // silently affect zero rows and the move would look applied while changing nothing.
    reorderPromptAsset(db, 'asset:b', { position: 'first' })
    const key = native.prepare("SELECT order_key FROM cherry_resource_state WHERE entity_type='prompt' AND entity_id=?").get('asset:b') as { order_key?: string } | undefined
    expect(key).toBeTruthy()
    expect(String(key?.order_key ?? '').length).toBeGreaterThan(0)
    native.close()
  })

  it('moves an item relative to before/after anchors and to an end', () => {
    const { native, db } = seedTwo()
    expect(orderedPromptAssetIds(db)).toEqual(['asset:a', 'asset:b'])
    reorderPromptAsset(db, 'asset:b', { before: 'asset:a' })
    expect(orderedPromptAssetIds(db)).toEqual(['asset:b', 'asset:a'])
    reorderPromptAsset(db, 'asset:b', { after: 'asset:a' })
    expect(orderedPromptAssetIds(db)).toEqual(['asset:a', 'asset:b'])
    reorderPromptAsset(db, 'asset:b', { position: 'first' })
    expect(orderedPromptAssetIds(db)).toEqual(['asset:b', 'asset:a'])
    native.close()
  })

  it('throws on an unknown anchor rather than appending', () => {
    const { native, db } = seedTwo()
    // A stale client referencing a deleted prompt must not get a silent move-to-end, which
    // would read as success while putting the row somewhere the user did not ask for.
    expect(() => reorderPromptAsset(db, 'asset:b', { before: 'asset:gone' })).toThrow('ORDER_ANCHOR_NOT_FOUND')
    native.close()
  })
})
