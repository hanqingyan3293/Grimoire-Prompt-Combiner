import type { AiEventRecord, AiMessageRecord, AiSessionRecord } from '@shared/ai-types'
import { normalizeAiMessageParts, type AiMessagePart } from '@shared/ai-message-parts'

export type CherryMessagePart = AiMessagePart

export type CherryMessageViewModel = {
  id: string
  sessionId: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  parts: CherryMessagePart[]
  attachments: unknown[]
  status: string
  createdAt: string
}

export type CherrySessionViewModel = {
  id: string
  title: string
  runtime: string
  providerId: string
  modelId: string
  status: string
  parentId: string | null
  createdAt: string
  updatedAt: string
}

export function toCherryMessage(message: AiMessageRecord): CherryMessageViewModel {
  return {
    id: message.id,
    sessionId: message.session_id,
    role: message.role,
    parts: normalizeAiMessageParts(message.content, message.role),
    attachments: message.attachments || [],
    status: message.status,
    createdAt: message.created_at,
  }
}

export function toCherrySession(session: AiSessionRecord): CherrySessionViewModel {
  return {
    id: session.id,
    title: session.title,
    runtime: session.runtime,
    providerId: session.provider_id,
    modelId: session.model_id,
    status: session.status,
    parentId: session.parent_id,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  }
}

export function eventToMessagePart(event: AiEventRecord): CherryMessagePart | null {
  const payload = event.payload || {}
  switch (event.event_type) {
    case 'text-delta': return { type: 'text', text: String(payload.text || ''), metadata: { eventId: event.id, streaming: true } }
    case 'reasoning-delta': return { type: 'reasoning', text: String(payload.text || ''), metadata: { eventId: event.id, streaming: true } }
    case 'tool-started': return { type: 'tool-call', callId: String(payload.callId || ''), name: String(payload.name || ''), input: payload.input, status: 'running', metadata: { eventId: event.id } }
    case 'tool-progress': return { type: 'tool-call', callId: String(payload.callId || ''), name: String(payload.name || ''), input: payload.input, output: payload.output, error: typeof payload.error === 'string' ? payload.error : undefined, status: String(payload.status || 'running'), metadata: { eventId: event.id } }
    case 'tool-finished': return { type: 'tool-result', callId: String(payload.callId || ''), output: payload.output, error: typeof payload.error === 'string' ? payload.error : undefined, status: payload.error ? 'error' : 'completed', metadata: { eventId: event.id } }
    case 'agent-status': return { type: 'agent-status', text: String(payload.text || payload.status || ''), status: String(payload.status || 'running'), detail: payload.detail, metadata: { eventId: event.id } }
    case 'mcp-event': return { type: 'mcp', text: String(payload.message || payload.tool || ''), name: String(payload.tool || ''), status: String(payload.status || 'running'), output: payload.payload, error: typeof payload.error === 'string' ? payload.error : undefined, metadata: { eventId: event.id } }
    case 'permission-requested': return { type: 'permission', requestId: String(payload.requestId || ''), permission: String(payload.permission || payload.action || ''), detail: payload.detail, status: 'pending', metadata: { eventId: event.id } }
    case 'permission-resolved': return { type: 'permission', requestId: String(payload.requestId || ''), permission: String(payload.permission || ''), detail: payload.detail, status: String(payload.decision || 'resolved'), metadata: { eventId: event.id } }
    case 'failed': return { type: 'error', text: String(payload.message || payload.error || 'Agent 请求失败'), status: 'failed', metadata: { eventId: event.id } }
    case 'completed': return { type: 'status', text: '已完成', status: 'completed', metadata: { eventId: event.id } }
    case 'recovery-started': return { type: 'status', text: '正在恢复会话', status: 'recovering', metadata: { eventId: event.id } }
    case 'recovery-finished': return { type: 'status', text: '会话已恢复', status: 'recovered', metadata: { eventId: event.id } }
    default: return null
  }
}
