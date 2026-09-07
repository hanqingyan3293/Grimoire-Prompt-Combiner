import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { buildManagedImagePath, inspectImageFile, isPathInside } from './asset.core'

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
})
