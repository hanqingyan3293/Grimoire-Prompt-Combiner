import { safeStorage } from 'electron'
import { getDatabase } from '../database'
import { isProtectedCherryPreference } from '../../shared/cherry-settings-privacy'
// Main-process credential store for protected Cherry preferences (M3).
//
// Why this exists: `settings:set` refuses protected preferences on purpose (a renderer must not be able
// to write credentials through a generic path). That guard made the web-search page unusable, because
// its provider overrides *are* credentials. The fix is not to weaken the guard but to give those keys a
// dedicated path: writes are encrypted at rest here, renderer reads stay masked, and only this process
// can recover the plaintext.
export class CredentialError extends Error {
  constructor(readonly code: 'ENCRYPTION_UNAVAILABLE' | 'BAD_PAYLOAD' | 'NOT_PROTECTED', message: string) {
    super(message)
    this.name = 'CredentialError'
  }
}
const ENCRYPTED_PREFIX = 'enc:v1:'
const SECRET_FIELD = /apikey|token|password|authorization|secret/i
function isCredentialField(field: string): boolean {
  return SECRET_FIELD.test(field.replace(/[-_]/g, ''))
}
function encryptString(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    // Never fall back to plaintext: a stored secret that is not encrypted is worse than a refused write.
    throw new CredentialError('ENCRYPTION_UNAVAILABLE', 'OS encryption is unavailable; credential was not stored')
  }
  return ENCRYPTED_PREFIX + safeStorage.encryptString(plain).toString('base64')
}
function decryptString(value: string): string {
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value
  if (!safeStorage.isEncryptionAvailable()) throw new CredentialError('ENCRYPTION_UNAVAILABLE', 'OS encryption is unavailable; credential cannot be read')
  return safeStorage.decryptString(Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64'))
}
function mapStrings(value: unknown, transform: (input: string) => string): unknown {
  if (typeof value === 'string') return transform(value)
  if (Array.isArray(value)) return value.map(item => mapStrings(item, transform))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      // Recurse into every nested object so a credential three levels down is still transformed; only
      // scalar non-credential values are left untouched.
      entry !== null && typeof entry === 'object' ? mapStrings(entry, transform) : isCredentialField(key) ? mapStrings(entry, transform) : entry,
    ]))
  }
  return value
}
export function writeCredentialPreference(name: string, value: unknown): void {
  if (!isProtectedCherryPreference(name)) throw new CredentialError('NOT_PROTECTED', 'not a protected preference: ' + name)
  let payload: unknown = value
  if (typeof value === 'string') {
    try { payload = JSON.parse(value) } catch { throw new CredentialError('BAD_PAYLOAD', 'credential payload is not JSON') }
  }
  // Two shapes are legitimate: an object of provider overrides, and a bare secret string
  // (`feature.api_gateway.api_key` is stored that way by the source page).
  if (typeof payload === 'string') {
    getDatabase().run(
      'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=?',
      ['cherry_pref.' + name, JSON.stringify(encryptString(payload)), JSON.stringify(encryptString(payload))],
    )
    return
  }
  if (!payload || typeof payload !== 'object') throw new CredentialError('BAD_PAYLOAD', 'credential payload must be an object or a string')
  const encrypted = mapStrings(payload, encryptString)
  const stored = JSON.stringify(encrypted)
  getDatabase().run(
    'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=?',
    ['cherry_pref.' + name, stored, stored],
  )
}
/** Main-process only: recovers plaintext for the consumers that actually call the upstream. */
export function readCredentialPreference(name: string): unknown {
  if (!isProtectedCherryPreference(name)) throw new CredentialError('NOT_PROTECTED', 'not a protected preference: ' + name)
  const row = getDatabase().exec('SELECT value FROM settings WHERE key=?', ['cherry_pref.' + name])[0]?.values?.[0]?.[0]
  if (typeof row !== 'string') return undefined
  let parsed: unknown
  try { parsed = JSON.parse(row) } catch { throw new CredentialError('BAD_PAYLOAD', 'stored credential is not JSON') }
  return mapStrings(parsed, decryptString)
}
