/** Credential-bearing Cherry preferences cannot use the generic renderer settings
 * write path. Their dedicated main-process credential adapters are not connected yet. */
export const CHERRY_SETTINGS_SECRET_MASK = '********'

const protectedPreferences = new Set([
  'feature.api_gateway.api_key',
  'chat.web_search.provider_overrides'
])

export function isProtectedCherryPreference(key: string): boolean {
  return protectedPreferences.has(key)
}

export function isProtectedCherrySetting(key: string): boolean {
  return key.startsWith('cherry_pref.') && isProtectedCherryPreference(key.slice('cherry_pref.'.length))
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function masked(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(masked)
  if (typeof value === 'string') return value ? CHERRY_SETTINGS_SECRET_MASK : ''
  if (plainObject(value)) return Object.fromEntries(Object.keys(value).map(key => [key, masked(value[key])]))
  return value == null ? value : CHERRY_SETTINGS_SECRET_MASK
}

function redactOverrides(value: unknown): Record<string, unknown> {
  if (!plainObject(value)) throw new Error('Cherry credential settings could not be safely decoded')
  return Object.fromEntries(Object.entries(value).map(([provider, override]) => {
    if (!plainObject(override)) throw new Error('Cherry credential settings could not be safely decoded')
    return [provider, Object.fromEntries(Object.entries(override).map(([field, entry]) => {
      const normalized = field.replace(/[-_]/g, '').toLowerCase()
      const credential = /apikey|token|password|authorization|secret/.test(normalized) || normalized === 'headers'
      return [field, credential ? masked(entry) : entry]
    }))]
  }))
}

/** Keeps the source preference wire shape, never decrypts or exposes stored credentials.
 * Invalid credential JSON rejects rather than leaking its raw value or inventing absence. */
export function redactCherrySetting(key: string, raw: string): string
export function redactCherrySetting(key: string, raw: unknown): unknown
export function redactCherrySetting(key: string, raw: unknown): unknown {
  if (!isProtectedCherrySetting(key)) return raw
  let value: unknown = raw
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw) } catch { throw new Error('Cherry credential settings could not be safely decoded') }
  }
  if (key === 'cherry_pref.feature.api_gateway.api_key') {
    if (typeof value !== 'string') throw new Error('Cherry gateway credential could not be safely decoded')
    return JSON.stringify(value ? CHERRY_SETTINGS_SECRET_MASK : '')
  }
  return JSON.stringify(redactOverrides(value))
}
