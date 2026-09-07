// 魔导书 Grimoire v7 — AI Store
import { create } from 'zustand'

interface AIMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  model: string
  timestamp: string
}

interface AIState {
  messages: AIMessage[]
  streaming: boolean
  streamingText: string
  visionResult: string
  visionLoading: boolean
  error: string | null
  
  loadHistory: () => Promise<void>
  sendMessage: (content: string, model: string) => Promise<void>
  analyzeImage: (imageBase64: string, prompt?: string) => Promise<string>
  clearMessages: () => void
  clearError: () => void
}

let cleanupChunk: (() => void) | null = null

export const useAIStore = create<AIState>((set, get) => ({
  messages: [],
  streaming: false,
  streamingText: '',
  visionResult: '',
  visionLoading: false,
  error: null,
  
  loadHistory: async () => {
    // This legacy store is retained for compatibility; chat history is owned by chat.store.
    set({ messages: [] })
  },
  
  sendMessage: async (content, model) => {
    const state = get()
    const newMsg: AIMessage = {
      id: 'temp_' + Date.now(),
      role: 'user',
      content,
      model,
      timestamp: new Date().toISOString(),
    }
    
    set({
      messages: [...state.messages, newMsg],
      streaming: true,
      streamingText: '',
      error: null,
    })
    
    // 注册流式回调
    cleanupChunk?.()
    cleanupChunk = window.api.ai.onChunk((data: { text?: string }) => {
      set(s => ({ streamingText: s.streamingText + (data.text || '') }))
    })
    
    try {
      const allMessages = [...state.messages, newMsg].map(m => ({
        role: m.role,
        content: m.content,
      }))
      
      const providers = await window.api.providers.list()
      const provider = providers.find(item => item.is_active) || providers[0]
      if (!provider) throw new Error('请先配置 API 供应商')
      const result = await window.api.ai.sendMessage({
        providerId: provider.id,
        model,
        messages: allMessages,
      })
      
      if (result.success) {
        const assistantMsg: AIMessage = {
          id: 'msg_' + Date.now(),
          role: 'assistant',
          content: result.text || get().streamingText,
          model,
          timestamp: new Date().toISOString(),
        }
        set(s => ({
          messages: [...s.messages, assistantMsg],
          streaming: false,
          streamingText: '',
        }))
      } else {
        set({
          streaming: false,
          streamingText: '',
          error: result.error || '请求失败',
        })
      }
    } catch (err) {
      set({
        streaming: false,
        streamingText: '',
        error: err instanceof Error ? err.message : '请求失败',
      })
    }
  },
  
  analyzeImage: async (imageBase64, prompt) => {
    set({ visionLoading: true, error: null })
    try {
      const providers = await window.api.providers.list()
      const provider = providers.find(item => item.is_active) || providers[0]
      if (!provider) throw new Error('请先配置 API 供应商')
      const result = await window.api.ai.vision({
        providerId: provider.id,
        model: provider.default_model || 'gpt-4o',
        imageBase64,
        prompt,
      })
      set({ visionLoading: false })
      if (result.success) {
        set({ visionResult: result.text || '' })
        return result.text || ''
      } else {
        set({ error: result.error || '识图失败' })
        return ''
      }
    } catch (err) {
      set({ visionLoading: false, error: err instanceof Error ? err.message : '识图失败' })
      return ''
    }
  },
  
  clearMessages: () => set({ messages: [] }),
  clearError: () => set({ error: null }),
}))
