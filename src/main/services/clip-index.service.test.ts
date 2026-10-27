import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))

const embedMock = vi.fn()
vi.mock('./clip-worker', () => ({
  clipWorker: { embed: (...args: unknown[]) => embedMock(...args) },
}))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { indexClipEmbeddings } from './clip-index.service'

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-clip-index-'))
  embedMock.mockReset()
})
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

function insertImage(id: number, fileName: string): string {
  const filePath = path.join(root, fileName)
  fs.writeFileSync(filePath, Buffer.from('fake-image'))
  getDatabase().run('INSERT INTO image_refs (id,file_path,storage_mode,available) VALUES (?,?,?,?)', [id, filePath, 'external', 1])
  return filePath
}

describe('indexClipEmbeddings', () => {
  it('embeds unindexed images, writes little-endian float32 BLOB and reports progress', async () => {
    await initDatabase()
    insertImage(1, 'a.png'); insertImage(2, 'b.png')
    const vector = new Float32Array([0.5, -0.25, 1.25, 0])
    embedMock.mockResolvedValue({ model: 'clip-vit-base', dims: 4, vectors: [vector] })
    const progress: Array<[number, number]> = []
    const result = await indexClipEmbeddings(getDatabase(), { batchSize: 2, onProgress: (done, total) => progress.push([done, total]) })
    expect(result).toEqual({ indexed: 2, skipped: 0, failed: 0 })
    expect(embedMock).toHaveBeenCalledTimes(2)
    const row = getDatabase().exec('SELECT model,dims,vector FROM image_embeddings WHERE image_ref_id=1')[0]?.values?.[0] as unknown[]
    expect(String(row[0])).toBe('clip-vit-base')
    expect(Number(row[1])).toBe(4)
    const blob = Buffer.from(row[2] as Uint8Array)
    expect(blob.length).toBe(16)
    expect(blob.readFloatLE(0)).toBeCloseTo(0.5, 5)
    expect(blob.readFloatLE(4)).toBeCloseTo(-0.25, 5)
    expect(progress.at(-1)).toEqual([2, 2])
  })

  it('skips rows already embedded with the same model and counts failures without aborting', async () => {
    await initDatabase()
    insertImage(1, 'a.png'); insertImage(2, 'b.png'); insertImage(3, 'c.png')
    getDatabase().run('INSERT INTO image_embeddings (image_ref_id,model,dims,vector,source,computed_at) VALUES (?,?,?,?,?,?)', [1, 'clip-vit-base', 4, Buffer.alloc(16), 'clip-sidecar', '2026-01-01T00:00:00.000Z'])
    embedMock.mockImplementation(async (paths: string[]) => {
      if (paths[0].endsWith('b.png')) throw new Error('worker down')
      return { model: 'clip-vit-base', dims: 4, vectors: [new Float32Array([0, 0, 0, 1])] }
    })
    const result = await indexClipEmbeddings(getDatabase(), { batchSize: 2, model: 'clip-vit-base' })
    expect(result.indexed).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.failed).toBe(1)
    // 第 3 张仍写入成功（失败未中断批次）。
    expect(getDatabase().exec('SELECT COUNT(*) FROM image_embeddings')[0]?.values?.[0]?.[0]).toBe(2)
  })

  it('skips rows whose stored model differs from the configured model', async () => {
    await initDatabase()
    insertImage(1, 'a.png')
    getDatabase().run('INSERT INTO image_embeddings (image_ref_id,model,dims,vector,source,computed_at) VALUES (?,?,?,?,?,?)', [1, 'old-model', 4, Buffer.alloc(16), 'clip-sidecar', '2026-01-01T00:00:00.000Z'])
    embedMock.mockResolvedValue({ model: 'new-model', dims: 4, vectors: [new Float32Array([1, 0, 0, 0])] })
    const result = await indexClipEmbeddings(getDatabase(), { model: 'new-model' })
    expect(result.indexed).toBe(1)
    expect(String(getDatabase().exec('SELECT model FROM image_embeddings WHERE image_ref_id=1')[0]?.values?.[0]?.[0])).toBe('new-model')
  })

  it('marks missing files as skipped (never attempted) rather than failed', async () => {
    await initDatabase()
    insertImage(1, 'a.png')
    getDatabase().run("INSERT INTO image_refs (id,file_path,storage_mode,available) VALUES (?,?,?,?)", [2, path.join(root, 'missing.png'), 'external', 1])
    embedMock.mockResolvedValue({ model: 'm', dims: 2, vectors: [new Float32Array([1, 0])] })
    const result = await indexClipEmbeddings(getDatabase(), {})
    expect(result.indexed).toBe(1)
    expect(embedMock).toHaveBeenCalledTimes(1)
  })
})
