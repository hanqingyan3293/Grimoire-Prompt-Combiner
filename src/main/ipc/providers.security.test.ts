import { describe, expect, it } from 'vitest'
import { toPublicProvider } from '../services/provider-contract'

describe('provider renderer contract', () => {
  it('defines public provider data without secret fields', () => {
    const publicProvider = toPublicProvider({
      id: 'pvd_demo',
      name: 'Demo',
      access_mode: 'api',
      protocol: 'chat_completions',
      base_url: 'https://example.com/v1',
      has_api_key: true,
      has_auth_config: false,
      api_key: 'secret',
      config_toml: 'token=secret',
      auth_json: '{"token":"secret"}',
      default_model: 'demo',
      test_model: 'demo',
      context_size: null,
      models: [],
      is_active: true,
      created_at: '',
      updated_at: '',
    })

    expect(publicProvider).toHaveProperty('has_api_key', true)
    expect(publicProvider).not.toHaveProperty('api_key')
    expect(publicProvider).not.toHaveProperty('config_toml')
    expect(publicProvider).not.toHaveProperty('auth_json')
  })
})
