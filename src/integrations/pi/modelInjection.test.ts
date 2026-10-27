import { describe, expect, it, vi } from 'vitest'
import {
  buildPiProviderInjection, resolvePiProviderInjection, PI_PLACEHOLDER_API_KEY,
  PiMissingApiKeyError, PiUnsupportedProviderError,
  type PiProviderSnapshot, type PiModelSnapshot
} from './modelInjection'

const provider: PiProviderSnapshot = {
  id: 'fixture', name: 'Fixture', route: 'direct-api-key',
  api: 'openai-completions', baseUrl: 'https://fixture.invalid/v1'
}
const model: PiModelSnapshot = {
  id: 'fixture::selected', providerId: 'fixture', apiModelId: 'wire/selected',
  name: 'Selected', capabilities: []
}

// Fake literal only; no credentials, profile, extension driver, or requests.
describe('source Pi model injection through main-owned ports', () => {
  it('keeps the literal credential separate from placeholder registration', () => {
    const result = buildPiProviderInjection(provider, model, '!not-a-command$FAKE')
    expect(result.apiKey).toBe('!not-a-command$FAKE')
    expect(result.providerConfig.apiKey).toBe(PI_PLACEHOLDER_API_KEY)
    expect(JSON.stringify(result.providerConfig)).not.toContain('!not-a-command$FAKE')
    expect(result.modelId).toBe('wire/selected')
    expect(result.providerConfig.models[0]).toMatchObject({
      id: 'wire/selected', contextWindow: 256_000, maxTokens: 8192,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, input: ['text']
    })
  })

  it('preserves source image/reasoning/dialect and model window mapping', () => {
    const result = buildPiProviderInjection({ ...provider, supportsDeveloperRole: true }, {
      ...model, capabilities: ['image-recognition', 'reasoning'], contextWindow: 128_000,
      maxOutputTokens: 4096, reasoning: { selectableEfforts: ['none', 'low', 'high', 'max'] }
    }, 'fake')
    expect(result.providerConfig.models[0]).toMatchObject({
      input: ['text', 'image'], reasoning: true, contextWindow: 128_000, maxTokens: 4096,
      compat: { supportsDeveloperRole: true },
      thinkingLevelMap: { off: 'none', low: 'low', medium: null, high: 'high', max: 'max' }
    })
  })

  it('omits a thinking ladder for toggle-only models', () => {
    const result = buildPiProviderInjection(provider, { ...model, reasoning: { selectableEfforts: ['none', 'auto'] } }, 'fake')
    expect(result.providerConfig.models[0]).not.toHaveProperty('thinkingLevelMap')
  })

  it('coerces source headers and escapes interpolation without changing their intended literals', () => {
    const result = buildPiProviderInjection({ ...provider, headers: {
      'x-env': 'a$b${HOME}', 'x-command': '!never-run', 'x-number': 42,
      'x-null': null, 'x-object': { secret: true }
    } }, model, 'fake')
    expect(result.providerConfig.headers).toEqual({
      'x-env': 'a$$b$${HOME}', 'x-command': '$!never-run', 'x-number': '42'
    })
  })

  it.each(['oauth', 'gateway', 'external-cli'] as const)('refuses unapproved %s before selecting a key', async route => {
    const host = { getSnapshot: vi.fn().mockResolvedValue({ provider: { ...provider, route }, model }), resolveApiKey: vi.fn() }
    await expect(resolvePiProviderInjection(model.id, host)).rejects.toThrow(PiUnsupportedProviderError)
    expect(host.resolveApiKey).not.toHaveBeenCalled()
  })

  it('refuses unsupported API and source thinking replay routes rather than losing behavior', () => {
    expect(() => buildPiProviderInjection({ ...provider, api: 'ollama-chat' }, model, '')).toThrow(PiUnsupportedProviderError)
    expect(() => buildPiProviderInjection({ ...provider, requiresThinkingReplay: true }, model, '')).toThrow(PiUnsupportedProviderError)
  })

  it('requires a usable key unless the main snapshot explicitly permits keyless auth', () => {
    expect(() => buildPiProviderInjection(provider, model, '  ')).toThrow(PiMissingApiKeyError)
    expect(buildPiProviderInjection({ ...provider, authOptional: true }, model, '').apiKey).toBe(PI_PLACEHOLDER_API_KEY)
  })

  it('passes Azure request facts without mutating the process environment', () => {
    const before = process.env.AZURE_OPENAI_API_VERSION
    expect(buildPiProviderInjection({ ...provider, api: 'azure-openai-responses', apiVersion: 'test-version' }, model, 'fake')
      .requestEnvironment).toEqual({ AZURE_OPENAI_API_VERSION: 'test-version' })
    expect(process.env.AZURE_OPENAI_API_VERSION).toBe(before)
  })

  it.each(['!command', '$ENDPOINT', 'file:///fixture', 'https://user:password@fixture.invalid/v1'])('refuses nonliteral/credentialed endpoint %s', baseUrl => {
    expect(() => buildPiProviderInjection({ ...provider, baseUrl }, model, 'fake')).toThrow('resolved literal HTTP(S) endpoint')
  })

  it('reads one exact snapshot and then selects its credential through the main host', async () => {
    const host = { getSnapshot: vi.fn().mockResolvedValue({ provider, model }), resolveApiKey: vi.fn().mockResolvedValue('fake') }
    expect((await resolvePiProviderInjection(model.id, host)).modelId).toBe('wire/selected')
    expect(host.getSnapshot).toHaveBeenCalledExactlyOnceWith(model.id)
    expect(host.resolveApiKey).toHaveBeenCalledExactlyOnceWith('fixture')
  })

  it('refuses wrong provider/model identities and malformed composite IDs before key selection', async () => {
    const host = { getSnapshot: vi.fn().mockResolvedValue({ provider, model: { ...model, id: 'fixture::different' } }), resolveApiKey: vi.fn() }
    await expect(resolvePiProviderInjection(model.id, host)).rejects.toThrow('requested identity')
    await expect(resolvePiProviderInjection('fixture::selected::extra', host)).rejects.toThrow('composite')
    expect(host.resolveApiKey).not.toHaveBeenCalled()
    expect(() => buildPiProviderInjection(provider, { ...model, providerId: 'other' }, 'fake')).toThrow('identity mismatch')
  })
})
