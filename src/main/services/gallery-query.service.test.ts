import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))
import { closeDatabase, getDatabase, initDatabase } from '../database'
import type { LegacyDatabase } from './sqlite.compat'
import { countGallery, previewMediaBatch, queryGallery } from './gallery-query.service'

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-gallery-query-')) })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

async function seed() {
  await initDatabase()
  const db = getDatabase()
  db.run('INSERT INTO categories (id,group_id,en,zh,sort_order) VALUES (?,?,?,?,?)', ['cat', 'default', 'Character', '人物', 1])
  db.run('INSERT INTO subcategories (id,group_id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?,?)', ['sub', 'default', 'cat', 'Face', '脸部', 1])
  const insertTag = (id: string) =>
    db.run('INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)', [id, 'default', 'sub', id, id, 0, 'builtin'])
  for (const id of ['t1', 't2', 't_base', 't_impl', 't_other']) insertTag(id)
  // t_impl 蕴含 t_base（canonical 方向：source 更具体 -> target 更泛化）。
  db.run('INSERT INTO tag_relations (id,source_tag_id,target_tag_id,relation_type,confidence,source,enabled) VALUES (?,?,?,?,?,?,?)', ['rel_impl', 't_impl', 't_base', 'implication', 1, 'test', 1])

  const insertRef = (id: number, originalName: string, available: number, width: number | null, height: number | null) =>
    db.run('INSERT INTO image_refs (id,file_path,storage_mode,original_name,available,width,height,created_at) VALUES (?,?,?,?,?,?,?,?)', [id, 'C:/gallery/' + originalName, 'external', originalName, available, width, height, '2026-01-01T00:00:00.000Z'])
  insertRef(1, 'sunset.png', 1, 800, 600)
  insertRef(2, 'portrait.png', 1, 512, 768)
  insertRef(3, 'forest.png', 1, null, null)
  insertRef(4, 'cat.png', 1, 1024, 1024)
  insertRef(5, 'dog.png', 0, null, null)

  const insertAsset = (ref: number, title: string, sourceKind: string, favorite: number, rating: number, updatedAt: string) =>
    db.run('INSERT INTO media_assets (id,image_ref_id,source_kind,title,favorite,rating,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', ['media_image_' + ref, ref, sourceKind, title, favorite, rating, 'available', '2026-01-01T00:00:00.000Z', updatedAt])
  insertAsset(1, 'Sunset Beach', 'imported-reference', 1, 5, '2026-01-05T00:00:00.000Z')
  insertAsset(2, 'Portrait', 'generated-api', 1, 5, '2026-01-04T00:00:00.000Z')
  insertAsset(3, 'Forest Walk', 'imported-reference', 0, 3, '2026-01-04T00:00:00.000Z')
  insertAsset(4, 'Cat', 'external-link', 0, 1, '2026-01-02T00:00:00.000Z')
  insertAsset(5, 'Dog', 'imported-reference', 0, 4, '2026-01-01T00:00:00.000Z')

  // 直接写入 asset_ref_id 回填值（v22 投影），asset_key 保留 legacy 形态。
  const insertLink = (ref: number, tagId: string, status = 'accepted') =>
    db.run('INSERT INTO asset_tag_links (id,asset_type,asset_key,tag_id,polarity,source,status,created_at,asset_ref_id) VALUES (?,?,?,?,?,?,?,?,?)', ['link_' + ref + '_' + tagId, 'image', 'image:' + ref, tagId, 'neutral', 'test', status, '2026-01-01T00:00:00.000Z', ref])
  insertLink(1, 't1')
  insertLink(2, 't1')
  insertLink(2, 't2')
  insertLink(3, 't1', 'rejected')
  insertLink(3, 't2')
  insertLink(4, 't_impl')
  insertLink(5, 't_other')
  return db
}

function ids(items: Array<{ imageRefId: number }>): number[] {
  return items.map(item => item.imageRefId)
}

describe('gallery query service', () => {
  it('combines search, source, favorite and rating filters', async () => {
    const db = await seed()
    const hit = queryGallery(db, { search: 'SUN', sourceKinds: ['imported-reference'], favorite: true, minRating: 5 })
    expect(ids(hit.items)).toEqual([1])
    expect(hit.total).toBe(1)
    expect(hit.items[0]).toMatchObject({
      mediaId: 'media_image_1',
      imageRefId: 1,
      title: 'Sunset Beach',
      originalName: 'sunset.png',
      sourceKind: 'imported-reference',
      favorite: true,
      rating: 5,
      available: true,
      width: 800,
      height: 600,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-05T00:00:00.000Z',
    })

    const miss = queryGallery(db, { search: 'sun', sourceKinds: ['generated-api'] })
    expect(miss.items).toEqual([])
    expect(miss.total).toBe(0)
    expect(countGallery(db, { search: 'sun', sourceKinds: ['generated-api'] })).toBe(0)

    const unlinked = queryGallery(db, { sourceKinds: ['imported-reference'], minRating: 1 })
    expect(ids(unlinked.items)).toEqual([1, 3, 5])
    const noLinksRow = unlinked.items.find(item => item.imageRefId === 5)!
    expect(noLinksRow).toMatchObject({ favorite: false, available: false, width: null, height: null })
  })

  it('filters assets by tag ids with any/all/none logic', async () => {
    const db = await seed()
    const any = queryGallery(db, { tagFilter: { tagIds: ['t1'] } })
    expect(ids(any.items)).toEqual([1, 2])
    expect(any.total).toBe(2)

    const all = queryGallery(db, { tagFilter: { tagIds: ['t1', 't2'], logic: 'all' } })
    expect(ids(all.items)).toEqual([2])
    expect(all.total).toBe(1)
    expect(countGallery(db, { tagFilter: { tagIds: ['t1', 't2'], logic: 'all' } })).toBe(1)

    const none = queryGallery(db, { tagFilter: { tagIds: ['t1'], logic: 'none' } })
    expect(ids(none.items)).toEqual([3, 4, 5])
    expect(none.total).toBe(3)

    const noneBoth = queryGallery(db, { tagFilter: { tagIds: ['t1', 't2'], logic: 'none' } })
    expect(ids(noneBoth.items)).toEqual([4, 5])

    const emptyAny = queryGallery(db, { tagFilter: { tagIds: [] } })
    expect(emptyAny).toEqual({ items: [], total: 0 })
    expect(countGallery(db, { tagFilter: { tagIds: [] } })).toBe(0)
    const emptyNone = queryGallery(db, { tagFilter: { tagIds: [], logic: 'none' } })
    expect(emptyNone.total).toBe(5)
  })

  it('expands implied descendants when includeImplied is set', async () => {
    const db = await seed()
    const direct = queryGallery(db, { tagFilter: { tagIds: ['t_base'] } })
    expect(direct).toEqual({ items: [], total: 0 })

    const implied = queryGallery(db, { tagFilter: { tagIds: ['t_base'], includeImplied: true } })
    expect(ids(implied.items)).toEqual([4])
    expect(implied.total).toBe(1)
    expect(countGallery(db, { tagFilter: { tagIds: ['t_base'], includeImplied: true } })).toBe(1)
  })

  it('paginates with totals and a stable tiebreak order', async () => {
    const db = await seed()
    // updated_at: ref2 与 ref3 相同 -> 以 m.id ASC 稳定排序。
    const first = queryGallery(db, { sort: 'updated', order: 'desc' }, { limit: 2, offset: 0 })
    expect(ids(first.items)).toEqual([1, 2])
    expect(first.total).toBe(5)
    const second = queryGallery(db, { sort: 'updated', order: 'desc' }, { limit: 2, offset: 2 })
    expect(ids(second.items)).toEqual([3, 4])
    expect(second.total).toBe(5)
    const third = queryGallery(db, { sort: 'updated', order: 'desc' }, { limit: 2, offset: 4 })
    expect(ids(third.items)).toEqual([5])

    const byName = queryGallery(db, { sort: 'name', order: 'asc' }, { limit: 10 })
    expect(ids(byName.items)).toEqual([4, 5, 3, 2, 1])

    const byRating = queryGallery(db, { sort: 'rating', order: 'desc' }, { limit: 10 })
    expect(ids(byRating.items)).toEqual([1, 2, 5, 3, 4])
  })

  it('falls back to updated sort when sort values are outside the whitelist', async () => {
    const db = await seed()
    const fallback = queryGallery(db, { sort: 'bogus' as never, order: 'sideways' as never })
    const explicit = queryGallery(db, { sort: 'updated', order: 'desc' })
    expect(ids(fallback.items)).toEqual(ids(explicit.items))
    expect(ids(fallback.items)).toEqual([1, 2, 3, 4, 5])
    expect(fallback.total).toBe(5)
  })

  it('parameterizes search so injected SQL text cannot run', async () => {
    const db = await seed()
    const attack = queryGallery(db, { search: "x'; DROP TABLE media_assets;--" })
    expect(attack.items).toEqual([])
    expect(attack.total).toBe(0)
    expect(Number(db.exec('SELECT COUNT(*) FROM media_assets')[0]?.values?.[0]?.[0])).toBe(5)
    expect(Number(db.exec('SELECT COUNT(*) FROM asset_tag_links')[0]?.values?.[0]?.[0])).toBe(7)
    // 表未被破坏，后续查询仍然可用。
    expect(queryGallery(db, { tagFilter: { tagIds: ['t1'] } }).total).toBe(2)
  })

  it('uses an indexed asset_tag_links plan for tagFilter queries (EXPLAIN regression)', async () => {
    const db = await seed()
    const captured: Array<{ sql: string; params: unknown[] }> = []
    const recorder: LegacyDatabase = {
      exec: (sql, parameters) => { captured.push({ sql, params: parameters || [] }); return db.exec(sql, parameters) },
      run: (sql, parameters) => db.run(sql, parameters),
      prepare: sql => db.prepare(sql),
    }
    const result = queryGallery(recorder, { tagFilter: { tagIds: ['t1', 't2'] } })
    expect(ids(result.items)).toEqual([1, 2, 3])

    const pageEntry = captured.find(entry => /ORDER BY/i.test(entry.sql))
    expect(pageEntry).toBeDefined()
    const planResult = db.exec(`EXPLAIN QUERY PLAN ${pageEntry!.sql}`, pageEntry!.params)[0]
    const detailIndex = planResult.columns.indexOf('detail')
    expect(detailIndex).toBeGreaterThanOrEqual(0)
    const planText = planResult.values.map(row => String(row[detailIndex])).join('\n').toLowerCase()
    expect(planText).not.toContain('scan asset_tag_links')
    expect(planText).toMatch(/using index|idx_asset_tag_links/)
  })

  it('previews batches by ids or query', async () => {
    const db = await seed()
    expect(previewMediaBatch(db, { ids: ['media_image_1', 'media_image_2', 'media_image_1', ' ', ''] })).toEqual({ assets: 2 })
    expect(previewMediaBatch(db, { ids: [] })).toEqual({ assets: 0 })
    expect(previewMediaBatch(db, { query: { sourceKinds: ['imported-reference'] } })).toEqual({ assets: 3 })
    expect(previewMediaBatch(db, { query: { tagFilter: { tagIds: ['t1', 't2'], logic: 'all' } } })).toEqual({ assets: 1 })
  })

  it('excludes assets carrying excludeTagIds independently of tagIds', async () => {
    await initDatabase()
    const db = getDatabase()
    db.run('INSERT INTO categories (id,group_id,en,zh,sort_order) VALUES (?,?,?,?,?)', ['cat', 'default', 'Character', '人物', 1])
    db.run('INSERT INTO subcategories (id,group_id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?,?)', ['sub', 'default', 'cat', 'Face', '脸部', 1])
    const insertTag = (id: string) =>
      db.run('INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)', [id, 'default', 'sub', id, id, 0, 'builtin'])
    insertTag('t1')
    insertTag('t3')

    // 两资产：A(带 t1)、B(带 t3)。
    const insertRef = (id: number, originalName: string) =>
      db.run('INSERT INTO image_refs (id,file_path,storage_mode,original_name,available,width,height,created_at) VALUES (?,?,?,?,?,?,?,?)', [id, 'C:/gallery/' + originalName, 'external', originalName, 1, null, null, '2026-01-01T00:00:00.000Z'])
    insertRef(1, 'a.png')
    insertRef(2, 'b.png')
    const insertAsset = (ref: number, title: string) =>
      db.run('INSERT INTO media_assets (id,image_ref_id,source_kind,title,favorite,rating,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', ['media_image_' + ref, ref, 'imported-reference', title, 0, 0, 'available', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'])
    insertAsset(1, 'Asset A')
    insertAsset(2, 'Asset B')
    const insertLink = (ref: number, tagId: string) =>
      db.run('INSERT INTO asset_tag_links (id,asset_type,asset_key,tag_id,polarity,source,status,created_at,asset_ref_id) VALUES (?,?,?,?,?,?,?,?,?)', ['link_' + ref + '_' + tagId, 'image', 'image:' + ref, tagId, 'neutral', 'test', 'accepted', '2026-01-01T00:00:00.000Z', ref])
    insertLink(1, 't1')
    insertLink(2, 't3')

    // include 与 exclude 同时生效：命中 t1 且排除 t3 -> 只回 A。
    const mixed = queryGallery(db, { tagFilter: { tagIds: ['t1'], logic: 'any', excludeTagIds: ['t3'] } })
    expect(ids(mixed.items)).toEqual([1])
    expect(mixed.total).toBe(1)
    expect(countGallery(db, { tagFilter: { tagIds: ['t1'], logic: 'any', excludeTagIds: ['t3'] } })).toBe(1)

    // excludeTagIds 独立生效：仅排除 t1（无 include 标签）-> 回 B。
    const excludeOnly = queryGallery(db, { tagFilter: { tagIds: [], logic: 'any', excludeTagIds: ['t1'] } })
    expect(ids(excludeOnly.items)).toEqual([2])
    expect(excludeOnly.total).toBe(1)

    // 换成 excludeTagIds:['t1'] 且 include 命中的是 B 的标签 -> 回 B。
    const flipped = queryGallery(db, { tagFilter: { tagIds: ['t3'], logic: 'any', excludeTagIds: ['t1'] } })
    expect(ids(flipped.items)).toEqual([2])
    expect(flipped.total).toBe(1)

    // logic 'none' + excludeTagIds 可并存（冗余但不特判）：两处都排除 t1 -> 回 B。
    const noneRedundant = queryGallery(db, { tagFilter: { tagIds: ['t1'], logic: 'none', excludeTagIds: ['t1'] } })
    expect(ids(noneRedundant.items)).toEqual([2])
    expect(noneRedundant.total).toBe(1)
  })
})