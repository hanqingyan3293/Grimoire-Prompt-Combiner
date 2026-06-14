// 魔导书 Grimoire v7 — AI API 客户端封装
// 职责: 封装 openai SDK, 不接触 IPC, 纯函数

import OpenAI from 'openai'

export interface ProviderConfig {
  base_url?: string
  api_key?: string
}

// 创建 OpenAI 客户端
export function createClient(provider: ProviderConfig): OpenAI {
  return new OpenAI({
    baseURL: provider.base_url || 'https://api.openai.com/v1',
    apiKey: provider.api_key || '',
    dangerouslyAllowBrowser: false,
  })
}

// 流式聊天 — 返回异步迭代器
export async function* chatStream(
  client: OpenAI,
  model: string,
  messages: Array<{ role: string; content: string | any[] }>,
): AsyncGenerator<string, void, unknown> {
  const stream = await client.chat.completions.create({
    model,
    messages: messages as any,
    stream: true,
  })
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content
    if (delta) yield delta
  }
}

// 识图 — 返回标签 JSON 字符串
export async function vision(
  client: OpenAI,
  model: string,
  imageBase64: string,
  prompt?: string,
): Promise<string> {
  const response = await client.chat.completions.create({
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
        { type: 'text', text: prompt || '请识别此图片内容，以JSON数组格式返回中英文标签。格式: [{"en":"tag","zh":"标签"}]。只返回JSON，不要其他文字。' },
      ],
    }],
  })
  return (response.choices[0]?.message?.content as string) || '[]'
}

// 生图 — 返回图片 URL
export async function generateImage(
  client: OpenAI,
  model: string,
  prompt: string,
): Promise<string> {
  const response = await client.images.generate({
    model,
    prompt,
    n: 1,
    size: '1024x1024',
  })
  return response.data?.[0]?.url || ''
}

// 从上游获取模型列表
export async function fetchModels(client: OpenAI): Promise<string[]> {
  const response = await client.models.list()
  return response.data
    .map(m => m.id)
    .filter(id =>
      !id.includes('audio') &&
      !id.includes('tts') &&
      !id.includes('whisper') &&
      !id.includes('dall-e')
    )
    .sort()
}