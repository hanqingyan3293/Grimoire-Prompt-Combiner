import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { buildManagedImagePath, inspectImageFile, isPathInside, probeImageDimensions } from './asset.core'

function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

function jpegWithSof(width: number, height: number): Buffer {
  const sof = Buffer.alloc(11)
  sof.writeUInt16BE(0xffc0, 0)
  sof.writeUInt16BE(9, 2)
  sof.writeUInt8(8, 4)
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof])
}

describe('asset core', () => {
  it('validates and hashes a PNG by its file signature', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-asset-'))
    const file = path.join(dir, 'sample.png')
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]))
    const result = await inspectImageFile(file)
    expect(result.mimeType).toBe('image/png')
    expect(result.extension).toBe('png')
    expect(result.hash).toHaveLength(64)
    expect(buildManagedImagePath(dir, result)).toContain(path.join('images', result.hash.slice(0, 2)))
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('rejects unknown signatures and detects path escapes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-asset-'))
    const file = path.join(dir, 'sample.txt')
    fs.writeFileSync(file, 'not an image')
    await expect(inspectImageFile(file)).rejects.toThrow('图片格式')
    expect(isPathInside(dir, path.join(dir, 'images', 'file.png'))).toBe(true)
    expect(isPathInside(dir, path.join(dir, '..', 'file.png'))).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('probes PNG, JPEG, WebP and BMP dimensions without dependencies', () => {
    expect(probeImageDimensions(pngHeader(1920, 1080))).toEqual({ width: 1920, height: 1080 })
    expect(probeImageDimensions(jpegWithSof(800, 600))).toEqual({ width: 800, height: 600 })

    const vp8x = Buffer.alloc(30)
    vp8x.write('RIFF', 0, 'ascii')
    vp8x.write('WEBP', 8, 'ascii')
    vp8x.write('VP8X', 12, 'ascii')
    vp8x.writeUIntLE(511, 24, 3)
    vp8x.writeUIntLE(255, 27, 3)
    expect(probeImageDimensions(vp8x)).toEqual({ width: 512, height: 256 })

    const vp8l = Buffer.alloc(30)
    vp8l.write('RIFF', 0, 'ascii')
    vp8l.write('WEBP', 8, 'ascii')
    vp8l.write('VP8L', 12, 'ascii')
    vp8l[20] = 0x2f
    // width-1 = 320 → bits: b1=0x40, b2=0x01; height-1 = 200 → b2 high bits 0, b3=0x32, b4=0
    vp8l[21] = 0x40
    vp8l[22] = 0x01
    vp8l[23] = 0x32
    vp8l[24] = 0x00
    expect(probeImageDimensions(vp8l)).toEqual({ width: 321, height: 201 })

    const bmp = Buffer.alloc(26)
    bmp.write('BM', 0, 'ascii')
    bmp.writeInt32LE(640, 18)
    bmp.writeInt32LE(480, 22)
    expect(probeImageDimensions(bmp)).toEqual({ width: 640, height: 480 })
  })

  it('returns null for truncated or unknown buffers instead of throwing', () => {
    expect(probeImageDimensions(Buffer.alloc(0))).toBeNull()
    expect(probeImageDimensions(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(probeImageDimensions(pngHeader(10, 20).subarray(0, 18))).toBeNull()
    expect(probeImageDimensions(Buffer.from('RIFFxxxxWEBPxxxx'))).toBeNull()
    expect(probeImageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00]))).toBeNull()
  })
})
