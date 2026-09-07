import { describe, expect, it } from 'vitest'
import { requireHttpUrl, validateProviderRequest, validateProviderSaveInput } from './input-validation'

describe('input validation', () => {
  it('allows HTTPS and loopback HTTP only', () => {
    expect(requireHttpUrl('https://example.com/v1')).toBe('https://example.com/v1')
    expect(requireHttpUrl('http://127.0.0.1:8188/')).toBe('http://127.0.0.1:8188')
    expect(() => requireHttpUrl('http://example.com')).toThrow()
  })

  it('rejects malformed provider requests and oversized values', () => {
    expect(() => validateProviderRequest('https://example.com', '', 'model')).toThrow('API Key')
    expect(() => validateProviderSaveInput({ name: 'x', base_url: 'https://example.com', models: ['x'.repeat(301)] })).toThrow('模型列表')
    expect(() => validateProviderSaveInput({ id: '../bad', name: 'x' })).toThrow('id')
  })

  it('normalizes provider defaults without returning secrets', () => {
    const input = validateProviderSaveInput({ name: 'demo' })
    expect(input).toMatchObject({ name: 'demo', base_url: 'https://api.openai.com/v1', default_model: 'gpt-4o', models: [] })
    expect(input).not.toHaveProperty('decrypted_api_key')
  })
})
