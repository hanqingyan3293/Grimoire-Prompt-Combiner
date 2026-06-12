// ============================================================
// AI 视觉接口（预留）— 用户自行配置 API Key
// ============================================================

export interface VisionProvider {
  name: string
  analyze(imageBase64: string): Promise<TagSuggestion[]>
  describe(imageBase64: string): Promise<string>
}

export interface TagSuggestion {
  en: string
  zh: string
  confidence: number
  category?: string
}

export function createVisionProvider(
  provider: 'openai' | 'claude' | 'custom',
  apiKey: string,
  baseUrl?: string,
  model?: string
): VisionProvider {
  // Reserved for future implementation
  // Currently returns a no-op provider
  return {
    name: provider,
    async analyze(_imageBase64: string): Promise<TagSuggestion[]> {
      throw new Error('AI vision feature is pending implementation. Please configure your API key in Settings and wait for a future update.')
    },
    async describe(_imageBase64: string): Promise<string> {
      throw new Error('AI vision feature is pending implementation.')
    }
  }
}
