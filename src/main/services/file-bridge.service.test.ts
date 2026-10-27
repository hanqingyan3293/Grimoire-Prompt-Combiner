import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({ app: { getPath: (name: string) => name === 'temp' ? path.join(testRoot, 'temp') : testRoot } }))

import {
  createBridgeTempFile,
  fileTypeForExtension,
  getBridgeFileInfo,
  getBridgePhysicalMetadata,
  readBridgeTextFile,
  writeBridgeTempFile
} from './file-bridge.service'

beforeEach(() => { testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-file-bridge-')) })
afterEach(() => { fs.rmSync(testRoot, { recursive: true, force: true }) })

describe('composer file bridge', () => {
  it('resolves file info with the source FileMetadata shape', () => {
    const file = path.join(testRoot, 'notes.md')
    fs.writeFileSync(file, '# hello')
    const info = getBridgeFileInfo(file)
    expect(info).toMatchObject({ name: 'notes.md', origin_name: 'notes.md', ext: '.md', type: 'text', path: file })
    expect(info!.size).toBeGreaterThan(0)
    expect(info!.id).toBe(file)
  })

  it('rejects directories and missing paths', () => {
    expect(getBridgeFileInfo(testRoot)).toBeNull()
    expect(getBridgeFileInfo(path.join(testRoot, 'missing.txt'))).toBeNull()
    expect(getBridgeFileInfo('')).toBeNull()
  })

  it('classifies extensions without guessing unknown ones', () => {
    expect(fileTypeForExtension('.PNG')).toBe('image')
    expect(fileTypeForExtension('.wav')).toBe('audio')
    expect(fileTypeForExtension('.pdf')).toBe('document')
    expect(fileTypeForExtension('.unknown')).toBe('other')
    expect(fileTypeForExtension('')).toBe('other')
  })

  it('reports physical metadata for files and directories', () => {
    const file = path.join(testRoot, 'shot.png')
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const meta = getBridgePhysicalMetadata(file)
    expect(meta).toMatchObject({ kind: 'file', size: 4, mime: 'image/png', type: 'image' })
    expect(meta!.modifiedAt).toBeGreaterThan(0)
    expect(getBridgePhysicalMetadata(testRoot)).toMatchObject({ kind: 'directory' })
  })

  it('reads text with a size cap and refuses oversized files', () => {
    const file = path.join(testRoot, 'logs.txt')
    fs.writeFileSync(file, 'line one\nline two')
    expect(readBridgeTextFile(file)).toBe('line one\nline two')

    const huge = path.join(testRoot, 'huge.txt')
    fs.writeFileSync(huge, Buffer.alloc(6 * 1024 * 1024, 0x61))
    expect(() => readBridgeTextFile(huge)).toThrow('FILE_BRIDGE_TOO_LARGE')
  })

  it('confines temp writes to the bridge temp root', () => {
    const target = createBridgeTempFile('pasted text.txt')
    writeBridgeTempFile(target, 'hello')
    expect(fs.readFileSync(target, 'utf8')).toBe('hello')
    expect(target.includes('pasted text.txt')).toBe(true)

    const outside = path.join(testRoot, 'elsewhere.txt')
    expect(() => writeBridgeTempFile(outside, 'nope')).toThrow('FILE_BRIDGE_TEMP_ONLY')
    expect(fs.existsSync(outside)).toBe(false)
  })
})
