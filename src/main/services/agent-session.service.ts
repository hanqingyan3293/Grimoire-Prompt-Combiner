import crypto from 'crypto'
import type { AgentRuntimeKind, AgentSessionEventRecord, AgentSessionEventType, AgentSessionRecord, AgentSessionStatus } from '../../shared/agent-types'
import { getDatabase, saveDatabase } from '../database'

function parseJson(value: unknown, fallback: Record<string, unknown> = {}) {
  try { const parsed = JSON.parse(String(value || '{}')); return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : fallback } catch { return fallback }
}

function rowToSession(row: unknown[]): AgentSessionRecord {
  return { id: String(row[0]), runtime: String(row[1]) as AgentRuntimeKind, provider_id: String(row[2] || ''), model: String(row[3] || ''), title: String(row[4] || ''), status: String(row[5] || 'idle') as AgentSessionStatus, parent_id: row[6] == null ? null : String(row[6]), data: parseJson(row[7]), created_at: String(row[8]), updated_at: String(row[9]) }
}

function rowToEvent(row: unknown[]): AgentSessionEventRecord {
  return { id: String(row[0]), session_id: String(row[1]), sequence: Number(row[2]), type: String(row[3]) as AgentSessionEventType, data: parseJson(row[4]), created_at: String(row[5]) }
}

export function listAgentSessions(): AgentSessionRecord[] {
  const result = getDatabase().exec('SELECT id,runtime,provider_id,model,title,status,parent_id,data_json,created_at,updated_at FROM agent_sessions ORDER BY updated_at DESC')
  return (result[0]?.values || []).map(rowToSession)
}

export function getAgentSession(id: string): { session: AgentSessionRecord; events: AgentSessionEventRecord[] } | null {
  const db = getDatabase()
  const sessionRow = db.exec('SELECT id,runtime,provider_id,model,title,status,parent_id,data_json,created_at,updated_at FROM agent_sessions WHERE id=?', [id])[0]?.values?.[0]
  if (!sessionRow) return null
  const eventRows = db.exec('SELECT id,session_id,sequence,type,data_json,created_at FROM agent_session_events WHERE session_id=? ORDER BY sequence ASC', [id])[0]?.values || []
  return { session: rowToSession(sessionRow), events: eventRows.map(rowToEvent) }
}

export function createAgentSession(input: { runtime: AgentRuntimeKind; providerId?: string; model?: string; title?: string; parentId?: string }): AgentSessionRecord {
  const now = new Date().toISOString()
  const id = 'agent_session_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24)
  const parent = input.parentId ? getAgentSession(input.parentId) : null
  const data = parent?.session.data || {}
  getDatabase().run('INSERT INTO agent_sessions (id,runtime,provider_id,model,title,status,parent_id,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [id, input.runtime, input.providerId || '', input.model || '', input.title || '新 Agent 会话', 'idle', input.parentId || null, JSON.stringify(data), now, now])
  saveDatabase()
  return getAgentSession(id)!.session
}

export function appendAgentSessionEvent(input: { sessionId: string; type: AgentSessionEventType; data: Record<string, unknown> }): AgentSessionEventRecord {
  const session = getAgentSession(input.sessionId)
  if (!session) throw new Error('Agent 会话不存在')
  const sequence = session.events.length ? session.events[session.events.length - 1].sequence + 1 : 0
  const event = { id: 'agent_event_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24), session_id: input.sessionId, sequence, type: input.type, data: input.data, created_at: new Date().toISOString() }
  getDatabase().run('INSERT INTO agent_session_events (id,session_id,sequence,type,data_json,created_at) VALUES (?,?,?,?,?,?)', [event.id, event.session_id, event.sequence, event.type, JSON.stringify(event.data), event.created_at])
  getDatabase().run("UPDATE agent_sessions SET updated_at=? WHERE id=?", [event.created_at, input.sessionId])
  saveDatabase()
  return event
}

export function updateAgentSession(input: { id: string; status?: AgentSessionStatus; title?: string; data?: Record<string, unknown> }): AgentSessionRecord {
  const current = getAgentSession(input.id)
  if (!current) throw new Error('Agent 会话不存在')
  const next = { ...current.session, status: input.status || current.session.status, title: input.title ?? current.session.title, data: input.data ?? current.session.data, updated_at: new Date().toISOString() }
  getDatabase().run('UPDATE agent_sessions SET status=?,title=?,data_json=?,updated_at=? WHERE id=?', [next.status, next.title, JSON.stringify(next.data), next.updated_at, next.id])
  saveDatabase()
  return getAgentSession(input.id)!.session
}

export function branchAgentSession(input: { sessionId: string; title?: string }): AgentSessionRecord {
  const source = getAgentSession(input.sessionId)
  if (!source) throw new Error('Agent 会话不存在')
  const next = createAgentSession({ runtime: source.session.runtime, providerId: source.session.provider_id, model: source.session.model, title: input.title || source.session.title + '（分支）', parentId: source.session.id })
  for (const event of source.events) appendAgentSessionEvent({ sessionId: next.id, type: event.type, data: event.data })
  return getAgentSession(next.id)!.session
}

export function deleteAgentSession(id: string): boolean {
  const result = getDatabase().run('DELETE FROM agent_sessions WHERE id=?', [id])
  saveDatabase()
  return Number(result.changes || 0) > 0
}
