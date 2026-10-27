import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(), showSaveDialog: vi.fn(), fromWebContents: vi.fn(),
  getPath: vi.fn(), invoke: vi.fn(), expose: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle }, dialog: { showSaveDialog: mocks.showSaveDialog },
  shell: { openPath: mocks.openPath, showItemInFolder: mocks.showItemInFolder },
  BrowserWindow: { fromWebContents: mocks.fromWebContents }, app: { getPath: mocks.getPath },
  ipcRenderer: { invoke: mocks.invoke }, contextBridge: { exposeInMainWorld: mocks.expose }, webUtils: {}
}))

import { registerFileBridgeIPC } from './file-bridge.ipc'
import { IPC_CHANNELS } from '../../shared/types'
import '../../preload/index'

// Capture module initialization before Vitest's per-test clearMocks empties calls.
const preloadApi = mocks.expose.mock.calls.find(([key]) => key === 'api')![1]

let root: string
const parent = { isDestroyed: () => false }
const sender = { id: 7 }
let save: (event: unknown, name: unknown, content: unknown, options?: unknown) => Promise<string | null>

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-file-save-'))
  fs.mkdirSync(path.join(root, 'userData'))
  mocks.getPath.mockImplementation(() => path.join(root, 'userData'))
  mocks.fromWebContents.mockReturnValue(parent)
  mocks.showSaveDialog.mockReset()
  mocks.openPath.mockReset().mockResolvedValue('')
  mocks.showItemInFolder.mockClear()
  mocks.invoke.mockReset()
  mocks.handle.mockClear()
  registerFileBridgeIPC()
  save = mocks.handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.FILE_BRIDGE_SAVE)![1]
})
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }) })

const call = (name: unknown, content: unknown, options?: unknown) => save({ sender }, name, content, options)

describe('Cherry file.openPath IPC', () => {
  const open = (target: unknown): Promise<void> => {
    const handler = mocks.handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.FILE_BRIDGE_OPEN_PATH)![1]
    return handler({ sender }, target)
  }

  it('opens the supplied file itself and resolves void only after the shell succeeds', async () => {
    const target = path.join(root, '选定文件 café.html')
    fs.writeFileSync(target, '<html/>')
    let finish!: (result: string) => void
    mocks.openPath.mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve }))
    const request = open(target)
    let settled = false
    void request.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(mocks.openPath).toHaveBeenCalledWith(target)
    expect(mocks.showItemInFolder).not.toHaveBeenCalled()
    expect(mocks.showSaveDialog).not.toHaveBeenCalled()
    finish('')
    expect(await request).toBeUndefined()
  })

  it('allows a directory, as required by source Sessions workdir callers', async () => {
    expect(await open(root)).toBeUndefined()
    expect(mocks.openPath).toHaveBeenCalledWith(root)
  })

  it('expands home-relative paths and trims input like source openRequestPath', async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(root)
    const target = path.join(root, 'report.pdf')
    fs.writeFileSync(target, 'fixture')
    await open('  ~/report.pdf  ')
    expect(mocks.openPath).toHaveBeenCalledWith(target)
  })

  it('rejects missing files and directories before calling the OS', async () => {
    await expect(open(path.join(root, 'missing.pdf'))).rejects.toThrow('NOT_FOUND')
    await expect(open(path.join(root, 'missing-directory'))).rejects.toThrow('NOT_FOUND')
    expect(mocks.openPath).not.toHaveBeenCalled()
  })

  it.each([undefined, null, 7, true, {}, [], '', '   ', 'bad\0.pdf', 'relative.pdf', 'https://example.com', 'file:///tmp/report.pdf'])('rejects invalid arguments without coercion (%s)', async target => {
    await expect(open(target)).rejects.toThrow('INVALID_PATH')
    expect(mocks.openPath).not.toHaveBeenCalled()
  })

  it('preserves the entire source unsafe-extension policy including case/trailing-dot normalization', async () => {
    // Verify the extraction against the read-only source, not a second guessed list.
    const source = fs.readFileSync(path.resolve('src/vendor/cherry/source/src/shared/utils/file/url.ts'), 'utf8')
    const block = source.match(/const DANGEROUS_EXTS = new Set\(\[([\s\S]*?)\]\)/)![1]
    const extensions = [...block.matchAll(/^\s*'([^']+)'/gm)].map(match => match[1])
    expect(extensions.length).toBeGreaterThan(40)
    for (const ext of extensions) {
      await expect(open(path.join(root, `payload.${ext}`))).rejects.toThrow('OPEN_BLOCKED_UNSAFE_TYPE')
    }
    await expect(open(path.join(root, 'payload.EXE.'))).rejects.toThrow('OPEN_BLOCKED_UNSAFE_TYPE')
    expect(mocks.openPath).not.toHaveBeenCalled()
  })

  it('rejects both shell error strings and rejected promises rather than returning fake success', async () => {
    const target = path.join(root, 'report.pdf')
    fs.writeFileSync(target, 'fixture')
    mocks.openPath.mockResolvedValueOnce('No application is associated with this file')
    await expect(open(target)).rejects.toThrow('No application is associated with this file')
    mocks.openPath.mockRejectedValueOnce(new Error('OS launch failed'))
    await expect(open(target)).rejects.toThrow('OS launch failed')
  })

  it('preload invokes the actual handler and propagates void, missing-path and OS failures', async () => {
    const target = path.join(root, 'chosen.pdf')
    fs.writeFileSync(target, 'fixture')
    mocks.invoke.mockImplementation((channel, input) => {
      expect(channel).toBe(IPC_CHANNELS.FILE_BRIDGE_OPEN_PATH)
      return open(input)
    })
    expect(await preloadApi.file.openPath(target)).toBeUndefined()
    expect(mocks.invoke).toHaveBeenLastCalledWith('file:openPath', target)
    await expect(preloadApi.file.openPath(path.join(root, 'missing.pdf'))).rejects.toThrow('NOT_FOUND')
    mocks.openPath.mockResolvedValueOnce('shell denied')
    await expect(preloadApi.file.openPath(target)).rejects.toThrow('shell denied')
    expect(preloadApi.file.saveImage).toBeUndefined()
    expect(preloadApi.backup).toBeUndefined()
  })
})

describe('Cherry file.save IPC', () => {
  it('writes UTF-8 to the chosen path, returns that path, and parents to the caller', async () => {
    const target = path.join(root, 'chosen.html')
    const content = '<html>魔导书 — café</html>'
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })
    expect(await call('suggested.html', content)).toBe(target)
    expect(mocks.fromWebContents).toHaveBeenCalledWith(sender)
    expect(mocks.showSaveDialog).toHaveBeenCalledWith(parent, { title: '保存文件', defaultPath: 'suggested.html' })
    expect(fs.readFileSync(target)).toEqual(Buffer.from(content, 'utf8'))
    expect(fs.existsSync(path.join(root, 'suggested.html'))).toBe(false)
  })

  it.each([new Uint8Array([0, 255, 128, 13, 10]), Buffer.from([0, 255, 128, 13, 10])])('preserves binary bytes and source dialog filters', async data => {
    const target = path.join(root, 'table.xlsx')
    const options = { title: 'Export', defaultPath: 'table.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }] }
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })
    expect(await call('fallback.xlsx', data, options)).toBe(target)
    expect(mocks.showSaveDialog).toHaveBeenCalledWith(parent, options)
    expect(fs.readFileSync(target)).toEqual(Buffer.from(data))
  })

  it.each([{ canceled: true, filePath: 'ignored' }, { canceled: false }])('returns null without writing on cancellation or no path', async result => {
    const write = vi.spyOn(fs.promises, 'writeFile')
    mocks.showSaveDialog.mockResolvedValue(result)
    expect(await call('code.ts', '')).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it('rejects native-dialog and filesystem failures rather than reporting cancellation/success', async () => {
    mocks.showSaveDialog.mockRejectedValueOnce(new Error('dialog failed'))
    await expect(call('code.ts', 'hello')).rejects.toThrow('dialog failed')
    mocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: path.join(root, 'missing', 'code.ts') })
    await expect(call('code.ts', 'hello')).rejects.toThrow()
    expect(fs.existsSync(path.join(root, 'missing'))).toBe(false)
  })

  it.each([
    [null, 'text', undefined], ['bad\0.txt', 'text', undefined], ['', 'text', undefined],
    ['ok.txt', {}, undefined], ['ok.txt', new ArrayBuffer(2), undefined],
    ['ok.txt', 'text', null], ['ok.txt', 'text', { encoding: 'base64' }],
    ['ok.txt', 'text', { defaultPath: 4 }], ['ok.txt', 'text', { properties: ['createDirectory'] }],
    ['ok.txt', 'text', { filters: [{ name: 'bad', extensions: ['../txt'] }] }]
  ])('rejects unsafe arguments before displaying a dialog (%s)', async (name, content, options) => {
    await expect(call(name, content, options)).rejects.toThrow('FILE_SAVE_')
    expect(mocks.showSaveDialog).not.toHaveBeenCalled()
  })

  it('refuses a missing or destroyed caller instead of using another window', async () => {
    mocks.fromWebContents.mockReturnValueOnce(null)
    await expect(call('file.txt', 'text')).rejects.toThrow('FILE_SAVE_NO_CALLER_WINDOW')
    mocks.fromWebContents.mockReturnValueOnce({ isDestroyed: () => true })
    await expect(call('file.txt', 'text')).rejects.toThrow('FILE_SAVE_NO_CALLER_WINDOW')
    expect(mocks.showSaveDialog).not.toHaveBeenCalled()
  })

  it('does not overwrite managed application data even if selected', async () => {
    const target = path.join(root, 'userData', 'database.sqlite')
    fs.writeFileSync(target, 'original')
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })
    await expect(call('file.txt', 'replacement')).rejects.toThrow('FILE_SAVE_MANAGED_STORAGE')
    expect(fs.readFileSync(target, 'utf8')).toBe('original')
  })

  it('protects managed storage reached through a symlink/junction', async () => {
    const alias = path.join(root, 'alias')
    fs.symlinkSync(path.join(root, 'userData'), alias, process.platform === 'win32' ? 'junction' : 'dir')
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: path.join(alias, 'new.txt') })
    await expect(call('file.txt', 'replacement')).rejects.toThrow('FILE_SAVE_MANAGED_STORAGE')
    expect(fs.existsSync(path.join(root, 'userData', 'new.txt'))).toBe(false)
  })

  it('preload forwards filename first and preserves path/null/rejection without adding unsupported APIs', async () => {
    const api = preloadApi
    const options = { filters: [{ name: 'JSON', extensions: ['json'] }] }
    const data = new TextEncoder().encode('{"ok":true}')
    mocks.invoke.mockResolvedValueOnce('chosen.json').mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('write failed'))
    expect(await api.file.save('assistant.json', data, options)).toBe('chosen.json')
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.FILE_BRIDGE_SAVE, 'assistant.json', data, options)
    expect(await api.file.save('artifact.html', '<html/>')).toBeNull()
    await expect(api.file.save('code.ts', 'code')).rejects.toThrow('write failed')
    expect(api.file.saveImage).toBeUndefined()
    expect(api.backup).toBeUndefined()
  })
})
