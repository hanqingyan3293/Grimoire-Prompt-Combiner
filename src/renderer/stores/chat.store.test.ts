// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from './chat.store'

function setChatApi(options: {
  response?: Record<string, unknown>
  chunks?: Array<Record<string, unknown>>
  saveError?: Error
} = {}) {
  let chunkHandler: ((data: Record<string, unknown>) => void) | null = null
  const cleanup = vi.fn()
  const saveMessage = options.saveError
    ? vi.fn().mockRejectedValue(options.saveError)
    : vi.fn().mockResolvedValue({ id: 'saved' })
  const sendMessage = vi.fn(async () => {
    for (const chunk of options.chunks || []) chunkHandler?.(chunk)
    return options.response || { success: true, text: 'answer' }
  })

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      chat: {
        saveMessage,
        listConversations: vi.fn().mockResolvedValue([]),
        getMessages: vi.fn().mockResolvedValue([]),
      },
      ai: {
        onChunk: vi.fn((handler: (data: Record<string, unknown>) => void) => { chunkHandler = handler; return cleanup }),
        sendMessage,
      },
    },
  })
  return { cleanup, saveMessage, sendMessage }
}

function resetStore() {
  useChatStore.setState({
    conversations: [{
      id: 'conv-1', group_id: 'default', provider_id: 'provider-1', title: 'Test', model: 'model-1',
      system_prompt: '', pinned: 0, created_at: '', updated_at: '',
    }],
    activeConversationId: 'conv-1',
    messages: [],
    groups: [],
    streamingMessageId: null,
    loadingConv: false,
    loadingMsg: false,
    _writeQueue: Promise.resolve(),
    _chunkCleanup: null,
  })
}

afterEach(() => {
  useChatStore.getState()._chunkCleanup?.()
  resetStore()
  vi.restoreAllMocks()
})

describe('chat message lifecycle', () => {
  it('persists streamed assistant content and releases the listener', async () => {
    resetStore()
    const api = setChatApi({
      chunks: [{ text: 'hello ' }, { text: 'world' }, { done: true, fullText: 'hello world' }],
      response: { success: true, text: 'hello world' },
    })

    await useChatStore.getState().sendMessage('question', 'provider-1', 'model-1')
    await Promise.resolve()

    expect(useChatStore.getState().messages.map(message => message.content)).toEqual(['question', 'hello world'])
    expect(api.saveMessage).toHaveBeenCalledTimes(2)
    expect(api.saveMessage.mock.calls[1][0].content).toBe('hello world')
    expect(api.cleanup).toHaveBeenCalledOnce()
    expect(useChatStore.getState().streamingMessageId).toBeNull()
    expect(useChatStore.getState()._chunkCleanup).toBeNull()
  })

  it('settles and persists a provider error even when no stream event arrives', async () => {
    resetStore()
    const api = setChatApi({ response: { error: 'invalid key' } })

    await useChatStore.getState().sendMessage('question', 'provider-1', 'model-1')
    await Promise.resolve()

    expect(useChatStore.getState().messages[1].content).toBe('发送失败: invalid key')
    expect(api.saveMessage).toHaveBeenCalledTimes(2)
    expect(useChatStore.getState().streamingMessageId).toBeNull()
  })

  it('does not contact the provider when the user message cannot be saved', async () => {
    resetStore()
    const api = setChatApi({ saveError: new Error('disk full') })

    await useChatStore.getState().sendMessage('question', 'provider-1', 'model-1')

    expect(api.sendMessage).not.toHaveBeenCalled()
    expect(useChatStore.getState().messages).toEqual([])
  })

  it('rejects a second send while a response is streaming', async () => {
    resetStore()
    const api = setChatApi()
    useChatStore.setState({ streamingMessageId: 'pending' })

    await useChatStore.getState().sendMessage('second', 'provider-1', 'model-1')

    expect(api.saveMessage).not.toHaveBeenCalled()
    expect(api.sendMessage).not.toHaveBeenCalled()
  })

  it('does not replace the active conversation with a stale message load', async () => {
    resetStore()
    let resolveOld!: (messages: unknown[]) => void
    const oldMessages = new Promise<unknown[]>(resolve => { resolveOld = resolve })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { chat: { getMessages: vi.fn(() => oldMessages) } },
    })

    const load = useChatStore.getState().loadMessages('conv-1')
    useChatStore.setState({ activeConversationId: 'conv-2', messages: [] })
    resolveOld([{ id: 'old-message' }])
    await load

    expect(useChatStore.getState().messages).toEqual([])
  })
})
