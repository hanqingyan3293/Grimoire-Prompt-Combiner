// 魔导书 Grimoire v7 — 聊天 Store (AI 窗口 + 简易 AI 共用)
import { create } from 'zustand'

export interface Conversation {
  id: string
  group_id: string
  provider_id: string
  title: string
  model: string
  system_prompt: string
  pinned: number
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: string
  conv_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  model: string
  token_count: number
  created_at: string
}

export interface ChatGroup {
  id: string
  name: string
  sort_order: number
  created_at: string
}

interface ChatState {
  // 数据
  conversations: Conversation[]
  activeConversationId: string | null
  messages: ChatMessage[]
  groups: ChatGroup[]
  streamingMessageId: string | null

  // 加载状态
  loadingConv: boolean
  loadingMsg: boolean

  // 写操作队列
  _writeQueue: Promise<void>
  _chunkCleanup: (() => void) | null

  // 分组
  loadGroups: () => Promise<void>
  createGroup: (name: string) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  renameGroup: (id: string, name: string) => Promise<void>

  // 对话
  loadConversations: () => Promise<void>
  createConversation: (providerId: string, model: string) => Promise<string>
  deleteConversation: (id: string) => Promise<void>
  setActiveConversation: (id: string | null) => Promise<void>
  updateConversation: (id: string, data: Partial<Conversation>) => Promise<void>
  moveConversation: (convId: string, groupId: string) => Promise<void>

  // 消息
  loadMessages: (convId: string) => Promise<void>
  sendMessage: (content: string, providerId: string, model: string) => Promise<void>
  editAndResend: (messageId: string, newContent: string) => Promise<void>
  resendMessage: (messageId: string) => Promise<void>
  deleteMessage: (id: string) => Promise<void>
  clearMessages: () => Promise<void>
}

function toast(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  window.dispatchEvent(new CustomEvent('grimoire:toast', { detail: { message: msg, type } }))
}

// 跨窗口刷新监听
if (typeof window !== 'undefined') {
  window.addEventListener('grimoire:refresh', () => {
    const state = useChatStore.getState()
    state.loadConversations().catch(() => {})
    state.loadGroups().catch(() => {})
    if (state.activeConversationId) {
      state.loadMessages(state.activeConversationId).catch(() => {})
    }
  })
}

// Auto-refresh on window focus
if (typeof window !== 'undefined') {
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  window.addEventListener('grimoire:refresh', () => {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      const s = useChatStore.getState()
      s.loadConversations().catch(() => {})
      s.loadGroups().catch(() => {})
    }, 200) // debounce 200ms
  })
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  groups: [],
  streamingMessageId: null,
  loadingConv: false,
  loadingMsg: false,
  _writeQueue: Promise.resolve(),
  _chunkCleanup: null,

  // ========== 分组 ==========
  loadGroups: async () => {
    try {
      const groups = await window.api.chat.listGroups()
      set({ groups })
    } catch (e) { console.error('loadGroups:', e) }
  },

  createGroup: async (name) => {
    try {
      await window.api.chat.createGroup(name)
      await get().loadGroups()
    } catch (e: any) { toast(e?.message || '创建失败', 'error') }
  },

  deleteGroup: async (id) => {
    try {
      if (id === 'default') return
      await window.api.chat.deleteGroup(id)
      await get().loadGroups()
    } catch (e: any) { toast(e?.message || '删除失败', 'error') }
  },

  renameGroup: async (id, name) => {
    try {
      await window.api.chat.renameGroup(id, name)
      await get().loadGroups()
    } catch (e: any) { toast(e?.message || '重命名失败', 'error') }
  },

  // ========== 对话 ==========
  loadConversations: async () => {
    set({ loadingConv: true })
    try {
      const conversations = await window.api.chat.listConversations()
      set({ conversations, loadingConv: false })
    } catch (e) {
      console.error('loadConversations:', e)
      set({ loadingConv: false })
    }
  },

  createConversation: async (providerId, model) => {
    try {
      const result = await window.api.chat.createConversation({
        provider_id: providerId,
        model,
      })
      await get().loadConversations()
      await get().setActiveConversation(result.id)
      return result.id
    } catch (e: any) {
      toast(e?.message || '创建对话失败', 'error')
      return ''
    }
  },

  deleteConversation: async (id) => {
    try {
      await window.api.chat.deleteConversation(id)
      const { activeConversationId, conversations } = get()
      if (activeConversationId === id) {
        const remaining = conversations.filter(c => c.id !== id)
        if (remaining.length > 0) {
          await get().setActiveConversation(remaining[0].id)
        } else {
          set({ activeConversationId: null, messages: [] })
        }
      }
      await get().loadConversations()
    } catch (e: any) { toast(e?.message || '删除失败', 'error') }
  },

  setActiveConversation: async (id) => {
    if (!id) {
      set({ activeConversationId: null, messages: [] })
      return
    }
    set({ activeConversationId: id })
    await get().loadMessages(id)
  },

  updateConversation: async (id, data) => {
    try {
      await window.api.chat.updateConversation(id, data)
      await get().loadConversations()
    } catch (e: any) { toast(e?.message || '更新失败', 'error') }
  },

  moveConversation: async (convId, groupId) => {
    try {
      await window.api.chat.moveConversation(convId, groupId)
      await get().loadConversations()
    } catch (e: any) { toast(e?.message || '移动失败', 'error') }
  },

  // ========== 消息 ==========
  loadMessages: async (convId) => {
    set({ loadingMsg: true })
    try {
      const messages = await window.api.chat.getMessages(convId)
      if (get().activeConversationId === convId) set({ messages, loadingMsg: false })
    } catch (e) {
      console.error('loadMessages:', e)
      if (get().activeConversationId === convId) set({ loadingMsg: false })
    }
  },

  sendMessage: async (content, providerId, model) => {
    const normalizedContent = content.trim()
    if (!normalizedContent) return
    if (get().streamingMessageId) {
      toast('请等待当前回复完成', 'info')
      return
    }
    const { activeConversationId } = get()
    if (!activeConversationId) {
      // 自动创建对话
      const newId = await get().createConversation(providerId, model)
      if (!newId) return
      await get().sendMessage(normalizedContent, providerId, model)
      return
    }

    // 1. 保存用户消息
    const userMsg: ChatMessage = {
      id: 'msg_' + crypto.randomUUID().slice(0, 8),
      conv_id: activeConversationId,
      role: 'user',
      content: normalizedContent,
      model,
      token_count: 0,
      created_at: new Date().toISOString(),
    }
    try {
      await window.api.chat.saveMessage(userMsg)
    } catch (error) {
      const message = error instanceof Error ? error.message : '用户消息保存失败'
      toast('消息保存失败: ' + message, 'error')
      return
    }

    // 2. 创建空的 AI 消息
    const aiMsgId = 'msg_' + crypto.randomUUID().slice(0, 8)
    const aiMsg: ChatMessage = {
      id: aiMsgId,
      conv_id: activeConversationId,
      role: 'assistant',
      content: '',
      model,
      token_count: 0,
      created_at: new Date().toISOString(),
    }

    // 3. 构建消息历史。不要把本地流式占位 assistant 消息传给模型。
    const previousMessages = get().messages
    const apiMessages = [
      ...previousMessages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: normalizedContent },
    ]

    // 4. 更新本地 state
    set(s => ({
      messages: [...s.messages, userMsg, aiMsg],
      streamingMessageId: aiMsgId,
    }))

    // 5. 添加系统提示词
    const { conversations } = get()
    const conv = conversations.find(c => c.id === activeConversationId)
    if (conv?.system_prompt) {
      apiMessages.unshift({ role: 'system', content: conv.system_prompt })
    }

    // 6. 注册流式回调（先清理旧的）
    const { _chunkCleanup: oldCleanup } = get()
    if (oldCleanup) { oldCleanup(); set({ _chunkCleanup: null }) }
    let cleanup: (() => void) | null = null
    let settled = false
    const finish = (response: { fullText?: string; error?: string }) => {
      if (settled) return
      settled = true
      const streamed = get().messages.find(message => message.id === aiMsgId)?.content || ''
      const finalContent = response.error
        ? `发送失败: ${response.error}`
        : streamed || response.fullText || ''
      set(state => ({
        streamingMessageId: null,
        _chunkCleanup: null,
        messages: state.messages.map(message => message.id === aiMsgId ? { ...message, content: finalContent } : message),
      }))
      void window.api.chat.saveMessage({
        id: aiMsgId,
        conv_id: activeConversationId,
        role: 'assistant',
        content: finalContent,
        model,
      }).catch(error => {
        console.error('save assistant message failed:', error)
        toast('AI 回复保存失败', 'error')
      })
      if (response.error) toast('AI 回复失败: ' + response.error, 'error')
      cleanup?.()
    }
    try {
      cleanup = window.api.ai.onChunk((data: any) => {
        if (data.done) {
          finish({ fullText: typeof data.fullText === 'string' ? data.fullText : '', error: typeof data.error === 'string' ? data.error : undefined })
        } else {
          // 逐帧更新
          const text = typeof data.text === 'string' ? data.text : ''
          if (!text) return
          set(s => ({
            messages: s.messages.map(m =>
              m.id === aiMsgId ? { ...m, content: m.content + text } : m
            ),
          }))
        }
      })
      set({ _chunkCleanup: cleanup })
    } catch (e) {
      console.error('onChunk registration failed:', e)
    }

    // 7. 发送消息
    try {
      const response = await window.api.ai.sendMessage({
        providerId,
        model,
        messages: apiMessages,
      })
      if (!settled) {
        if (response?.error) finish({ error: response.error })
        else if (response?.success) finish({ fullText: response.text || '' })
        else finish({ error: 'AI 服务未返回有效结果' })
      }
    } catch (e: any) {
      finish({ error: e?.message || '未知错误' })
    }

    // 8. 更新对话列表顺序
    get().loadConversations().catch(() => {})
  },

  editAndResend: async (messageId, newContent) => {
    const { messages, activeConversationId } = get()
    const idx = messages.findIndex(m => m.id === messageId)
    if (idx < 0) return

    // 删除此消息及之后的所有消息
    const toDelete = messages.slice(idx)
    for (const m of toDelete) {
      try { await window.api.chat.deleteMessage(m.id) } catch {}
    }

    // 更新本地 state
    set(s => ({
      messages: s.messages.slice(0, idx),
    }))

    // 重新发送
    const { conversations } = get()
    const conv = conversations.find(c => c.id === activeConversationId)
    if (conv) {
      get().sendMessage(newContent, conv.provider_id, conv.model)
    }
  },

  resendMessage: async (messageId) => {
    // 找到此消息之前的最后一条用户消息
    const { messages, activeConversationId } = get()
    const idx = messages.findIndex(m => m.id === messageId)
    if (idx < 0) return

    // 找到之前最近的一条用户消息
    let userContent = ''
    let userIdx = -1
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userContent = messages[i].content
        userIdx = i
        break
      }
    }
    if (!userContent) return

    // 删除此消息及之后的所有消息
    const toDelete = messages.slice(idx)
    for (const m of toDelete) {
      try { await window.api.chat.deleteMessage(m.id) } catch {}
    }
    set(s => ({ messages: s.messages.slice(0, idx) }))

    // 重新发送
    const { conversations } = get()
    const conv = conversations.find(c => c.id === activeConversationId)
    if (conv) {
      get().sendMessage(userContent, conv.provider_id, conv.model)
    }
  },

  deleteMessage: async (id) => {
    try {
      await window.api.chat.deleteMessage(id)
      set(s => ({ messages: s.messages.filter(m => m.id !== id) }))
    } catch (e: any) { toast(e?.message || '删除失败', 'error') }
  },

  clearMessages: async () => {
    const { activeConversationId } = get()
    if (!activeConversationId) return
    try {
      await window.api.chat.clearMessages(activeConversationId)
      set({ messages: [] })
    } catch (e: any) { toast(e?.message || '清除失败', 'error') }
  },
}))
