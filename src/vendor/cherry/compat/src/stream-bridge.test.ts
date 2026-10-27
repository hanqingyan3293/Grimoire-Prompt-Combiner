import { describe, expect, it, vi } from 'vitest'
import { installStreamBridge } from './stream-bridge'

function createApi() {
  const sessionListeners: Array<(value: any) => void> = []
  const emitted: Array<{ event: string; payload: any }> = []
  const ipc = {
    request: vi.fn(async (route: string, _input?: unknown) => {
      if (route === 'ai.stream.open') return { ok: true, data: { mode: 'started', sessionId: 's1', activeExecutions: [{ executionId: 'm1', attemptId: 7, anchorMessageId: 'a1' }] } }
      return { ok: true, data: undefined }
    }),
    on: vi.fn((event: string, cb: (payload: any) => void) => {
      const wrapper = (payload: any) => { emitted.push({ event, payload }); cb(payload) }
      return () => undefined
    }),
  }
  const api = {
    ipcApi: ipc,
    ai: {
      sessions: {
        onEvent: (cb: (value: any) => void) => { sessionListeners.push(cb); return () => undefined },
      },
    },
  }
  return { api, ipc, emitted, emitSession: (value: any) => sessionListeners.forEach(listener => listener(value)) }
}

describe('ai.stream bridge', () => {
  it('maps real session deltas onto the source chunk protocol and closes on the assistant row', async () => {
    const { api, emitted, emitSession } = createApi()
    installStreamBridge(api as any)
    const chunks: any[] = []
    const done: any[] = []
    api.ipcApi.on('ai.stream.chunk', payload => chunks.push(payload))
    api.ipcApi.on('ai.stream.done', payload => done.push(payload))

    await api.ipcApi.request('ai.stream.open', { topicId: 't1', trigger: 'submit-message' })
    emitSession({ kind: 'delta', sessionId: 's1', text: '你' })
    emitSession({ kind: 'delta', sessionId: 's1', text: '好' })
    emitSession({ kind: 'event', sessionId: 's1', record: { event_type: 'reasoning-delta', payload: { text: '思考' } } })
    emitSession({ kind: 'message', sessionId: 's1', record: { role: 'assistant', status: 'completed' } })

    expect(chunks.map(item => item.chunk.type)).toEqual(['text-start', 'text-delta', 'text-delta', 'reasoning-start', 'reasoning-delta', 'text-end', 'reasoning-end'])
    expect(chunks[1].chunk).toEqual({ type: 'text-delta', id: 'text-7', delta: '你' })
    expect(chunks.every(item => item.topicId === 't1' && item.executionId === 'm1' && item.anchorMessageId === 'a1')).toBe(true)
    expect(done).toHaveLength(1)
    expect(done[0]).toMatchObject({ topicId: 't1', status: 'success', isTopicDone: true })
    // A late event after the terminal message must not reopen the stream.
    emitSession({ kind: 'delta', sessionId: 's1', text: 'x' })
    expect(chunks).toHaveLength(7)
  })

  it('emits an error payload when the runtime reports failure', async () => {
    const { api, emitSession } = createApi()
    installStreamBridge(api as any)
    const errors: any[] = []
    api.ipcApi.on('ai.stream.error', payload => errors.push(payload))
    await api.ipcApi.request('ai.stream.open', { topicId: 't2', trigger: 'submit-message' })
    emitSession({ kind: 'event', sessionId: 's1', record: { event_type: 'failed', payload: { message: 'provider down' } } })
    expect(errors).toHaveLength(1)
    expect(errors[0].error.message).toBe('provider down')
  })

  it('leaves non-stream events on the original transport', () => {
    const { api, ipc } = createApi()
    // Capture BEFORE install: the bridge replaces api.ipcApi.on, so the spy is only reachable
    // through the original reference.
    const originalOn = ipc.on
    installStreamBridge(api as any)
    api.ipcApi.on('mcp.tool.call_progress', () => undefined)
    expect(originalOn).toHaveBeenCalledWith('mcp.tool.call_progress', expect.any(Function))
  })
})
