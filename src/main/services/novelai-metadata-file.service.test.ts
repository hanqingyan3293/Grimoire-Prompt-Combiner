import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportNovelaiMetadataToPng, readNovelaiMetadataFromFile } from './novelai-metadata-file.service'

function chunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(data.length, 0)
  header.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) >>> 0, 0)
  return Buffer.concat([header, data, crc])
}
function onePixelPng(): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0))])
}

let root = ''
const params = { prompt: '1girl, {{long hair}}', steps: 28, seed: 7, sampler: 'k_euler' }

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-meta-')) })
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('NovelAI metadata file round trip (M6.6)', () => {
  it('writes a sibling .meta.png and leaves the original byte-identical', () => {
    const original = path.join(root, 'image.png')
    const bytes = onePixelPng()
    fs.writeFileSync(original, bytes)
    const result = exportNovelaiMetadataToPng({ filePath: original, params, unknown: { futureField: 'kept' } })
    expect(result.writtenPath).toBe(path.join(root, 'image.meta.png'))
    expect(fs.readFileSync(original).equals(bytes)).toBe(true)
    const decoded = readNovelaiMetadataFromFile(result.writtenPath)
    expect(decoded?.params).toEqual(params)
    expect(decoded?.unknown).toEqual({ futureField: 'kept' })
  })

  it('refuses non-PNG input instead of writing a misleading file', () => {
    const jpeg = path.join(root, 'image.jpg')
    fs.writeFileSync(jpeg, Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
    expect(() => exportNovelaiMetadataToPng({ filePath: jpeg, params })).toThrow(/PNG/)
    expect(fs.existsSync(path.join(root, 'image.meta.jpg'))).toBe(false)
  })

  it('returns null when the file has no metadata', () => {
    const plain = path.join(root, 'plain.png')
    fs.writeFileSync(plain, onePixelPng())
    expect(readNovelaiMetadataFromFile(plain)).toBeNull()
  })
})
