import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))
import { closeDatabase, getDatabase, initDatabase } from '../database'
import { ensureMediaAsset } from './media.service'
import { parseMediaMetadata, scanMediaMetadata } from './media-metadata.service'

// ---------- 测试辅助：程序化构造真实 PNG 文件 ----------

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

function buildPng(width: number, height: number, textChunks: Array<[string, string]>): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr)]
  for (const [keyword, text] of textChunks) {
    parts.push(pngChunk('tEXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'utf8')])))
  }
  parts.push(pngChunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}

function writePngFile(filePath: string, width: number, height: number, textChunks: Array<[string, string]>): Buffer {
  const png = buildPng(width, height, textChunks)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, png)
  return png
}

function registerImageRef(filePath: string, size: number, hash: string): number {
  getDatabase().run('INSERT INTO image_refs (file_path,storage_mode,asset_hash,mime_type,file_size,original_name,available) VALUES (?,?,?,?,?,?,?)', [filePath, 'managed', hash, 'image/png', size, path.basename(filePath), 1])
  return Number(getDatabase().exec('SELECT last_insert_rowid()')[0].values[0][0])
}

function metadataRow(mediaId: string): unknown[] | undefined {
  return getDatabase().exec('SELECT origin,prompt,negative_prompt,provider,model,checkpoint,loras_json,seed,sampler,scheduler,steps,cfg,width,height,raw_json FROM image_generation_metadata WHERE media_asset_id=?', [mediaId])[0]?.values?.[0]
}

const A1111_PARAMETERS = 'masterpiece, 1girl, blue eyes\nNegative prompt: low quality\nSteps: 28, Sampler: DPM++ 2M, CFG scale: 7, Seed: 12345, Size: 640x480, Model hash: a1b2c3d4, Model: dreamshaper_8'

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-media-meta-')) })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

describe('media metadata service', () => {
  it('parses embedded parameters, persists the metadata row and backfills image_refs dimensions', async () => {
    await initDatabase()
    const filePath = path.join(root, 'images', 'a1111.png')
    const png = writePngFile(filePath, 640, 480, [['parameters', A1111_PARAMETERS]])
    const imageId = registerImageRef(filePath, png.length, 'hash-a1111')
    const asset = ensureMediaAsset(imageId, 'imported-reference')

    const parsed = await parseMediaMetadata(asset.id)
    expect(parsed).not.toBeNull()
    expect(parsed).toMatchObject({ origin: 'webui', steps: 28, cfg: 7, seed: 12345, width: 640, height: 480, sampler: 'DPM++ 2M', modelHash: 'a1b2c3d4', checkpoint: 'dreamshaper_8' })
    expect(parsed!.prompt).toContain('1girl')
    expect(parsed!.negativePrompt).toContain('low quality')

    const row = metadataRow(asset.id)
    expect(row).toBeTruthy()
    expect(String(row![0])).toBe('webui')
    expect(String(row![1])).toContain('1girl')
    expect(String(row![2])).toContain('low quality')
    expect(String(row![5])).toBe('dreamshaper_8')
    expect(Number(row![7])).toBe(12345)
    expect(Number(row![10])).toBe(28)
    expect(Number(row![12])).toBe(640)
    expect(Number(row![13])).toBe(480)
    expect(JSON.parse(String(row![14])).a1111).toBe(A1111_PARAMETERS)

    const ref = getDatabase().exec('SELECT width,height,file_mtime FROM image_refs WHERE id=?', [imageId])[0]?.values?.[0]
    expect(Number(ref![0])).toBe(640)
    expect(Number(ref![1])).toBe(480)
    expect(Number(ref![2])).toBeGreaterThan(0)
  })

  it('never overwrites existing non-empty metadata fields or a set origin', async () => {
    await initDatabase()
    const filePath = path.join(root, 'images', 'existing.png')
    const png = writePngFile(filePath, 640, 480, [['parameters', A1111_PARAMETERS]])
    const imageId = registerImageRef(filePath, png.length, 'hash-existing')
    const asset = ensureMediaAsset(imageId, 'generated-comfy')

    // 模拟 comfyui-grimoire 已写入的行：非空字段与 origin 必须保留
    getDatabase().run(
      'INSERT INTO image_generation_metadata (media_asset_id,origin,prompt,negative_prompt,provider,model,checkpoint,loras_json,seed,sampler,scheduler,steps,cfg,width,height,raw_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [asset.id, 'comfyui-grimoire', 'manual prompt', '', 'comfyui', 'manual model', 'manual ckpt', '["manual.safetensors"]', 7, 'euler', 'normal', 20, 8, 1, 1, '{"marker":true}', '2026-01-01T00:00:00.000Z'],
    )

    const parsed = await parseMediaMetadata(asset.id)
    expect(parsed).not.toBeNull()
    expect(parsed!.origin).toBe('webui') // 解析结果本身仍反映图片内容

    const row = metadataRow(asset.id)
    expect(String(row![0])).toBe('comfyui-grimoire') // origin 不被改写
    expect(String(row![1])).toBe('manual prompt')
    expect(String(row![3])).toBe('comfyui')
    expect(String(row![4])).toBe('manual model')
    expect(String(row![5])).toBe('manual ckpt')
    expect(String(row![6])).toBe('["manual.safetensors"]')
    expect(Number(row![7])).toBe(7)
    expect(String(row![8])).toBe('euler')
    expect(Number(row![12])).toBe(1)
    expect(JSON.parse(String(row![14])).marker).toBe(true)
    // 空字段（negative_prompt）才允许补入解析值
    expect(String(row![2])).toContain('low quality')
  })

  it('scans candidates in batches, reporting parsed/skipped counts and progress', async () => {
    await initDatabase()
    const withMetaPath = path.join(root, 'scans', 'with-meta.png')
    const withMetaPng = writePngFile(withMetaPath, 512, 512, [['parameters', A1111_PARAMETERS]])
    const withMetaId = registerImageRef(withMetaPath, withMetaPng.length, 'hash-scan-a')
    const withMetaAsset = ensureMediaAsset(withMetaId, 'imported-reference')

    const blankPath = path.join(root, 'scans', 'blank.png')
    const blankPng = writePngFile(blankPath, 64, 64, [])
    const blankId = registerImageRef(blankPath, blankPng.length, 'hash-scan-b')
    const blankAsset = ensureMediaAsset(blankId, 'imported-reference')

    const progress: Array<{ done: number; total: number }> = []
    const summary = await scanMediaMetadata({ batchSize: 1, onProgress: (done, total) => progress.push({ done, total }) })

    expect(summary).toEqual({ scanned: 2, parsed: 1, skipped: 1 })
    expect(progress.length).toBeGreaterThanOrEqual(1)
    expect(progress.every(item => item.total === 2)).toBe(true)
    expect(progress[progress.length - 1]).toEqual({ done: 2, total: 2 })

    // 带元数据的资产：行已写入；纯空白 PNG：无行，但尺寸仍被补齐
    expect(String(metadataRow(withMetaAsset.id)![0])).toBe('webui')
    expect(metadataRow(blankAsset.id)).toBeUndefined()
    const blankRef = getDatabase().exec('SELECT width,height FROM image_refs WHERE id=?', [blankId])[0]?.values?.[0]
    expect(Number(blankRef![0])).toBe(64)
    expect(Number(blankRef![1])).toBe(64)
  })

  it('counts unreadable files as skipped and leaves their dimensions empty', async () => {
    await initDatabase()
    const missingPath = path.join(root, 'missing', 'gone.png')
    const imageId = registerImageRef(missingPath, 128, 'hash-missing')
    const asset = ensureMediaAsset(imageId, 'imported-reference')

    const parsed = await parseMediaMetadata(asset.id)
    expect(parsed).toBeNull()
    const summary = await scanMediaMetadata()
    expect(summary).toEqual({ scanned: 1, parsed: 0, skipped: 1 })
    const ref = getDatabase().exec('SELECT width,height,file_mtime FROM image_refs WHERE id=?', [imageId])[0]?.values?.[0]
    expect(ref![0]).toBeNull()
    expect(ref![1]).toBeNull()
    expect(ref![2]).toBeNull()
  })

  it('supports persist: false to parse without writing', async () => {
    await initDatabase()
    const filePath = path.join(root, 'images', 'dry-run.png')
    const png = writePngFile(filePath, 320, 240, [['parameters', A1111_PARAMETERS]])
    const imageId = registerImageRef(filePath, png.length, 'hash-dry')
    const asset = ensureMediaAsset(imageId, 'imported-reference')

    const parsed = await parseMediaMetadata(asset.id, { persist: false })
    expect(parsed).not.toBeNull()
    expect(metadataRow(asset.id)).toBeUndefined()
    const ref = getDatabase().exec('SELECT width FROM image_refs WHERE id=?', [imageId])[0]?.values?.[0]
    expect(ref![0]).toBeNull()
  })
})