import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
// The save path talks to the OS dialog, so the dialog is stubbed here: what CAN be automated is our own
// contract (cancel → null, no path → null, managed-storage refusal, bytes written verbatim). Whether the
// dialog looks right is the remaining manual step recorded on the matrix row.
const dialogResult: { canceled: boolean; filePath?: string } = { canceled: false }
vi.mock('electron', () => ({
  app: { getPath: (name: string) => name === 'temp' ? path.join(testRoot, 'temp') : testRoot },
  dialog: { showSaveDialog: async () => dialogResult },
}))

import {
  createBridgeTempFile,
  fileTypeForExtension,
  getBridgeFileInfo,
  getBridgePhysicalMetadata,
  readBridgeTextFile,
  saveBridgeFile,
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
  it('returns null when the user cancels, and never writes', async () => {
    dialogResult.canceled = true
    dialogResult.filePath = path.join(testRoot, 'unused.txt')
    const target = await saveBridgeFile({} as never, 'a.txt', 'hello')
    expect(target).toBeNull()
    expect(fs.existsSync(path.join(testRoot, 'unused.txt'))).toBe(false)
  })

  it('writes the exact bytes to the chosen path', async () => {
    // Must be OUTSIDE the mocked userData root (testRoot), otherwise the managed-storage guard correctly
    // refuses — the first version of this test placed it inside and failed for the right reason.
    const chosen = path.join(os.tmpdir(), 'grimoire-save-' + Date.now() + '.txt')
    dialogResult.canceled = false
    dialogResult.filePath = chosen
    try {
      const target = await saveBridgeFile({} as never, 'b.txt', '你好\n世界')
      expect(target).toBe(chosen)
      expect(fs.readFileSync(chosen, 'utf8')).toBe('你好\n世界')
    } finally { fs.rmSync(chosen, { force: true }) }
  })

  it('refuses to overwrite a file inside the app-managed userData root', async () => {
    dialogResult.canceled = false
    dialogResult.filePath = path.join(testRoot, 'managed.txt')
    await expect(saveBridgeFile({} as never, 'c.txt', 'x')).rejects.toThrow(/FILE_SAVE_MANAGED_STORAGE/)
    expect(fs.existsSync(path.join(testRoot, 'managed.txt'))).toBe(false)
  })

  it('rejects content that is neither a string nor bytes before opening any dialog', async () => {
    await expect(saveBridgeFile({} as never, 'd.txt', 42)).rejects.toThrow(/FILE_SAVE_INVALID_CONTENT/)
  })
})
