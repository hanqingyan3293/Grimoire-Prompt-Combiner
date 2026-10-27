// 魔导书 Grimoire v7 — AI API 客户端封装
// 职责: 封装 openai SDK, 不接触 IPC, 纯函数

import OpenAI from 'openai'

export interface ProviderConfig {
  base_url?: string
  api_key?: string
  protocol?: 'chat_completions' | 'responses'
}

export function createClient(provider: ProviderConfig): OpenAI {
  return new OpenAI({ baseURL: provider.base_url || 'https://api.openai.com/v1', apiKey: provider.api_key || '', dangerouslyAllowBrowser: false })
}

/**
 * A streamed text delta, optionally carrying the usage the provider reported on that chunk.
 *
 * The return type changed from a bare `string` because the previous shape DISCARDED usage
 * entirely — so the runtime's usage capture only ever ran on the tool-calling branch, and
 * ordinary chat (no tools) recorded nothing. A test over a real SSE server caught it:
 * `stream_options` never reached the wire on the no-tools path.
 *
 * `usage` is present only on the provider's final chunk, and only when it was requested.
 */
export type ChatStreamChunk = { text: string; usage?: unknown }

export async function* chatStream(client: OpenAI, model: string, messages: Array<{ role: string; content: string | any[] }>, signal?: AbortSignal): AsyncGenerator<ChatStreamChunk, void, unknown> {
  // `stream_options` is not in this SDK version's param type, hence the cast. Requesting it is
  // what makes the provider emit a usage-bearing final chunk at all.
  const stream = await client.chat.completions.create({ model, messages: messages as any, stream: true, stream_options: { include_usage: true } } as any, { signal }) as unknown as AsyncIterable<any>
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content
    if (delta) yield { text: String(delta) }
    // The final chunk carries an empty `choices` array and the usage; emit it so the caller can
    // account for the call.
    else if (chunk.usage) yield { text: '', usage: chunk.usage }
  }
}

export async function vision(client: OpenAI, model: string, imageBase64: string, prompt?: string, protocol: 'chat_completions' | 'responses' = 'chat_completions'): Promise<string> {
  if (protocol === 'responses') {
    const response = await client.responses.create({
      model,
      input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,' + imageBase64 }, { type: 'input_text', text: prompt || '请分析这张图片并返回结构化标签。' }] }],
    } as any)
    return String((response as any).output_text || '')
  }
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + imageBase64 } }, { type: 'text', text: prompt || '请识别此图片内容，以JSON数组格式返回中英文标签。格式: [{"en":"tag","zh":"标签"}]。只返回JSON，不要其他文字。' }] }],
  })
  return (response.choices[0]?.message?.content as string) || '[]'
}

export async function generateImage(client: OpenAI, model: string, prompt: string): Promise<string> {
  const response = await client.images.generate({ model, prompt, n: 1, size: '1024x1024' })
  return response.data?.[0]?.url || ''
}

export async function fetchModels(client: OpenAI): Promise<string[]> {
  const response = await client.models.list()
  return response.data.map(m => m.id).filter(id => !id.includes('audio') && !id.includes('tts') && !id.includes('whisper') && !id.includes('dall-e')).sort()
}
