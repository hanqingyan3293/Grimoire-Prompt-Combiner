import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => 'C:/tmp/grimoire-organize-provider' },
  ipcMain: { handle: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (value: string) => value, decryptString: (value: string) => value },
}))

import type { Provider } from '../../shared/types'
import { NovelaiOrganizeError } from './novelai-organize.service'
import { createNovelaiProviderModelCall, readNovelaiProviderText } from './novelai-organize-provider'

type ActiveProvider = Provider & { api_key?: string }

function provider(patch: Partial<ActiveProvider> = {}): ActiveProvider {
  return {
    id: 'provider-1',
    name: 'Configured provider',
    access_mode: 'api',
    protocol: 'chat_completions',
    base_url: 'https://provider.example.invalid/v1',
    has_api_key: true,
    has_auth_config: false,
    default_model: 'configured-model',
    test_model: '',
    context_size: null,
    models: [],
    is_active: true,
    created_at: '',
    updated_at: '',
    api_key: 'decrypted-secret',
    ...patch,
  }
}

function codeOf(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : undefined
}

describe('NovelAI organize provider adapter (M6.5)', () => {
  it('sends with the active provider configured model and main-process credential', async () => {
    const complete = vi.fn(async () => '{"changes":[]}')
    const call = createNovelaiProviderModelCall({ getProvider: async () => provider(), complete })
    await expect(call({ system: 'system instruction', user: '{"blocks":[]}' })).resolves.toBe('{"changes":[]}')
    expect(complete).toHaveBeenCalledWith({
      provider: expect.objectContaining({ id: 'provider-1' }),
      model: 'configured-model',
      apiKey: 'decrypted-secret',
      system: 'system instruction',
      user: '{"blocks":[]}',
    })
  })

  it('refuses to invent a provider, endpoint or model when none is configured', async () => {
    const cases: Array<[ActiveProvider | null, string]> = [
      [null, 'PROVIDER_UNAVAILABLE'],
      [provider({ base_url: '' }), 'PROVIDER_UNAVAILABLE'],
      [provider({ default_model: '   ' }), 'PROVIDER_UNAVAILABLE'],
    ]
    for (const [active, code] of cases) {
      const complete = vi.fn(async () => '{"changes":[]}')
      const call = createNovelaiProviderModelCall({ getProvider: async () => active, complete })
      try {
        await call({ system: 's', user: 'u' })
        throw new Error('expected provider refusal')
      } catch (error) {
        expect(error).toBeInstanceOf(NovelaiOrganizeError)
        expect(codeOf(error)).toBe(code)
      }
      expect(complete).not.toHaveBeenCalled()
    }
  })

  it('turns malformed chat-completion payloads into a visible request error', () => {
    for (const payload of [null, {}, { choices: [] }, { choices: [{ message: { content: '' } }] }, { choices: [{ message: { content: 42 } }] }]) {
      try {
        readNovelaiProviderText('chat_completions', payload)
        throw new Error('expected malformed payload refusal')
      } catch (error) {
        expect(error).toBeInstanceOf(NovelaiOrganizeError)
        expect(codeOf(error)).toBe('REQUEST_FAILED')
        expect((error as Error).message).toMatch(/provider response/i)
      }
    }
    expect(readNovelaiProviderText('chat_completions', { choices: [{ message: { content: 'ok' } }] })).toBe('ok')
  })

  it('turns malformed responses payloads into a visible request error', () => {
    for (const payload of [null, {}, { output_text: '' }, { output_text: 42 }]) {
      try {
        readNovelaiProviderText('responses', payload)
        throw new Error('expected malformed payload refusal')
      } catch (error) {
        expect(error).toBeInstanceOf(NovelaiOrganizeError)
        expect(codeOf(error)).toBe('REQUEST_FAILED')
      }
    }
    expect(readNovelaiProviderText('responses', { output_text: 'ok' })).toBe('ok')
  })
})
