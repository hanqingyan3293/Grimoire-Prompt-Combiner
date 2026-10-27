import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))
import { closeDatabase, getDatabase, initDatabase } from '../database'
import { applyTagBatch, previewTagBatch } from './tag-batch.service'
import { listAssetTagLinks } from './tag-intelligence.service'

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-tag-batch-')) })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

async function seed() {
  await initDatabase()
  const db = getDatabase()
  db.run('INSERT INTO categories (id,group_id,en,zh,sort_order) VALUES (?,?,?,?,?)', ['cat', 'default', 'Character', '人物', 1])
  db.run('INSERT INTO subcategories (id,group_id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?,?)', ['sub', 'default', 'cat', 'Face', '脸部', 1])
  const insertTag = (id: string, en: string) =>
    db.run('INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)', [id, 'default', 'sub', en, en, 1, 'builtin'])
  insertTag('t1', '1girl')
  insertTag('t2', 'solo')
  insertTag('t3', 'smile')
  const insertRef = (id: number, file: string) =>
    db.run("INSERT INTO image_refs (id,file_path,storage_mode,available) VALUES (?,?,?,?)", [id, file, 'managed', 1])
  insertRef(1, 'a.png')
  insertRef(2, 'b.png')
  insertRef(3, 'c.png')
  insertRef(4, 'd.png')
  const insertLink = (id: string, key: string, tagId: string) =>
    db.run('INSERT INTO asset_tag_links (id,asset_type,asset_key,tag_id,polarity,source,status,created_at) VALUES (?,?,?,?,?,?,?,?)', [id, 'image', key, tagId, 'neutral', 'test', 'accepted', '2026-01-01T00:00:00.000Z'])
  insertLink('l1', 'image:1', 't1')
  insertLink('l2', 'image:2', 't1')
  insertLink('l3', 'image:2', 't2')
  insertLink('l4', 'image:4', 't2')
  return db
}

describe('tag batch service', () => {
  it('previews a dry run with totals, sample and operation estimate', async () => {
    const db = await seed()
    const preview = previewTagBatch(db, {
      filter: { assetType: 'image', tagIds: ['t1'], logic: 'any' },
      operation: { type: 'add', tagIds: ['t3'] },
    })
    expect(preview.total).toBe(2)
    expect(preview.operationCount).toBe(2)
    expect(preview.sample.sort()).toEqual(['image:1', 'image:2'])
  })

  it('applies add, remove and replace in chunked form', async () => {
    const db = await seed()
    const addResult = applyTagBatch(db, {
      filter: { assetType: 'image', tagIds: ['t1'], logic: 'any' },
      operation: { type: 'add', tagIds: ['t3'] },
      chunkSize: 1,
    })
    expect(addResult).toEqual({ total: 2, applied: 2, tagsTouched: ['t3'] })
    expect(listAssetTagLinks(db, 'image', 'image:1').map(link => link.tagId).sort()).toEqual(['t1', 't3'])

    const replaceResult = applyTagBatch(db, {
      filter: { assetType: 'image', tagIds: ['t2'], logic: 'any' },
      operation: { type: 'replace', fromTagId: 't2', toTagId: 't3' },
      chunkSize: 1,
    })
    expect(replaceResult.tagsTouched).toEqual(['t2', 't3'])
    expect(listAssetTagLinks(db, 'image', 'image:2').map(link => link.tagId).sort()).toEqual(['t1', 't3'])
    expect(listAssetTagLinks(db, 'image', 'image:4').map(link => link.tagId)).toEqual(['t3'])

    const removeResult = applyTagBatch(db, {
      filter: { assetType: 'image', tagIds: ['t3'], logic: 'any' },
      operation: { type: 'remove', tagIds: ['t3'] },
    })
    expect(removeResult.applied).toBe(3)
    expect(listAssetTagLinks(db, 'image', 'image:4')).toEqual([])
  })

  it('targets only empty assets from the registry scope', async () => {
    const db = await seed()
    const preview = previewTagBatch(db, {
      filter: { assetType: 'image', tagIds: [], logic: 'any' },
      operation: { type: 'add', tagIds: ['t3'] },
      onlyEmpty: true,
    })
    expect(preview.total).toBe(1)
    expect(preview.sample).toEqual(['image:3'])

    const result = applyTagBatch(db, {
      filter: { assetType: 'image', tagIds: [], logic: 'any' },
      operation: { type: 'add', tagIds: ['t3'] },
      onlyEmpty: true,
    })
    expect(result.applied).toBe(1)
    expect(listAssetTagLinks(db, 'image', 'image:3').map(link => link.tagId)).toEqual(['t3'])
    expect(listAssetTagLinks(db, 'image', 'image:1').map(link => link.tagId)).toEqual(['t1'])
  })

  it('rejects invalid operations', async () => {
    const db = await seed()
    expect(() => previewTagBatch(db, { filter: { assetType: 'image', tagIds: ['t1'] }, operation: { type: 'add', tagIds: [] } })).toThrow('批量操作需要至少一个标签')
    expect(() => previewTagBatch(db, { filter: { assetType: 'image', tagIds: ['t1'] }, operation: { type: 'replace', fromTagId: 't1', toTagId: 't1' } })).toThrow('替换操作的源标签和目标标签不能相同')
  })
})