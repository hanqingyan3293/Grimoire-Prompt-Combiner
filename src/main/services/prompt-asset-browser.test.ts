import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createLegacyDatabase } from './sqlite.compat'
import { deletePromptAsset, queryPromptAssets, validatePromptAssetQuery } from './prompt-asset-browser'

function createDatabase() {
  const native = new DatabaseSync(':memory:')
  const db = createLegacyDatabase(native)
  db.exec(`
    CREATE TABLE prompt_assets (id TEXT, source_id TEXT, source TEXT, name TEXT, prompt TEXT, chapter TEXT, section TEXT, subsection TEXT, nsfw INTEGER, variant_count INTEGER, created_at TEXT);
    CREATE TABLE history (id TEXT, prompt TEXT, positive_count INTEGER, negative_count INTEGER, created_at TEXT);
    CREATE TABLE presets (id TEXT, name TEXT, data TEXT, updated_at TEXT);
    CREATE TABLE favorites (tag_id TEXT, created_at TEXT);
    CREATE TABLE tags (id TEXT, en TEXT, zh TEXT, subcategory_id TEXT);
    CREATE TABLE subcategories (id TEXT, zh TEXT, category_id TEXT);
    CREATE TABLE categories (id TEXT, zh TEXT);
  `)
  db.run('INSERT INTO categories VALUES (?,?)', ['cat', '人物'])
  db.run('INSERT INTO subcategories VALUES (?,?,?)', ['sub', '发型', 'cat'])
  db.run('INSERT INTO tags VALUES (?,?,?,?)', ['tag_hair', 'long hair', '长发', 'sub'])
  db.run('INSERT INTO tags VALUES (?,?,?,?)', ['tag_bad', 'low quality', '低质量', 'sub'])
  db.run('INSERT INTO prompt_assets VALUES (?,?,?,?,?,?,?,?,?,?,?)', ['asset1', 'source1', 'suigu-search-index', '肖像', 'long hair', '人物', '发型', '', 0, 2, '2026-01-04'])
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
    db.run('INSERT INTO prompt_assets VALUES (?,?,?,?,?,?,?,?,?,?,?)', ['asset2', 'canvas-ref', 'asset', '画布资产', 'blue sky', '', '', '', 0, 0, '2026-01-06'])
    db.run('INSERT INTO prompt_assets VALUES (?,?,?,?,?,?,?,?,?,?,?)', ['legacy1', 'canvas-ref', 'suigu-search-index', '外部索引', 'blue sky', '', '', '', 0, 0, '2026-01-06'])
    expect(deletePromptAsset(db, 'canvas-ref')).toBe(true)
    expect(queryPromptAssets(db, { source: 'asset' }).items.map(item => item.sourceRef)).not.toContain('canvas-ref')
    expect(db.exec("SELECT source FROM prompt_assets WHERE source_id='canvas-ref'")[0]?.values).toEqual([['suigu-search-index']])
    native.close()
  })
})
