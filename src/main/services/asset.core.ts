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
