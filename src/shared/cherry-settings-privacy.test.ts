import { describe, expect, it } from 'vitest'
import { CHERRY_SETTINGS_SECRET_MASK, isProtectedCherryPreference, isProtectedCherrySetting, redactCherrySetting } from './cherry-settings-privacy'

describe('Cherry settings credential projection', () => {
  const canary = 'synthetic-settings-secret-canary'

  it('masks a gateway credential without claiming the saved key is absent', () => {
    const projected = redactCherrySetting('cherry_pref.feature.api_gateway.api_key', JSON.stringify(canary))
    expect(projected).toBe(JSON.stringify(CHERRY_SETTINGS_SECRET_MASK))
    expect(String(projected)).not.toContain(canary)
    expect(redactCherrySetting('cherry_pref.feature.api_gateway.api_key', '""')).toBe('""')
  })

  it('preserves non-secret search options and credential counts, but not values', () => {
    const raw = JSON.stringify({ tavily: { apiKeys: [canary, canary + '-2'], apiHost: 'https://example.invalid', basicAuthPassword: canary, headers: { Authorization: canary }, maxResults: 10, isEnabled: false } })
    const projected = String(redactCherrySetting('cherry_pref.chat.web_search.provider_overrides', raw))
    expect(projected).not.toContain(canary)
    expect(JSON.parse(projected).tavily).toEqual({ apiKeys: [CHERRY_SETTINGS_SECRET_MASK, CHERRY_SETTINGS_SECRET_MASK], apiHost: 'https://example.invalid', basicAuthPassword: CHERRY_SETTINGS_SECRET_MASK, headers: { Authorization: CHERRY_SETTINGS_SECRET_MASK }, maxResults: 10, isEnabled: false })
  })

  it.each(['not-json', '[]', 'null', '{"tavily":null}'])('refuses malformed credential JSON without echoing it: %s', raw => {
    expect(() => redactCherrySetting('cherry_pref.chat.web_search.provider_overrides', raw)).toThrow('could not be safely decoded')
  })

  it('leaves unrelated preferences untouched and marks protected writes exactly', () => {
    expect(redactCherrySetting('cherry_pref.ui.theme_mode', '"dark"')).toBe('"dark"')
    expect(isProtectedCherryPreference('feature.api_gateway.api_key')).toBe(true)
    expect(isProtectedCherryPreference('chat.web_search.provider_overrides')).toBe(true)
    expect(isProtectedCherrySetting('cherry_pref.chat.web_search.provider_overrides')).toBe(true)
    expect(isProtectedCherrySetting('cherry_pref.chat.web_search.enabled')).toBe(false)
    expect(isProtectedCherrySetting('api_key')).toBe(false)
  })
})
