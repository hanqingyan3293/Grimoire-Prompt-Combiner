// 魔导书 Grimoire v7 — Chat Store
import { create } from "zustand"

export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  model: string
  timestamp: string
  images?: string[]
}

export interface Conversation {
  id: string
  title: string
  model: string
  created_at: string
  updated_at: string
  message_count: number
  group?: string
}

interface ChatState {
  conversations: Conversation[]
  activeId: string | null
  messages: ChatMessage[]
  streaming: boolean
  streamingText: string
  searchQuery: string
  groupBy: string
  error: string | null

  loadConversations: () => void
  createConversation: (model?: string) => string
  deleteConversation: (id: string) => void
  renameConversation: (id: string, title: string) => void
  setActive: (id: string) => void
  setSearch: (query: string) => void
  setGroupBy: (group: string) => void

  sendMessage: (content: string, model: string, images?: string[]) => Promise<void>
  clearError: () => void
}

// In-memory storage for demo (will persist via IPC later)
var _conversations: Conversation[] = []
var _messages: Record<string, ChatMessage[]> = {}

var _convIdCounter = 1
function _genId() { return "conv_" + (_convIdCounter++) + "_" + Date.now() }
function _msgId() { return "msg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) }

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  messages: [],
  streaming: false,
  streamingText: "",
  searchQuery: "",
  groupBy: "today",
  error: null,

  loadConversations: () => {
    set({ conversations: _conversations })
  },

  createConversation: (model) => {
    const id = _genId()
    const conv: Conversation = {
      id, title: "新对话", model: model || "gpt-4o",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), message_count: 0
    }
    _conversations.unshift(conv)
    _messages[id] = []
    set({ conversations: [..._conversations], activeId: id, messages: [], streamingText: "", error: null })
    return id
  },

  deleteConversation: (id) => {
    _conversations = _conversations.filter(c => c.id !== id)
    delete _messages[id]
    const state = get()
    const newActive = state.activeId === id ? (_conversations[0]?.id || null) : state.activeId
    set({
      conversations: [..._conversations],
      activeId: newActive,
      messages: newActive ? (_messages[newActive] || []) : [],
    })
  },

  renameConversation: (id, title) => {
    const conv = _conversations.find(c => c.id === id)
    if (conv) { conv.title = title; conv.updated_at = new Date().toISOString() }
    set({ conversations: [..._conversations] })
  },

  setActive: (id) => {
    set({ activeId: id, messages: _messages[id] || [], streamingText: "", error: null })
  },

  setSearch: (query) => set({ searchQuery: query }),
  setGroupBy: (group) => set({ groupBy: group }),

  sendMessage: async (content, model, images) => {
    const state = get()
    let activeId = state.activeId
    if (!activeId) { activeId = get().createConversation(model) }
    if (!activeId) return

    const userMsg: ChatMessage = {
      id: _msgId(), role: "user", content, model,
      timestamp: new Date().toISOString(), images
    }

    const msgs = [...(state.messages), userMsg]
    set({ messages: msgs, streaming: true, streamingText: "", error: null })
    if (!_messages[activeId]) _messages[activeId] = []
    _messages[activeId].push(userMsg)

    // Update conversation
    const conv = _conversations.find(c => c.id === activeId)
    if (conv) {
      conv.title = content.slice(0, 30) + (content.length > 30 ? "..." : "")
      conv.message_count = _messages[activeId].length
      conv.updated_at = new Date().toISOString()
      set({ conversations: [..._conversations] })
    }

    try {
      const allMessages = _messages[activeId].map(m => ({ role: m.role, content: m.content }))
      const result = await window.api.ai.chat(allMessages, model)

      if (result.success) {
        const aiMsg: ChatMessage = {
          id: _msgId(), role: "assistant",
          content: result.text || get().streamingText, model,
          timestamp: new Date().toISOString()
        }
        _messages[activeId].push(aiMsg)
        set(s => ({
          messages: [...s.messages, aiMsg], streaming: false, streamingText: ""
        }))
      } else {
        set({ streaming: false, streamingText: "", error: result.error || "请求失败" })
      }
    } catch (e: any) {
      set({ streaming: false, streamingText: "", error: e.message })
    }
  },

  clearError: () => set({ error: null }),
}))

// Listen for streaming chunks
if (typeof window !== "undefined") {
  window.api?.ai?.onChunk?.((chunk: string) => {
    useChatStore.setState(s => ({ streamingText: s.streamingText + chunk }))
  })
}
