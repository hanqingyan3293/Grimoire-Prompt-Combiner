import type { Provider } from '../../shared/types'

export type ProviderWithSecrets = Provider & {
  api_key: string
  config_toml: string
  auth_json: string
}

export function toPublicProvider(provider: ProviderWithSecrets): Provider {
  const { api_key: _apiKey, config_toml: _configToml, auth_json: _authJson, ...publicProvider } = provider
  return publicProvider
}
