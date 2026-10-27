import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export const MAX_IMAGE_BYTES = 100 * 1024 * 1024

export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/bmp'

export interface ImageInspection {
  mimeType: ImageMimeType
  extension: 'png' | 'jpg' | 'webp' | 'bmp'
  size: number
  hash: string
  originalName: string
}

function detectImageType(header: Buffer): { mimeType: ImageMimeType; extension: ImageInspection['extension'] } | null {
  if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mimeType: 'image/png', extension: 'png' }
  if (header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { mimeType: 'image/jpeg', extension: 'jpg' }
  if (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') return { mimeType: 'image/webp', extension: 'webp' }
  if (header.subarray(0, 2).toString('ascii') === 'BM') return { mimeType: 'image/bmp', extension: 'bmp' }
  return null
}

/**
 * Zero-dependency pixel-dimension probe for PNG/JPEG/WebP/BMP headers.
 * Returns null when the buffer is truncated or the container variant is not
 * recognized; callers treat null as "dimensions unknown" and never throw.
 */
export function probeImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  try {
    if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
    }
    if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset += 1; continue }
        const marker = buffer[offset + 1]
        if (marker === 0xff) { offset += 1; continue }
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { offset += 2; continue }
        const size = buffer.readUInt16BE(offset + 2)
        const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
        if (isSof) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
        if (marker === 0xda) break
        offset += 2 + size
      }
      return null
    }
    if (buffer.length >= 30 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
      const chunk = buffer.subarray(12, 16).toString('ascii')
      if (chunk === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) }
      if (chunk === 'VP8 ') {
        if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null
        return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
      }
      if (chunk === 'VP8L') {
        if (buffer[20] !== 0x2f) return null
        const width = 1 + (((buffer[22] & 0x3f) << 8) | buffer[21])
        const height = 1 + (((buffer[24] & 0x0f) << 10) | (buffer[23] << 2) | ((buffer[22] & 0xc0) >> 6))
        return { width, height }
      }
      return null
    }
    if (buffer.length >= 26 && buffer.subarray(0, 2).toString('ascii') === 'BM') {
      return { width: Math.abs(buffer.readInt32LE(18)), height: Math.abs(buffer.readInt32LE(22)) }
    }
    return null
  } catch {
    return null
  }
}

export async function inspectImageFile(filePath: string): Promise<ImageInspection> {
  const stats = await fs.promises.stat(filePath)
  if (!stats.isFile()) throw new Error('图片路径不是文件')
  if (stats.size <= 0 || stats.size > MAX_IMAGE_BYTES) throw new Error('图片大小超出允许范围')
  const handle = await fs.promises.open(filePath, 'r')
  const header = Buffer.alloc(16)
  try { await handle.read(header, 0, header.length, 0) } finally { await handle.close() }
  const type = detectImageType(header)
  if (!type) throw new Error('不支持的图片格式')
  const hash = crypto.createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
  return { ...type, size: stats.size, hash: hash.digest('hex'), originalName: path.basename(filePath) }
}

export function buildManagedImagePath(resourceRoot: string, inspection: ImageInspection): string {
  return path.join(resourceRoot, 'images', inspection.hash.slice(0, 2), inspection.hash + '.' + inspection.extension)
}

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
}
