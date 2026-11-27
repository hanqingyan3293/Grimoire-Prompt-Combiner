import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/types'

let root = ''
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
let encryptionAvailable = true
const send = vi.fn()
vi.mock('electron', () => ({
  app: { getPath: () => root },
  ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }] },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (value: string) => Buffer.from('enc:' + value),
    decryptString: (buffer: Buffer) => buffer.toString().replace(/^enc:/, ''),
  }
}))
vi.mock('../services/comfy-client', () => ({ configureComfyUI: vi.fn() }))
vi.mock('../services/app-preferences.service', () => ({ applyLaunchOnBoot: vi.fn(), applyPreventSleep: vi.fn(), applyProxy: vi.fn() }))
vi.mock('../services/logger.service', () => ({ logEvent: vi.fn(), logError: vi.fn() }))

import { initDatabase, closeDatabase, getDatabase } from '../database'
import { configureComfyUI } from '../services/comfy-client'
import { registerSettingsIPC } from './settings.ipc'

async function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error('Missing handler ' + channel)
  return handler({}, ...args)
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-settings-privacy-'))
  handlers.clear()
  send.mockClear()
  vi.mocked(configureComfyUI).mockClear()
  await initDatabase()
  registerSettingsIPC()
})

afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

describe('main-only Cherry credential settings boundary', () => {
  const gateway = 'cherry_pref.feature.api_gateway.api_key'
  const websearch = 'cherry_pref.chat.web_search.provider_overrides'

  it('redacts the real database snapshot and preserves stored credentials unchanged', async () => {
    const canary = 'synthetic-main-only-secret-canary'
    const db = getDatabase()
    const gatewayValue = JSON.stringify(canary)
    const webValue = JSON.stringify({ tavily: { apiKeys: [canary], basicAuthPassword: canary, apiHost: 'https://example.invalid' } })
    db.run('INSERT INTO settings (key,value) VALUES (?,?)', [gateway, gatewayValue])
    db.run('INSERT INTO settings (key,value) VALUES (?,?)', [websearch, webValue])
    const result = await call(IPC_CHANNELS.SETTINGS_GET_ALL)
    expect(JSON.stringify(result)).not.toContain(canary)
    expect(result).toMatchObject({ [gateway]: '"********"' })
    expect(db.exec('SELECT value FROM settings WHERE key=?', [gateway])[0].values[0][0]).toBe(gatewayValue)
    expect(db.exec('SELECT value FROM settings WHERE key=?', [websearch])[0].values[0][0]).toBe(webValue)
  })

  it('refuses to store credentials when OS encryption is unavailable, without mutating the database', async () => {
    encryptionAvailable = false
    try {
      for (const key of [gateway, websearch]) {
        // A well-formed credential payload, so the refusal comes from the encryption guard rather than
        // from payload validation.
        await expect(call(IPC_CHANNELS.SETTINGS_SET, key, key === gateway ? '"synthetic-new-secret"' : JSON.stringify({ tavily: { apiKeys: ['synthetic-new-secret'] } }))).rejects.toThrow(/encryption is unavailable|could not be safely/i)
        expect(getDatabase().exec('SELECT value FROM settings WHERE key=?', [key])[0]?.values ?? []).toHaveLength(0)
      }
      expect(send).not.toHaveBeenCalled()
    } finally {
      encryptionAvailable = true
    }
  })

  it('stores credentials encrypted and keeps the renderer read masked', async () => {
    const canary = 'synthetic-encrypted-canary'
    await call(IPC_CHANNELS.SETTINGS_SET, websearch, JSON.stringify({ tavily: { apiKeys: [canary], apiHost: 'https://example.invalid' } }))
    const stored = String(getDatabase().exec('SELECT value FROM settings WHERE key=?', [websearch])[0].values[0][0])
    expect(stored).not.toContain(canary)
    expect(stored).toContain('enc:v1:')
    expect(stored).toContain('https://example.invalid')
    const snapshot = await call(IPC_CHANNELS.SETTINGS_GET_ALL)
    expect(JSON.stringify(snapshot)).not.toContain(canary)
    expect(JSON.stringify(snapshot)).toContain('********')
  })

  it('does not export malformed credential JSON and leaves safe settings writes functional', async () => {
    getDatabase().run('INSERT INTO settings (key,value) VALUES (?,?)', [websearch, 'unparsed-private-value'])
    await expect(call(IPC_CHANNELS.SETTINGS_GET_ALL)).rejects.toThrow('could not be safely decoded')
    expect(await call(IPC_CHANNELS.SETTINGS_SET, 'cherry_pref.ui.theme_mode', '"dark"')).toBe(true)
    expect(send).toHaveBeenCalledWith('data:refresh')
  })
})

describe('ComfyUI settings address policy', () => {
  const key = 'comfyui_base_url'
  const defaultAddress = 'http://127.0.0.1:8188'

  it('rejects a private HTTPS literal before writing the database', async () => {
    await expect(call(IPC_CHANNELS.SETTINGS_SET, key, 'https://10.0.0.1')).rejects.toThrow('私有')
    expect(getDatabase().exec('SELECT value FROM settings WHERE key=?', [key])[0]?.values ?? []).toHaveLength(0)
    expect(configureComfyUI).not.toHaveBeenCalled()
  })

  it('accepts loopback HTTP and persists the normalized address', async () => {
    await call(IPC_CHANNELS.SETTINGS_SET, key, 'http://127.0.0.1:8188/')
    expect(getDatabase().exec('SELECT value FROM settings WHERE key=?', [key])[0].values[0][0]).toBe(defaultAddress)
    expect(configureComfyUI).toHaveBeenCalledWith(defaultAddress)
  })

  it('accepts public HTTPS and persists the normalized address', async () => {
    await call(IPC_CHANNELS.SETTINGS_SET, key, 'https://comfy.example.com:443/')
    expect(getDatabase().exec('SELECT value FROM settings WHERE key=?', [key])[0].values[0][0]).toBe('https://comfy.example.com:443')
    expect(configureComfyUI).toHaveBeenCalledWith('https://comfy.example.com:443')
  })

  it('falls back to the loopback default when the stored address fails the policy', async () => {
    getDatabase().run('INSERT INTO settings (key,value) VALUES (?,?)', [key, 'https://10.0.0.1'])
    const settings = await call(IPC_CHANNELS.SETTINGS_GET_ALL)
    expect(configureComfyUI).toHaveBeenCalledWith(defaultAddress)
    expect(settings).toMatchObject({ [key]: defaultAddress })
    expect(getDatabase().exec('SELECT value FROM settings WHERE key=?', [key])[0].values[0][0]).toBe('https://10.0.0.1')
  })

  it.each(['https://user:synthetic@comfy.example', 'http://localhost:8188?x=1', 'http://localhost:8188/#graph'])('rejects invalid configured endpoints before DB, configuration or broadcast: %s', async endpoint => {
    await expect(call(IPC_CHANNELS.SETTINGS_SET, key, endpoint)).rejects.toThrow()
    expect(getDatabase().exec('SELECT value FROM settings WHERE key=?', [key])[0]?.values ?? []).toHaveLength(0)
    expect(configureComfyUI).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled()
  })

  it('returns the safe runtime endpoint without exporting credentials from a legacy saved URL', async () => {
    const saved = 'https://user:synthetic-old-secret@comfy.example'
    getDatabase().run('INSERT INTO settings (key,value) VALUES (?,?)', [key, saved])
    const settings = await call(IPC_CHANNELS.SETTINGS_GET_ALL)
    expect(settings).toMatchObject({ [key]: defaultAddress })
    expect(JSON.stringify(settings)).not.toContain('synthetic-old-secret')
    expect(configureComfyUI).toHaveBeenCalledWith(defaultAddress)
    expect(getDatabase().exec('SELECT value FROM settings WHERE key=?', [key])[0].values[0][0]).toBe(saved)
  })
})
