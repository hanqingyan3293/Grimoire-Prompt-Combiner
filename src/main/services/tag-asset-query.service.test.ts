import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))
import { closeDatabase, getDatabase, initDatabase } from '../database'
import { listAssetLinksBatch, queryAssetKeysByTags } from './tag-asset-query.service'

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-tag-asset-query-')) })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

async function seed() {
  await initDatabase()
  const db = getDatabase()
  db.run('INSERT INTO categories (id,group_id,en,zh,sort_order) VALUES (?,?,?,?,?)', ['cat', 'default', 'Character', '人物', 1])
  db.run('INSERT INTO subcategories (id,group_id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?,?)', ['sub', 'default', 'cat', 'Face', '脸部', 1])
  const insertTag = (id: string, en: string, order: number) =>
    db.run('INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)', [id, 'default', 'sub', en, en, order, 'builtin'])
  insertTag('t1', '1girl', 1)
  insertTag('t2', 'solo', 2)
  insertTag('t_base', 'base', 3)
  insertTag('t_impl', 'implied', 4)
  db.run('INSERT INTO tag_relations (id,source_tag_id,target_tag_id,relation_type,confidence,source,enabled) VALUES (?,?,?,?,?,?,?)', ['rel_impl', 't_impl', 't_base', 'implication', 1, 'test', 1])
  const insertLink = (id: string, key: string, tagId: string, status = 'accepted') =>
    db.run('INSERT INTO asset_tag_links (id,asset_type,asset_key,tag_id,polarity,source,status,created_at) VALUES (?,?,?,?,?,?,?,?)', [id, 'image', key, tagId, 'neutral', 'test', status, '2026-01-01T00:00:00.000Z'])
  insertLink('l1', 'image:1', 't1')
  insertLink('l2', 'image:2', 't1')
  insertLink('l3', 'image:2', 't2')
  insertLink('l4', 'image:3', 't2', 'rejected')
  insertLink('l5', 'image:4', 't2')
  insertLink('l6', 'image:5', 't_impl')
  return db
}

describe('tag asset query service', () => {
  it('queries assets by tags with any/all/none logic', async () => {
    const db = await seed()
    const any = queryAssetKeysByTags(db, { assetType: 'image', tagIds: ['t1'] })
    expect(any.keys.map(key => key.assetKey)).toEqual(['image:1', 'image:2'])
    expect(any.total).toBe(2)

    const all = queryAssetKeysByTags(db, { assetType: 'image', tagIds: ['t1', 't2'], logic: 'all' })
    expect(all.keys.map(key => key.assetKey)).toEqual(['image:2'])
    expect(all.keys[0]?.matchedCount).toBe(2)

    const none = queryAssetKeysByTags(db, { assetType: 'image', tagIds: ['t1'], logic: 'none' })
    expect(none.keys.map(key => key.assetKey)).toEqual(['image:4', 'image:5'])
    expect(none.total).toBe(2)
  })

  it('expands implied descendants when filtering', async () => {
    const db = await seed()
    const direct = queryAssetKeysByTags(db, { assetType: 'image', tagIds: ['t_base'] })
    expect(direct.keys).toEqual([])
    const implied = queryAssetKeysByTags(db, { assetType: 'image', tagIds: ['t_base'], includeImplied: true })
    expect(implied.keys.map(key => key.assetKey)).toEqual(['image:5'])
  })

  it('paginates stably and returns totals', async () => {
    const db = await seed()
    const first = queryAssetKeysByTags(db, { assetType: 'image', tagIds: ['t1', 't2'] }, { limit: 1, offset: 0 })
    expect(first.keys.map(key => key.assetKey)).toEqual(['image:1'])
    expect(first.total).toBe(3)
    const second = queryAssetKeysByTags(db, { assetType: 'image', tagIds: ['t1', 't2'] }, { limit: 1, offset: 1 })
    expect(second.keys.map(key => key.assetKey)).toEqual(['image:2'])
  })

  it('lists asset links in batches without N+1 lookups', async () => {
    const db = await seed()
    const batch = listAssetLinksBatch(db, 'image', ['image:2', 'image:3', 'image:9'])
    expect(batch[0]?.tagIds).toEqual(['t1', 't2'])
    expect(batch[1]?.tagIds).toEqual([])
    expect(batch[1]?.links).toMatchObject([{ tagId: 't2', status: 'rejected' }])
    expect(batch[2]).toEqual({ assetKey: 'image:9', tagIds: [], links: [] })
    expect(listAssetLinksBatch(db, 'image', [])).toEqual([])
  })
})