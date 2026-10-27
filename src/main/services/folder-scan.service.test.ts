import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))
// 托管注册会做真实的解码/复制，扫描/导入测试只关心路径决策——复用已测函数。
const registerManagedMock = vi.fn()
vi.mock('./image-asset.service', () => ({
  registerManagedImage: (...args: unknown[]) => registerManagedMock(...args),
}))
vi.mock('./media-metadata.service', () => ({
  parseMediaMetadata: vi.fn(async () => null),
}))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { importScannedFiles, scanImageDirectory } from './folder-scan.service'

let scanRoot = ''

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-folder-scan-'))
  scanRoot = path.join(root, 'library')
  fs.mkdirSync(path.join(scanRoot, 'cats'), { recursive: true })
  fs.mkdirSync(path.join(scanRoot, 'dogs'), { recursive: true })
  fs.writeFileSync(path.join(scanRoot, 'a.png'), Buffer.from('a'))
  fs.writeFileSync(path.join(scanRoot, 'cats', 'b.jpg'), Buffer.from('bb'))
  fs.writeFileSync(path.join(scanRoot, 'dogs', 'c.webp'), Buffer.from('ccc'))
  fs.writeFileSync(path.join(scanRoot, 'notes.txt'), 'not an image')
  registerManagedMock.mockReset()
  await initDatabase()
})
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

describe('scanImageDirectory', () => {
  it('lists image files with sizes, non-recursive by default', async () => {
    const result = await scanImageDirectory(getDatabase(), { directory: scanRoot })
    expect(result.total).toBe(1)
    expect(result.entries[0].fileName).toBe('a.png')
    expect(result.entries[0].alreadyImported).toBe(false)
    expect(result.entries[0].size).toBe(1)
  })

  it('walks subdirectories when recursive and flags already-imported paths case-insensitively on win32', async () => {
    getDatabase().run('INSERT INTO image_refs (id,file_path,storage_mode,available) VALUES (?,?,?,?)', [1, path.join(scanRoot, 'CATS', 'B.JPG'), 'external', 1])
    const result = await scanImageDirectory(getDatabase(), { directory: scanRoot, recursive: true })
    expect(result.total).toBe(3)
    // 已导入项排在最后，其余按文件名升序。
    expect(result.entries.map(entry => entry.fileName)).toEqual(['a.png', 'c.webp', 'b.jpg'])
    const imported = result.entries.find(entry => entry.fileName === 'b.jpg')
    expect(imported?.alreadyImported).toBe(process.platform === 'win32')
  })

  it('throws clear errors for missing or non-directory paths', async () => {
    await expect(scanImageDirectory(getDatabase(), { directory: path.join(root, 'missing') })).rejects.toThrow('扫描目录不存在或不可访问')
    await expect(scanImageDirectory(getDatabase(), { directory: path.join(scanRoot, 'a.png') })).rejects.toThrow('扫描路径不是目录')
    await expect(scanImageDirectory(getDatabase(), { directory: '' })).rejects.toThrow('扫描目录无效')
  })
})

describe('importScannedFiles', () => {
  /** 真实的 registerManagedImage 会写 image_refs 行（ensureMediaAsset 依赖它），mock 需保持一致。 */
  function mockManagedRegistration(): void {
    registerManagedMock.mockImplementation(async (sourcePath: string) => {
      const insert = getDatabase().run('INSERT INTO image_refs (file_path,storage_mode,asset_hash,mime_type,file_size,original_name,available) VALUES (?,?,?,?,?,?,1)', [sourcePath, 'managed', 'hash-' + path.basename(sourcePath), 'image/png', 1, path.basename(sourcePath)])
      return { id: Number(insert.lastInsertRowid), file_path: sourcePath, storage_mode: 'managed', asset_hash: 'h', mime_type: 'image/png', file_size: 1, original_name: path.basename(sourcePath) }
    })
  }

  it('imports via the managed path and skips already-known paths', async () => {
    getDatabase().run('INSERT INTO image_refs (id,file_path,storage_mode,available) VALUES (?,?,?,?)', [9, path.join(scanRoot, 'a.png'), 'managed', 1])
    mockManagedRegistration()
    const result = await importScannedFiles(getDatabase(), { filePaths: [path.join(scanRoot, 'a.png'), path.join(scanRoot, 'cats', 'b.jpg')] })
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.imageIds).toHaveLength(1)
    // ensureMediaAsset 已为该图建立媒体行。
    expect(getDatabase().exec('SELECT COUNT(*) FROM media_assets WHERE image_ref_id=?', [result.imageIds[0]])[0]?.values?.[0]?.[0]).toBe(1)
  })

  it('registers external links without copying and counts missing files as failed', async () => {
    const externalPath = path.join(scanRoot, 'dogs', 'c.webp')
    const result = await importScannedFiles(getDatabase(), { filePaths: [externalPath, path.join(scanRoot, 'missing.png')], mode: 'external' })
    expect(result.imported).toBe(1)
    expect(result.failed).toBe(1)
    const row = getDatabase().exec('SELECT file_path,storage_mode,mime_type,original_name FROM image_refs WHERE id=?', [result.imageIds[0]])[0]?.values?.[0] as unknown[]
    expect(String(row[0])).toBe(path.resolve(externalPath))
    expect(String(row[1])).toBe('external')
    expect(String(row[2])).toBe('image/webp')
    expect(String(row[3])).toBe('c.webp')
    expect(registerManagedMock).not.toHaveBeenCalled()
  })

  it('does not double-import the same path within one call', async () => {
    mockManagedRegistration()
    const target = path.join(scanRoot, 'a.png')
    const result = await importScannedFiles(getDatabase(), { filePaths: [target, target] })
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(1)
    expect(registerManagedMock).toHaveBeenCalledTimes(1)
  })
})
