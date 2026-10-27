import { describe, expect, it } from 'vitest'
import { fetchProviderModels, normalizeModelsPayload, resolveProviderConnection, testProviderConnection, type ProviderFetch } from './provider-connection.service'

type FetchCall = { input: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }
type FetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> }

const calls: FetchCall[] = []
const responses: Array<Error | FetchResponse> = []

const fakeFetch: ProviderFetch = async (input, init) => {
  calls.push({ input, init })
  const next = responses.shift()
  if (!next) throw new Error('no queued response')
  if (next instanceof Error) throw next
  return next
}

function queue(...items: Array<Error | FetchResponse>): void {
  responses.length = 0
  responses.push(...items)
}

describe('provider connection service', () => {
  it('prefers the supplied key and otherwise falls back to the stored decrypted key', () => {
    const withStored = resolveProviderConnection({ providerId: 'pvd_a', baseUrl: 'https://api.example.com/v1/', storedApiKey: 'stored-secret', protocol: 'responses', fallbackModel: 'gpt-4o' })
    expect(withStored).toMatchObject({ id: 'pvd_a', baseUrl: 'https://api.example.com/v1', apiKey: 'stored-secret', protocol: 'responses', model: 'gpt-4o' })

    const withSupplied = resolveProviderConnection({ providerId: 'pvd_a', baseUrl: 'https://api.example.com/v1', apiKey: '  typed-secret  ', storedApiKey: 'stored-secret', model: 'gpt-4o-mini' })
    expect(withSupplied.apiKey).toBe('typed-secret')
    expect(withSupplied.model).toBe('gpt-4o-mini')
  })

  it('allows a login provider with no key but rejects invalid urls and ids', () => {
    const login = resolveProviderConnection({ providerId: 'pvd_login', baseUrl: 'https://api.example.com/v1', storedApiKey: '', model: '' })
    expect(login.apiKey).toBe('')
    expect(login.model).toBe('')

    expect(() => resolveProviderConnection({ providerId: 'bad id!', baseUrl: 'https://api.example.com/v1' })).toThrow('Provider 格式无效')
    expect(() => resolveProviderConnection({ providerId: 'pvd_a', baseUrl: 'http://remote.example.com/v1' })).toThrow('必须使用 HTTPS')
    expect(() => resolveProviderConnection({ providerId: 'pvd_a', baseUrl: 'http://localhost:11434/v1' })).not.toThrow()
  })

  it('normalizes duplicate, malformed and unsorted model payloads', () => {
    expect(normalizeModelsPayload({ data: [{ id: 'z-model' }, { id: ' a-model ' }, { id: 'a-model' }, { id: 42 }, null, { nope: true }] })).toEqual(['a-model', 'z-model'])
    expect(normalizeModelsPayload({ data: 'not-an-array' })).toEqual([])
    expect(normalizeModelsPayload(null)).toEqual([])
  })

  it('fetches models with the bearer header only when a key exists', async () => {
    calls.length = 0
    queue({ ok: true, status: 200, json: async () => ({ data: [{ id: 'b' }, { id: 'a' }] }) })
    const result = await fetchProviderModels({ id: 'pvd_a', baseUrl: 'https://api.example.com/v1', apiKey: 'k', protocol: 'chat_completions', model: 'm' }, fakeFetch)
    expect(result).toEqual({ success: true, models: ['a', 'b'] })
    expect(calls[0].input).toBe('https://api.example.com/v1/models')
    expect(calls[0].init?.headers).toMatchObject({ Authorization: 'Bearer k' })

    queue({ ok: true, status: 200, json: async () => ({ data: [] }) })
    await fetchProviderModels({ id: 'pvd_b', baseUrl: 'https://api.example.com/v1', apiKey: '', protocol: 'chat_completions', model: 'm' }, fakeFetch)
    expect(calls[1].init?.headers ?? {}).toEqual({})
  })

  it('maps http failures and network errors to diagnostics', async () => {
    queue({ ok: false, status: 500, json: async () => ({}) })
    expect(await fetchProviderModels({ id: 'pvd_a', baseUrl: 'https://api.example.com/v1', apiKey: 'k', protocol: 'chat_completions', model: 'm' }, fakeFetch)).toEqual({ success: false, error: 'HTTP 500' })

    queue(new Error('socket hang up'))
    expect(await fetchProviderModels({ id: 'pvd_a', baseUrl: 'https://api.example.com/v1', apiKey: 'k', protocol: 'chat_completions', model: 'm' }, fakeFetch)).toEqual({ success: false, error: 'socket hang up' })
  })

  it('tests chat completions and responses endpoints with the right protocol path', async () => {
    calls.length = 0
    queue({ ok: true, status: 200, json: async () => ({}) })
    const chat = await testProviderConnection({ id: 'pvd_a', baseUrl: 'https://api.example.com/v1', apiKey: 'k', protocol: 'chat_completions', model: 'gpt-4o' }, fakeFetch)
    expect(chat).toEqual({ success: true, message: '连接成功' })
    expect(calls[0].input).toBe('https://api.example.com/v1/chat/completions')
    expect(calls[0].init?.body).toContain('"max_tokens":1')

    queue({ ok: true, status: 200, json: async () => ({}) })
    await testProviderConnection({ id: 'pvd_a', baseUrl: 'https://api.example.com/v1', apiKey: 'k', protocol: 'responses', model: 'gpt-4o' }, fakeFetch)
    expect(calls[1].input).toBe('https://api.example.com/v1/responses')
    expect(calls[1].init?.body).toContain('input_text')

    queue({ ok: false, status: 400, json: async () => ({}) })
    expect(await testProviderConnection({ id: 'pvd_a', baseUrl: 'https://api.example.com/v1', apiKey: 'k', protocol: 'chat_completions', model: 'gpt-4o' }, fakeFetch)).toMatchObject({ success: true })

    queue({ ok: false, status: 401, json: async () => ({}) })
    expect(await testProviderConnection({ id: 'pvd_a', baseUrl: 'https://api.example.com/v1', apiKey: 'k', protocol: 'chat_completions', model: 'gpt-4o' }, fakeFetch)).toEqual({ success: false, error: 'API Key 无效' })

    queue({ ok: false, status: 502, json: async () => ({}) })
    expect(await testProviderConnection({ id: 'pvd_a', baseUrl: 'https://api.example.com/v1', apiKey: 'k', protocol: 'chat_completions', model: 'gpt-4o' }, fakeFetch)).toEqual({ success: false, error: '状态码 502' })
  })
})
