import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))
import { closeDatabase, getDatabase, initDatabase } from '../database'
import { indexPerceptualHashes, querySimilarImages } from './similarity.service'

// ---------- 测试辅助：最小 RGB 8-bit PNG 编码（filter 0，风格同 media-metadata.core.test） ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

function buildPng(width: number, height: number, sample: (x: number, y: number) => number[]): Buffer {
  const rows: Buffer[] = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = sample(x, y)
      row[1 + x * 3] = r
      row[2 + x * 3] = g
      row[3 + x * 3] = b
    }
    rows.push(row)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function writePngFile(filePath: string, width = 12, height = 12, sample: (x: number, y: number) => number[] = (x, y) => [x * 20, y * 20, 64]): number {
  const png = buildPng(width, height, sample)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, png)
  return png.length
}

function registerImageRef(filePath: string, mime = 'image/png'): number {
  getDatabase().run('INSERT INTO image_refs (file_path,storage_mode,mime_type,file_size,original_name,available) VALUES (?,?,?,?,?,?)', [filePath, 'external', mime, 100, path.basename(filePath), 1])
  return Number(getDatabase().exec('SELECT last_insert_rowid()')[0].values[0][0])
}

function hashRow(imageRefId: number): unknown[] | undefined {
  return getDatabase().exec('SELECT dhash,color_histogram,width,height FROM image_perceptual_hashes WHERE image_ref_id=?', [imageRefId])[0]?.values?.[0]
}

// 64 桶直方图字符串：指定桶为 1，其余为 0
function histogramString(bucket: number): string {
  const bins = new Array(64).fill(0)
  bins[bucket] = 1
  return JSON.stringify(bins)
}

function insertHash(imageRefId: number, dhash: string, colorHistogram = histogramString(0)): void {
  getDatabase().run('INSERT INTO image_perceptual_hashes (image_ref_id,dhash,color_histogram,width,height,computed_at) VALUES (?,?,?,?,?,?)', [imageRefId, dhash, colorHistogram, 8, 8, '2026-01-01T00:00:00.000Z'])
}

// Float32 小端 BLOB（schema v30 的 vector 编码）
function float32Blob(values: number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 4)
  for (let index = 0; index < values.length; index++) buffer.writeFloatLE(values[index], index * 4)
  return buffer
}

function insertEmbedding(imageRefId: number, values: number[], model = 'clip-vit-b32'): void {
  getDatabase().run('INSERT INTO image_embeddings (image_ref_id,model,dims,vector,source,computed_at) VALUES (?,?,?,?,?,?)', [imageRefId, model, values.length, float32Blob(values), 'clip-sidecar', '2026-01-01T00:00:00.000Z'])
}

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-similarity-')) })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

describe('indexPerceptualHashes', () => {
  it('indexes readable PNGs, writes hash rows and reports progress per batch', async () => {
    await initDatabase()
    const first = registerImageRef(path.join(root, 'images', 'a.png'))
    writePngFile(path.join(root, 'images', 'a.png')) // 从左到右变亮：dhash 全 0
    const second = registerImageRef(path.join(root, 'images', 'b.png'))
    writePngFile(path.join(root, 'images', 'b.png'), 12, 12, x => [255 - x * 20, 30, 64]) // 从左到右变暗：dhash 全 1

    const progress: Array<{ done: number; total: number }> = []
    const summary = await indexPerceptualHashes(getDatabase(), { batchSize: 1, onProgress: (done, total) => progress.push({ done, total }) })

    expect(summary).toEqual({ indexed: 2, skipped: 0, failed: 0 })
    expect(progress).toEqual([{ done: 1, total: 2 }, { done: 2, total: 2 }])
    const row = hashRow(first)
    expect(row).toBeTruthy()
    expect(String(row![0])).toMatch(/^[0-9a-f]{16}$/)
    const histogram = JSON.parse(String(row![1])) as number[]
    expect(histogram).toHaveLength(64)
    // 每桶 4 位小数取整，64 桶累计误差上限 64 * 5e-5
    expect(histogram.reduce((sum, entry) => sum + entry, 0)).toBeCloseTo(1, 3)
    expect(Number(row![2])).toBe(12)
    expect(Number(row![3])).toBe(12)
    expect(hashRow(second)).toBeTruthy()
    // 反向渐变与原渐变相反：dhash 全 1 与全 0 互为镜像
    expect(String(hashRow(first)![0])).toBe('0000000000000000')
    expect(String(hashRow(second)![0])).toBe('ffffffffffffffff')
  })

  it('skips rows that already exist on a second run', async () => {
    await initDatabase()
    const imageId = registerImageRef(path.join(root, 'images', 'repeat.png'))
    writePngFile(path.join(root, 'images', 'repeat.png'))

    const first = await indexPerceptualHashes(getDatabase())
    expect(first).toEqual({ indexed: 1, skipped: 0, failed: 0 })
    const hashBefore = String(hashRow(imageId)![0])

    const second = await indexPerceptualHashes(getDatabase())
    expect(second).toEqual({ indexed: 0, skipped: 1, failed: 0 })
    expect(String(hashRow(imageId)![0])).toBe(hashBefore)
  })

  it('counts unreadable and undecodable files as failed without aborting the batch', async () => {
    await initDatabase()
    const missingId = registerImageRef(path.join(root, 'images', 'missing.png'))
    const garbagePath = path.join(root, 'images', 'garbage.png')
    fs.mkdirSync(path.dirname(garbagePath), { recursive: true })
    fs.writeFileSync(garbagePath, Buffer.from('this is not a png'))
    const garbageId = registerImageRef(garbagePath)
    const goodPath = path.join(root, 'images', 'good.png')
    const goodId = registerImageRef(goodPath)
    writePngFile(goodPath)

    const summary = await indexPerceptualHashes(getDatabase(), { batchSize: 10 })
    expect(summary).toEqual({ indexed: 1, skipped: 0, failed: 2 })
    expect(hashRow(missingId)).toBeUndefined()
    expect(hashRow(garbageId)).toBeUndefined()
    expect(hashRow(goodId)).toBeTruthy()
  })
})

describe('querySimilarImages', () => {
  it('ranks by combined distance ascending with score = 1 - distance and excludes the target', async () => {
    await initDatabase()
    const targetId = registerImageRef(path.join(root, 'target.png'))
    insertHash(targetId, '0000000000000000')
    const identicalId = registerImageRef(path.join(root, 'identical.png'))
    insertHash(identicalId, '0000000000000000')
    const nearId = registerImageRef(path.join(root, 'near.png'))
    insertHash(nearId, '000000000000000f') // 4 位不同 → 0.7 * 4/64 = 0.04375
    const farId = registerImageRef(path.join(root, 'far.png'))
    insertHash(farId, 'ffffffffffffffff') // 64 位不同 → 0.7

    // 默认 maxDistance 0.35：distance 0.7 的 far 图被过滤
    const result = await querySimilarImages(getDatabase(), { imageRefId: targetId, method: 'auto' })
    expect(result.method).toBe('hash')
    expect(result.items.map(item => item.imageRefId)).toEqual([identicalId, nearId])
    expect(result.items[0].distance).toBe(0)
    expect(result.items[0].score).toBe(1)
    expect(result.items[1].distance).toBeCloseTo(0.04375, 6)
    expect(result.items[1].score).toBeCloseTo(1 - 0.04375, 6)
    expect(result.items.some(item => item.imageRefId === targetId)).toBe(false)

    // 放宽阈值后 far 排在最后
    const all = await querySimilarImages(getDatabase(), { imageRefId: targetId, maxDistance: 1 })
    expect(all.items.map(item => item.imageRefId)).toEqual([identicalId, nearId, farId])
    expect(all.items[2].distance).toBeCloseTo(0.7, 6)
  })

  it('applies maxDistance and limit', async () => {
    await initDatabase()
    const targetId = registerImageRef(path.join(root, 'target.png'))
    insertHash(targetId, '0000000000000000')
    const nearId = registerImageRef(path.join(root, 'near.png'))
    insertHash(nearId, '000000000000000f')
    const midId = registerImageRef(path.join(root, 'mid.png'))
    insertHash(midId, '0000000000000fff')
    const farId = registerImageRef(path.join(root, 'far.png'))
    insertHash(farId, 'ffffffffffffffff')

    const filtered = await querySimilarImages(getDatabase(), { imageRefId: targetId, maxDistance: 0.2 })
    expect(filtered.items.map(item => item.imageRefId)).toEqual([nearId, midId])
    const limited = await querySimilarImages(getDatabase(), { imageRefId: targetId, limit: 1 })
    expect(limited.items.map(item => item.imageRefId)).toEqual([nearId])
  })

  it('skips malformed hash rows and returns empty when the target has no hash', async () => {
    await initDatabase()
    const targetId = registerImageRef(path.join(root, 'target.png'))
    insertHash(targetId, '0000000000000000')
    const brokenId = registerImageRef(path.join(root, 'broken.png'))
    insertHash(brokenId, 'not-a-hash-row')
    const shortId = registerImageRef(path.join(root, 'short.png'))
    insertHash(shortId, '0f0f')
    const noHashId = registerImageRef(path.join(root, 'nohash.png'))

    const result = await querySimilarImages(getDatabase(), { imageRefId: targetId })
    expect(result.items).toEqual([])
    const missing = await querySimilarImages(getDatabase(), { imageRefId: noHashId })
    expect(missing).toEqual({ method: 'hash', items: [] })
    await expect(querySimilarImages(getDatabase(), { imageRefId: 0 })).rejects.toThrow('imageRefId')
  })

  it("falls back to method 'hash' for method 'clip' when no comparable embeddings exist", async () => {
    await initDatabase()
    const targetId = registerImageRef(path.join(root, 'target.png'))
    insertHash(targetId, '0000000000000000')
    const otherId = registerImageRef(path.join(root, 'other.png'))
    insertHash(otherId, '000000000000000f')
    // 目标图有自己的嵌入但库里没有其他可比嵌入 → 仍回落 hash
    insertEmbedding(targetId, [1, 0, 0, 0])
    insertEmbedding(otherId, [0, 1, 0, 0], 'different-model')

    const result = await querySimilarImages(getDatabase(), { imageRefId: targetId, method: 'clip' })
    expect(result.method).toBe('hash')
    expect(result.items.map(item => item.imageRefId)).toEqual([otherId])
  })

  it('uses cosine similarity over embeddings when the target and candidates share a model', async () => {
    await initDatabase()
    const targetId = registerImageRef(path.join(root, 'target.png'))
    insertHash(targetId, '0000000000000000')
    insertEmbedding(targetId, [1, 0, 0, 0])
    const alignedId = registerImageRef(path.join(root, 'aligned.png'))
    insertHash(alignedId, 'ffffffffffffffff') // hash 很远，但嵌入很近 → clip 通道应排前
    insertEmbedding(alignedId, [0.9, 0.1, 0, 0])
    const orthogonalId = registerImageRef(path.join(root, 'orthogonal.png'))
    insertHash(orthogonalId, 'ffffffffffffffff')
    insertEmbedding(orthogonalId, [0, 1, 0, 0])

    // 默认阈值 0.35 下 orthogonal（cos 0 → distance 1）被过滤
    const result = await querySimilarImages(getDatabase(), { imageRefId: targetId, maxDistance: 1 })
    expect(result.method).toBe('clip')
    expect(result.items.map(item => item.imageRefId)).toEqual([alignedId, orthogonalId])
    expect(result.items[0].score).toBeCloseTo(0.99388, 4)
    expect(result.items[0].distance).toBeCloseTo(1 - 0.99388, 4)
    expect(result.items[1].score).toBeCloseTo(0, 6)

    // method 'hash' 时忽略嵌入，仍走 dhash 通道（两候选 dhash 相同 → 同距离，按 id 升序）
    const hashResult = await querySimilarImages(getDatabase(), { imageRefId: targetId, method: 'hash', maxDistance: 1 })
    expect(hashResult.method).toBe('hash')
    expect(hashResult.items.map(item => item.imageRefId)).toEqual([alignedId, orthogonalId])
    expect(hashResult.items[0].distance).toBeCloseTo(0.7, 6)
  })

  it('respects maxDistance on the clip channel and excludes the target itself', async () => {
    await initDatabase()
    const targetId = registerImageRef(path.join(root, 'target.png'))
    insertHash(targetId, '0000000000000000')
    insertEmbedding(targetId, [1, 0, 0, 0])
    const closeId = registerImageRef(path.join(root, 'close.png'))
    insertEmbedding(closeId, [1, 0, 0, 0])
    const orthogonalId = registerImageRef(path.join(root, 'orthogonal.png'))
    insertEmbedding(orthogonalId, [0, 1, 0, 0])

    const result = await querySimilarImages(getDatabase(), { imageRefId: targetId, maxDistance: 0.5 })
    expect(result.method).toBe('clip')
    expect(result.items.map(item => item.imageRefId)).toEqual([closeId])
    expect(result.items[0].distance).toBeCloseTo(0, 6)
    expect(result.items[0].score).toBeCloseTo(1, 6)
  })
})
