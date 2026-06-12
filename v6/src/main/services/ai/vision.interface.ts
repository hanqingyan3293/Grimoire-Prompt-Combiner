// ============================================================
// AI 视觉接口 - OpenAI 兼容的图片分析
// ============================================================

export interface VisionProvider {
  name: string
  analyze(imageBase64: string, apiKey: string, baseUrl: string, model?: string): Promise<TagSuggestion[]>
  describe(imageBase64: string, apiKey: string, baseUrl: string, model?: string): Promise<string>
}

export interface TagSuggestion {
  en: string
  zh: string
  confidence: number
  category?: string
}

export function createVisionProvider(
  provider: 'openai' | 'custom',
  apiKey: string,
  baseUrl?: string,
  model?: string
): VisionProvider {
  const resolvedBaseUrl = baseUrl || 'https://api.openai.com/v1'
  const resolvedModel = model || 'gpt-4o'

  async function callVision(prompt: string, imageBase64: string): Promise<string> {
    const resp = await fetch(resolvedBaseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: resolvedModel,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageBase64 } }
          ]
        }],
        max_tokens: 800,
        temperature: 0.2,
      }),
    })
    const data: any = await resp.json()
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))
    return data.choices?.[0]?.message?.content || ''
  }

  function parseTags(text: string): TagSuggestion[] {
    const cats = ['character','scene','object','style','quality','role','action','expression','outfit','angle']
    const seen = new Set<string>()
    const result: TagSuggestion[] = []
    const lines = (text.match(/`[\s\S]*?`/g)?.join('\n') || text).split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('`') || trimmed.startsWith('**')) continue
      const parts = trimmed.split('|')
      if (parts.length < 2) continue
      const name = parts[0].trim()
      const cat = parts[1].trim()
      const conf = parts.length > 2 ? parseFloat(parts[2].trim()) : 0.8
      if (!name || name.length > 50 || seen.has(name.toLowerCase())) continue
      if (!cats.includes(cat) && cat.length > 15) continue
      seen.add(name.toLowerCase())
      result.push({ en: name, zh: '', confidence: Math.min(1, Math.max(0, (conf > 1 ? conf / 100 : conf) || 0.8)), category: cat })
    }
    return result.sort((a, b) => b.confidence - a.confidence)
  }

  return {
    name: provider,
    async analyze(imageBase64: string, key?: string, url?: string, mod?: string): Promise<TagSuggestion[]> {
      const k = key || apiKey
      const u = url || resolvedBaseUrl
      const m = mod || resolvedModel
      const content = await callVision(
        'Analyze this image for AI art tagging. Output ONLY in this exact format, one tag per line: tag_name|category|confidence\nCategories: character/scene/object/style/quality/role/action/expression/outfit/angle\nConfidence: 0.0 to 1.0\nExample:\n1girl|character|0.95\nsolo|character|0.90',
        imageBase64
      )
      return parseTags(content)
    },
    async describe(imageBase64: string, key?: string, url?: string, mod?: string): Promise<string> {
      const k = key || apiKey
      const u = url || resolvedBaseUrl
      const m = mod || resolvedModel
      return callVision('Describe this image in detail, focusing on the artistic style, composition, colors, lighting, and the main subjects. Be precise and use terminology suitable for AI art prompts.', imageBase64)
    }
  }
}