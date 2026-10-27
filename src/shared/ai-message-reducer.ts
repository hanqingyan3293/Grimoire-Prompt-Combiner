import type { AiEventRecord } from './ai-types'
import type { AiMessagePart } from './ai-message-parts'

export type AiMessagePartStatus = 'idle' | 'streaming' | 'completed' | 'failed' | 'interrupted'

export type AiMessagePartState = {
  parts: AiMessagePart[]
  status: AiMessagePartStatus
  lastSequence: number
}

export type AiMessagePartAction =
  | { type: 'reset'; parts?: AiMessagePart[]; status?: AiMessagePartStatus }
  | { type: 'event'; event: AiEventRecord }
  | { type: 'events'; events: AiEventRecord[] }
  | { type: 'parts'; parts: AiMessagePart[] }
  | { type: 'interrupt' }

export const initialAiMessagePartState: AiMessagePartState = {
  parts: [],
  status: 'idle',
  lastSequence: -1,
}

function payloadText(payload: Record<string, unknown>): string {
  return typeof payload.text === 'string' ? payload.text : ''
}

function withPartId(part: AiMessagePart, id: string): AiMessagePart {
  return { ...part, id: part.id || id }
}

function updateByField(parts: AiMessagePart[], field: 'callId' | 'requestId', value: string, update: (part: AiMessagePart) => AiMessagePart): AiMessagePart[] {
  const index = parts.findIndex(part => part[field] === value)
  if (index < 0) return parts
  const next = parts.slice()
  next[index] = update(next[index])
  return next
}

function reduceEvent(state: AiMessagePartState, event: AiEventRecord): AiMessagePartState {
  if (event.sequence <= state.lastSequence && event.id) return state
  const payload = event.payload || {}
  let parts = state.parts
  let status = state.status

  switch (event.event_type) {
    case 'session-started':
    case 'message-started':
      status = 'streaming'
      break
    case 'text-delta': {
      const text = payloadText(payload)
      if (!text) break
      const last = parts[parts.length - 1]
      if (last?.type === 'text' && last.metadata?.streaming === true) {
        parts = [...parts.slice(0, -1), { ...last, text: (last.text || '') + text }]
      } else {
        parts = [...parts, withPartId({ type: 'text', text, metadata: { streaming: true } }, event.id)]
      }
      status = 'streaming'
      break
    }
    case 'reasoning-delta': {
      const text = payloadText(payload)
      if (!text) break
      const last = parts[parts.length - 1]
      if (last?.type === 'reasoning' && last.metadata?.streaming === true) {
        parts = [...parts.slice(0, -1), { ...last, text: (last.text || '') + text }]
      } else {
        parts = [...parts, withPartId({ type: 'reasoning', text, metadata: { streaming: true } }, event.id)]
      }
      status = 'streaming'
      break
    }
    case 'tool-started': {
      const callId = String(payload.callId || '')
      if (!callId) break
      const nextPart = withPartId({ type: 'tool-call', callId, name: String(payload.name || ''), input: payload.input, status: 'running', metadata: { eventId: event.id } }, event.id)
      parts = parts.some(part => part.type === 'tool-call' && part.callId === callId) ? updateByField(parts, 'callId', callId, part => ({ ...part, ...nextPart })) : [...parts, nextPart]
      status = 'streaming'
      break
    }
    case 'tool-progress': {
      const callId = String(payload.callId || '')
      if (!callId) break
      const next = { status: String(payload.status || 'running'), output: payload.output, error: typeof payload.error === 'string' ? payload.error : undefined }
      parts = updateByField(parts, 'callId', callId, part => ({ ...part, ...next, metadata: { ...part.metadata, eventId: event.id } }))
      if (!parts.some(part => part.callId === callId)) parts = [...parts, withPartId({ type: 'tool-call', callId, name: String(payload.name || ''), ...next }, event.id)]
      status = 'streaming'
      break
    }
    case 'agent-status': {
      const agentStatus: AiMessagePart = withPartId({ type: 'agent-status', text: String(payload.text || payload.status || ''), status: String(payload.status || 'running'), detail: payload.detail, metadata: { eventId: event.id } }, event.id)
      parts = [...parts, agentStatus]
      status = 'streaming'
      break
    }
    case 'mcp-event': {
      const mcpStatus: AiMessagePart = withPartId({ type: 'mcp', name: String(payload.tool || ''), text: String(payload.message || payload.tool || ''), output: payload.payload, error: typeof payload.error === 'string' ? payload.error : undefined, status: String(payload.status || 'running'), metadata: { eventId: event.id } }, event.id)
      parts = [...parts, mcpStatus]
      status = 'streaming'
      break
    }
    case 'tool-finished': {
      const callId = String(payload.callId || '')
      if (!callId) break
      const error = typeof payload.error === 'string' ? payload.error : undefined
      const result: AiMessagePart = withPartId({ type: 'tool-result', callId, name: String(payload.name || ''), output: payload.output, error, status: error ? 'error' : 'completed', metadata: { eventId: event.id } }, event.id)
      parts = parts.some(part => part.id === event.id) ? parts : [...parts, result]
      parts = updateByField(parts, 'callId', callId, part => part.type === 'tool-call' ? { ...part, status: error ? 'error' : 'completed' } : part)
      status = error ? 'failed' : 'streaming'
      break
    }
    case 'permission-requested': {
      const requestId = String(payload.requestId || '')
      if (!requestId) break
      const nextPart = withPartId({ type: 'permission', requestId, permission: String(payload.permission || payload.action || ''), detail: payload.detail, status: 'pending', metadata: { eventId: event.id } }, event.id)
      parts = parts.some(part => part.requestId === requestId) ? updateByField(parts, 'requestId', requestId, part => ({ ...part, ...nextPart })) : [...parts, nextPart]
      status = 'streaming'
      break
    }
    case 'permission-resolved': {
      const requestId = String(payload.requestId || '')
      if (!requestId) break
      const nextPart = withPartId({ type: 'permission', requestId, permission: String(payload.permission || ''), detail: payload.detail, status: String(payload.decision || 'resolved'), metadata: { eventId: event.id } }, event.id)
      parts = parts.some(part => part.requestId === requestId) ? updateByField(parts, 'requestId', requestId, part => ({ ...part, ...nextPart })) : [...parts, nextPart]
      break
    }
    case 'failed':
      parts = [...parts, withPartId({ type: 'error', text: String(payload.message || payload.error || 'Agent 请求失败'), status: 'failed', metadata: { eventId: event.id } }, event.id)]
      status = 'failed'
      break
    case 'interrupted':
      parts = [...parts, withPartId({ type: 'status', text: '已停止', status: 'interrupted', metadata: { eventId: event.id } }, event.id)]
      status = 'interrupted'
      break
    case 'completed':
      if (status !== 'failed' && status !== 'interrupted') status = 'completed'
      break
    case 'compaction-started':
      parts = [...parts, withPartId({ type: 'status', text: '正在压缩上下文', status: 'compacting', metadata: { eventId: event.id } }, event.id)]
      status = 'streaming'
      break
    case 'compaction-finished':
      parts = [...parts, withPartId({ type: 'status', text: '上下文已压缩', status: 'compacted', metadata: { eventId: event.id } }, event.id)]
      break
    case 'recovery-started':
      parts = [...parts, withPartId({ type: 'status', text: '正在恢复会话', status: 'recovering', metadata: { eventId: event.id } }, event.id)]
      status = 'streaming'
      break
    case 'recovery-finished':
      parts = [...parts, withPartId({ type: 'status', text: '会话已恢复', status: 'recovered', metadata: { eventId: event.id } }, event.id)]
      break
    default:
      break
  }

  return { parts, status, lastSequence: Math.max(state.lastSequence, event.sequence) }
}

export function reduceAiMessageParts(state: AiMessagePartState, action: AiMessagePartAction): AiMessagePartState {
  if (action.type === 'reset') return { parts: action.parts || [], status: action.status || 'idle', lastSequence: -1 }
  if (action.type === 'parts') return { ...state, parts: [...state.parts, ...action.parts] }
  if (action.type === 'interrupt') return { ...state, status: 'interrupted' }
  if (action.type === 'event') return reduceEvent(state, action.event)
  if (action.type === 'events') return action.events.reduce(reduceEvent, state)
  return state
}

export function replayAiEvents(events: AiEventRecord[], initial: AiMessagePartState = initialAiMessagePartState): AiMessagePartState {
  return reduceAiMessageParts(initial, { type: 'events', events: [...events].sort((a, b) => a.sequence - b.sequence) })
}
