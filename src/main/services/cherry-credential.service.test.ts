import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
const store = new Map<string, string>()
let encryptionAvailable = true

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'exe' ? path.join(testRoot, 'Grimoire.exe') : testRoot) },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (value: string) => Buffer.from('enc:' + value),
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString()
      if (!text.startsWith('enc:')) throw new Error('bad ciphertext')
      return text.slice(4)
    },
  },
}))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { readCredentialPreference, writeCredentialPreference, CredentialError } from './cherry-credential.service'

const KEY = 'chat.web_search.provider_overrides'

beforeEach(async () => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-cred-'))
  store.clear()
  await initDatabase()
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(testRoot, { recursive: true, force: true })
})

describe('credential preference store (M3)', () => {
  it('encrypts credential fields at rest and returns plaintext only in the main process', () => {
    writeCredentialPreference(KEY, { searxng: { apiKeys: ['tv-secret'], capabilities: { searchKeywords: { apiHost: 'http://127.0.0.1:9' } } } })
    const raw = String(getDatabase().exec('SELECT value FROM settings WHERE key=?', ['cherry_pref.' + KEY])[0].values[0][0])
    // The secret must not appear anywhere in the stored bytes, and non-credential fields stay readable.
    expect(raw).not.toContain('tv-secret')
    expect(raw).toContain('enc:v1:')
    expect(raw).toContain('http://127.0.0.1:9')
    const read = readCredentialPreference(KEY) as { searxng: { apiKeys: string[]; capabilities: { searchKeywords: { apiHost: string } } } }
    expect(read.searxng.apiKeys).toEqual(['tv-secret'])
    expect(read.searxng.capabilities.searchKeywords.apiHost).toBe('http://127.0.0.1:9')
  })

  it('refuses to store a credential when OS encryption is unavailable', () => {
    encryptionAvailable = false
    try {
      expect(() => writeCredentialPreference(KEY, { tavily: { apiKeys: ['x'] } })).toThrow(CredentialError)
      expect(getDatabase().exec('SELECT value FROM settings WHERE key=?', ['cherry_pref.' + KEY])[0]?.values?.length ?? 0).toBe(0)
    } finally {
      encryptionAvailable = true
    }
  })

  it('rejects keys that are not declared credentials', () => {
    expect(() => writeCredentialPreference('feature.api_gateway.host', { a: 1 })).toThrow(/NOT_PROTECTED|not a protected/)
  })

  it('rejects a non-JSON payload instead of storing junk', () => {
    expect(() => writeCredentialPreference(KEY, 'not json')).toThrow(CredentialError)
  })
})
