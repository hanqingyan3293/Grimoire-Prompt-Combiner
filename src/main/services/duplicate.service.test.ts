import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { findDuplicateGroups } from './duplicate.service'

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-duplicate-')) })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

function insertImage(id: number): void {
  getDatabase().run('INSERT INTO image_refs (id,file_path,storage_mode,available) VALUES (?,?,?,?)', [id, path.join(root, id + '.png'), 'external', 1])
}
function insertHash(id: number, dhash: string): void {
  getDatabase().run('INSERT INTO image_perceptual_hashes (image_ref_id,dhash,color_histogram,width,height,computed_at) VALUES (?,?,?,?,?,?)', [id, dhash, '[0.5]', 8, 8, '2026-01-01T00:00:00.000Z'])
}

describe('findDuplicateGroups', () => {
  it('groups near-identical hashes and leaves singles out', async () => {
    await initDatabase()
    for (let id = 1; id <= 4; id += 1) insertImage(id)
    insertHash(1, 'ffffffffffffffff')
    insertHash(2, 'fffffffffffffffe') // 距 1: 1 bit
    insertHash(3, 'fffffffffffffff0') // 距 1: 4 bit
    insertHash(4, '0000000000000000') // 距 1: 64 bit
    const result = findDuplicateGroups(getDatabase(), { maxDistance: 6 })
    expect(result.total).toBe(1)
    expect(result.groups[0].imageRefIds).toEqual([1, 2, 3])
    expect(result.groups[0].hash).toBe('ffffffffffffffff')
  })

  it('respects the maxDistance threshold', async () => {
    await initDatabase()
    insertImage(1); insertImage(2)
    insertHash(1, 'ffffffffffffffff')
    insertHash(2, 'fffffffffffffff0') // 4 bit apart
    expect(findDuplicateGroups(getDatabase(), { maxDistance: 3 }).total).toBe(0)
    expect(findDuplicateGroups(getDatabase(), { maxDistance: 4 }).total).toBe(1)
  })

  it('supports pagination over groups ordered by size', async () => {
    await initDatabase()
    // 大组：3 张；小组：2 张
    for (let id = 1; id <= 5; id += 1) insertImage(id)
    insertHash(1, 'aaaaaaaaaaaaaaaa')
    insertHash(2, 'aaaaaaaaaaaaaaab')
    insertHash(3, 'aaaaaaaaaaaaaaac')
    insertHash(4, '1111000000000000')
    insertHash(5, '1111000000000001')
    const page0 = findDuplicateGroups(getDatabase(), { maxDistance: 6, limit: 1, page: 0 })
    expect(page0.total).toBe(2)
    expect(page0.groups[0].imageRefIds).toEqual([1, 2, 3])
    const page1 = findDuplicateGroups(getDatabase(), { maxDistance: 6, limit: 1, page: 1 })
    expect(page1.groups[0].imageRefIds).toEqual([4, 5])
  })

  it('ignores malformed hashes instead of failing the query', async () => {
    await initDatabase()
    insertImage(1); insertImage(2); insertImage(3)
    insertHash(1, 'ffffffffffffffff')
    insertHash(2, 'fffffffffffffffe')
    getDatabase().run('INSERT INTO image_perceptual_hashes (image_ref_id,dhash,color_histogram,width,height,computed_at) VALUES (?,?,?,?,?,?)', [3, 'not-a-hash', '[]', 8, 8, '2026-01-01T00:00:00.000Z'])
    const result = findDuplicateGroups(getDatabase(), {})
    expect(result.total).toBe(1)
    expect(result.groups[0].imageRefIds).toEqual([1, 2])
  })
})
