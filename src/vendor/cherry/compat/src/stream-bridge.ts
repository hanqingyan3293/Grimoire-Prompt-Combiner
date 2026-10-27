// Source `ai.stream.*` bridge for the compat window (M2).
//
// The main process owns the turn: `ai.stream.open` starts the real Grimoire send and returns
// the execution identity the renderer must filter on. The chunks themselves are REAL runtime
// output — this module only translates the session events Grimoire already emits (text deltas,
// the terminal assistant message, a failure event) into the AI-SDK `UIMessageChunk` stream the
// source chat transport consumes. Nothing is synthesized when the runtime is silent.
type AnyRecord = Record<string, any>
type Listener = (payload: any) => void

type BridgeApi = {
  ipcApi: { request(route: string, input?: unknown): Promise<any>; on(event: string, cb: Listener): () => void }
  ai: { sessions: { onEvent(cb: (value: AnyRecord) => void): () => void } }
}

type Turn = {
  topicId: string
  sessionId: string
  executionId: string
  attemptId: number
  anchorMessageId: string
  textStarted: boolean
  textId: string
  reasoningStarted: boolean
  reasoningId: string
}

const STREAM_EVENTS = new Set(['ai.stream.chunk', 'ai.stream.done', 'ai.stream.error'])

export function installStreamBridge(api: BridgeApi): () => void {
  const listeners = new Map<string, Set<Listener>>()
  const bySession = new Map<string, Turn>()
  let installed = false

  const emit = (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? []) {
      try { listener(payload) } catch { /* a broken consumer must not stop the stream */ }
    }
  }

  const chunk = (turn: Turn, chunkValue: AnyRecord) => {
    emit('ai.stream.chunk', {
      topicId: turn.topicId,
      executionId: turn.executionId,
      attemptId: turn.attemptId,
      anchorMessageId: turn.anchorMessageId,
      chunk: chunkValue
    })
  }

  const finishText = (turn: Turn) => {
    if (turn.textStarted) chunk(turn, { type: 'text-end', id: turn.textId })
    if (turn.reasoningStarted) chunk(turn, { type: 'reasoning-end', id: turn.reasoningId })
    turn.textStarted = false
    turn.reasoningStarted = false
  }

  const originalRequest = api.ipcApi.request.bind(api.ipcApi)
  const originalOn = api.ipcApi.on.bind(api.ipcApi)

  const request = async (route: string, input?: unknown) => {
    const result = await originalRequest(route, input)
    if (route === 'ai.stream.open' && result && result.ok && result.data && result.data.mode === 'started') {
      const data = result.data as AnyRecord
      const execution = Array.isArray(data.activeExecutions) ? data.activeExecutions[0] : null
      const topicId = input && typeof input === 'object' ? String((input as AnyRecord).topicId || '') : ''
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : ''
      if (topicId && sessionId && execution) {
        bySession.set(sessionId, {
          topicId,
          sessionId,
          executionId: String(execution.executionId || 'default'),
          attemptId: Number(execution.attemptId || 0),
          anchorMessageId: String(execution.anchorMessageId || ''),
          textStarted: false,
          textId: 'text-' + String(execution.attemptId || 0),
          reasoningStarted: false,
          reasoningId: 'reasoning-' + String(execution.attemptId || 0)
        })
      }
    }
    if (route === 'ai.stream.abort' && input && typeof input === 'object') {
      const topicId = String((input as AnyRecord).topicId || '')
      for (const turn of [...bySession.values()]) {
        if (turn.topicId === topicId) {
          finishText(turn)
          emit('ai.stream.done', { topicId: turn.topicId, executionId: turn.executionId, attemptId: turn.attemptId, anchorMessageId: turn.anchorMessageId, status: 'paused', isTopicDone: true })
          bySession.delete(turn.sessionId)
        }
      }
    }
    return result
  }

  const on = (event: string, callback: Listener) => {
    if (!STREAM_EVENTS.has(event)) return originalOn(event, callback)
    const set = listeners.get(event) ?? new Set<Listener>()
    set.add(callback)
    listeners.set(event, set)
    return () => { set.delete(callback) }
  }

  const unsubscribeSessions = api.ai.sessions.onEvent(value => {
    const sessionId = typeof value?.sessionId === 'string' ? value.sessionId : ''
    const turn = sessionId ? bySession.get(sessionId) : undefined
    if (!turn) return
    if (value.kind === 'delta') {
      const text = typeof value.text === 'string' ? value.text : ''
      if (!text) return
      if (!turn.textStarted) {
        turn.textStarted = true
        chunk(turn, { type: 'text-start', id: turn.textId })
      }
      chunk(turn, { type: 'text-delta', id: turn.textId, delta: text })
      return
    }
    if (value.kind === 'event') {
      const record = value.record && typeof value.record === 'object' ? value.record as AnyRecord : {}
      const eventType = String(record.event_type || '')
      const payload = record.payload && typeof record.payload === 'object' ? record.payload as AnyRecord : {}
      if (eventType === 'reasoning-delta') {
        const text = typeof payload.text === 'string' ? payload.text : ''
        if (!text) return
        if (!turn.reasoningStarted) {
          turn.reasoningStarted = true
          chunk(turn, { type: 'reasoning-start', id: turn.reasoningId })
        }
        chunk(turn, { type: 'reasoning-delta', id: turn.reasoningId, delta: text })
        return
      }
      if (eventType === 'failed') {
        finishText(turn)
        emit('ai.stream.error', {
          topicId: turn.topicId,
          executionId: turn.executionId,
          attemptId: turn.attemptId,
          anchorMessageId: turn.anchorMessageId,
          isTopicDone: true,
          error: { message: String(payload.message || 'runtime failed') }
        })
        bySession.delete(turn.sessionId)
      }
      return
    }
    if (value.kind === 'message') {
      const record = value.record && typeof value.record === 'object' ? value.record as AnyRecord : {}
      if (record.role !== 'assistant') return
      finishText(turn)
      const status = record.status === 'cancelled' || record.status === 'interrupted' ? 'paused' : 'success'
      emit('ai.stream.done', { topicId: turn.topicId, executionId: turn.executionId, attemptId: turn.attemptId, anchorMessageId: turn.anchorMessageId, status, isTopicDone: true })
      bySession.delete(turn.sessionId)
    }
  })

  api.ipcApi.request = request as typeof api.ipcApi.request
  api.ipcApi.on = on as typeof api.ipcApi.on
  installed = true

  return () => {
    if (!installed) return
    unsubscribeSessions()
    api.ipcApi.request = originalRequest as typeof api.ipcApi.request
    api.ipcApi.on = originalOn as typeof api.ipcApi.on
    installed = false
  }
}
