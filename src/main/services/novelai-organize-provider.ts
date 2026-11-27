import type { Provider } from '../../shared/types'
import { createClient } from '../ai/client'
import { NovelaiOrganizeError, type NovelaiOrganizeModelCall } from './novelai-organize.service'

// The organize planner is a single bounded prompt, not an Agent turn. It reuses the active
// provider's stored endpoint, protocol and decrypted credential, and refuses to guess a
// model: the provider's own default_model is the only model this adapter will send.
export type ActiveOrganizeProvider = Provider & { api_key?: string }

export interface NovelaiProviderCompletionInput {
  readonly provider: ActiveOrganizeProvider
  readonly model: string
  readonly apiKey: string
  readonly system: string
  readonly user: string
}

export type NovelaiProviderCompletion = (input: NovelaiProviderCompletionInput) => Promise<string>

/** Extract text from a non-streaming provider response. A shape this adapter does not
 * understand is an error, not an empty plan, so the user sees why nothing was proposed. */
export function readNovelaiProviderText(protocol: 'chat_completions' | 'responses', payload: unknown): string {
  if (payload && typeof payload === 'object') {
    if (protocol === 'responses') {
      const value = (payload as { output_text?: unknown }).output_text
      if (typeof value === 'string' && value.trim()) return value
    } else {
      const choices = (payload as { choices?: unknown }).choices
      const first = Array.isArray(choices) ? choices[0] : undefined
      const message = first && typeof first === 'object' ? (first as { message?: unknown }).message : undefined
      const content = message && typeof message === 'object' ? (message as { content?: unknown }).content : undefined
      if (typeof content === 'string' && content.trim()) return content
    }
  }
  throw new NovelaiOrganizeError('REQUEST_FAILED', 'provider response did not contain text')
}

async function completeWithProvider(input: NovelaiProviderCompletionInput): Promise<string> {
  try {
    const client = createClient({ base_url: input.provider.base_url, api_key: input.apiKey, protocol: input.provider.protocol })
    if (input.provider.protocol === 'responses') {
      const response = await client.responses.create({
        model: input.model,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: input.system }] },
          { role: 'user', content: [{ type: 'input_text', text: input.user }] },
        ],
      } as never)
      return readNovelaiProviderText('responses', response)
    }
    const response = await client.chat.completions.create({
      model: input.model,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
    })
    return readNovelaiProviderText('chat_completions', response)
  } catch (error) {
    if (error instanceof NovelaiOrganizeError) throw error
    throw new NovelaiOrganizeError('REQUEST_FAILED', error instanceof Error ? error.message : String(error))
  }
}

export function createNovelaiProviderModelCall(options: {
  getProvider: () => Promise<ActiveOrganizeProvider | null>
  complete?: NovelaiProviderCompletion
}): NovelaiOrganizeModelCall {
  const complete = options.complete ?? completeWithProvider
  return async ({ system, user }) => {
    const provider = await options.getProvider()
    if (!provider) throw new NovelaiOrganizeError('PROVIDER_UNAVAILABLE', '请先在设置中配置并启用一个 AI 供应商')
    const baseUrl = typeof provider.base_url === 'string' ? provider.base_url.trim() : ''
    if (!baseUrl) throw new NovelaiOrganizeError('PROVIDER_UNAVAILABLE', '当前供应商没有配置接口地址')
    const model = typeof provider.default_model === 'string' ? provider.default_model.trim() : ''
    if (!model) throw new NovelaiOrganizeError('PROVIDER_UNAVAILABLE', '当前供应商没有配置默认模型')
    const apiKey = typeof provider.api_key === 'string' ? provider.api_key : ''
    return complete({ provider, model, apiKey, system, user })
  }
}
