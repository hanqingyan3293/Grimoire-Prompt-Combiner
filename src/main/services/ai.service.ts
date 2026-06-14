// 魔导书 Grimoire v7 — AI 服务（OpenAI 兼容 API）
import { getDatabase, saveDatabase } from '../database'
import crypto from 'crypto'

// Provider 配置由调用方传入

/** 聊天消息格式 */
interface AIMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
}
/** 清洗消息内容，移除 image_url，只保留 text（适配不支持多模态的 API） */
function normalizeContent(content: AIMessage["content"]): string {
  if (typeof content === "string") return content
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
    .map(p => p.text)
    .join("\n")
}

function normalizeMessages(messages: AIMessage[]): Array<{ role: string; content: string }> {
  return messages.map(m => ({ role: m.role, content: normalizeContent(m.content) }))
}

/** 发送聊天请求（流式） */
export async function chatStream(
  messages: AIMessage[],
  provider: { api_key: string; api_endpoint: string; api_model: string },
  onChunk: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (error: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const settings = { api_key: provider.api_key, api_endpoint: provider.api_endpoint, api_model: provider.api_model }
  
  if (!settings.api_key) {
    onError('请先在设置中填入 API Key')
    return
  }
  
  const endpoint = settings.api_endpoint.replace(/\/+$/, '') + '/chat/completions'
  let fullText = ''
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.api_key}`,
      },
      body: JSON.stringify({
        model: settings.api_model,
        messages: normalizeMessages(messages),
        stream: true,
      }),
      signal,
    })
    
    if (!response.ok) {
      const errText = await response.text()
      if (response.status === 401) {
        onError('API Key 无效，请检查设置')
      } else if (response.status === 429) {
        onError('API 请求过于频繁，请稍后重试')
      } else {
        onError(`API 错误 (${response.status}): ${errText.slice(0, 200)}`)
      }
      return
    }
    
    const reader = response.body?.getReader()
    if (!reader) { onError('无法读取响应流'); return }
    
    const decoder = new TextDecoder()
    let buffer = ''
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        
        const data = trimmed.slice(6)
        if (data === '[DONE]') continue
        
        try {
          const parsed = JSON.parse(data)
          const content = parsed.choices?.[0]?.delta?.content
          if (content) {
            fullText += content
            onChunk(content)
          }
        } catch {
          // skip unparseable chunks
        }
      }
    }
    
    onDone(fullText)
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      onDone(fullText)
      return
    }
    onError(`网络错误: ${err instanceof Error ? err.message : '未知错误'}`)
  }
}

/** 图片识别 */
export async function analyzeImage(
  imageBase64: string,
  prompt: string,
  provider?: { api_key: string; api_endpoint: string; api_model: string }
): Promise<string> {
  const settings = provider || { api_key: '', api_endpoint: 'https://api.openai.com/v1', api_model: 'gpt-4o' }
  
  if (!settings.api_key) {
    throw new Error('请先在设置中填入 API Key')
  }
  
  const endpoint = settings.api_endpoint.replace(/\/+$/, '') + '/chat/completions'
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.api_key}`,
    },
    body: JSON.stringify({
      model: settings.api_model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${imageBase64}` },
          },
        ],
      }],
      max_tokens: 2000,
    }),
  })
  
  if (!response.ok) {
    const errText = await response.text()
    if (errText.includes("image_url")) {
      throw new Error("当前配置的 API 不支持识图（image_url），请使用支持 Vision 的模型（如 gpt-4o）")
    }
    throw new Error(`API 错误 (${response.status}): ${errText.slice(0, 200)}`)
  }
  
  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

/** 保存聊天消息 */
export function saveChatMessage(role: string, content: string, model: string): void {
  const db = getDatabase()
  const id = 'msg_' + crypto.randomUUID().slice(0, 8)
  db.run(
    'INSERT INTO chat_messages (id, role, content, model) VALUES (?,?,?,?)',
    [id, role, content, model]
  )
  saveDatabase()
}

/** 获取聊天历史 */
export function getChatHistory(limit = 50) {
  const db = getDatabase()
  const result = db.exec('SELECT * FROM chat_messages ORDER BY created_at ASC LIMIT ?', [limit])
  return (result[0]?.values || []).map(r => ({
    id: r[0], role: r[1], content: r[2], model: r[3], created_at: r[4],
  }))
}

/** 解析 AI 返回的标签建议 */
export function parseTagSuggestions(aiResponse: string): string[] {
  // 尝试多种解析方式
  const tags: string[] = []
  
  // 方式1: 逗号分隔
  const commaSplit = aiResponse.split(/[,，]/)
  for (const part of commaSplit) {
    const cleaned = part.trim().replace(/^[-*\d.\s]+/, '').trim()
    if (cleaned && cleaned.length < 80) {
      tags.push(cleaned)
    }
  }
  
  // 方式2: 换行分隔
  if (tags.length < 2) {
    const lines = aiResponse.split('\n')
    for (const line of lines) {
      const cleaned = line.trim().replace(/^[-*\d.\s]+/, '').trim()
      if (cleaned && cleaned.length < 80) {
        tags.push(cleaned)
      }
    }
  }
  
  return [...new Set(tags)].slice(0, 30)
}
