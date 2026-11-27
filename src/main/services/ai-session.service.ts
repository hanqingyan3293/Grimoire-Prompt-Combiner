import crypto from "crypto"
import type { AiAttachmentRecord, AiEventRecord, AiEventType, AiMessageRecord, AiMessageRole, AiMessageStatus, AiPermissionRecord, AiRuntimeKind, AiSessionKind, AiSessionRecord, AiSessionStatus } from "../../shared/ai-types"
import { getDatabase, saveDatabase } from "../database"
import { toAiMessagePartsContent } from "../../shared/ai-message-parts"
import { compareOrderKeysEmptyLast, evenlySpacedKeys, hasRoomBetween, orderKeyBetween } from "./resource-order"
import { preserveRuntimeMetadata, publicRuntimeMetadata } from './agent-runtime-reference.service'
import { cleanupAiAttachmentCopies } from './ai-attachment.service'
import { copyFinalizationFailure, OwnedCopyCleanupError, type OwnedCopyCleanupResult } from './owned-copy-cleanup'

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    const parsed = JSON.parse(String(value || "")) as T
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function sessionFromRow(row: unknown[]): AiSessionRecord {
  return {
    id: String(row[0]),
    kind: String(row[1] || "chat") as AiSessionKind,
    runtime: String(row[2] || "openai-compatible") as AiRuntimeKind,
    provider_id: String(row[3] || ""),
    model_id: String(row[4] || ""),
    title: String(row[5] || ""),
    status: String(row[6] || "idle") as AiSessionStatus,
    parent_id: row[7] == null ? null : String(row[7]),
    metadata: publicRuntimeMetadata(parseJson(row[8], {})),
    created_at: String(row[9]),
    updated_at: String(row[10]),
    archived: Number(row[11] || 0) === 1,
    pinned: Number(row[12] || 0) === 1,
    order_key: String(row[13] || ''),
    group_id: row[14] == null ? null : String(row[14]),
    last_activity_at: String(row[15] || row[10] || ''),
  }
}

const SESSION_SELECT = `SELECT s.id,s.kind,s.runtime,s.provider_id,s.model_id,s.title,s.status,s.parent_id,s.metadata_json,s.created_at,s.updated_at,
  COALESCE(r.archived, 0),COALESCE(r.pinned, 0),COALESCE(r.order_key, ''),r.group_id,COALESCE(r.last_activity_at, s.updated_at)
  FROM ai_sessions s LEFT JOIN cherry_resource_state r ON r.entity_type='session' AND r.entity_id=s.id`

function ensureSessionResourceState(sessionId: string): void {
  const db = getDatabase()
  const existing = db.exec("SELECT entity_id FROM cherry_resource_state WHERE entity_type='session' AND entity_id=?", [sessionId])[0]?.values?.[0]
  if (existing) return
  const session = db.exec('SELECT created_at,updated_at,metadata_json FROM ai_sessions WHERE id=?', [sessionId])[0]?.values?.[0]
  if (!session) return
  let metadata: Record<string, unknown> = {}
  try { metadata = JSON.parse(String(session[2] || '{}')) as Record<string, unknown> } catch {}
  db.run('INSERT OR IGNORE INTO cherry_resource_state (entity_type,entity_id,archived,deleted_at,pinned,order_key,group_id,owner_id,last_activity_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [
    'session', sessionId, 0, null, metadata.pinned === true ? 1 : 0, String(session[1] || session[0] || sessionId), typeof metadata.groupId === 'string' ? metadata.groupId : null, null, String(session[1] || session[0] || ''), new Date().toISOString(), new Date().toISOString()
  ])
}


function messageFromRow(row: unknown[]): AiMessageRecord {
  const parsedContent = parseJson(row[4], { text: "" })
  return {
    id: String(row[0]),
    session_id: String(row[1]),
    sequence: Number(row[2]),
    role: String(row[3] || "user") as AiMessageRole,
    content: toAiMessagePartsContent(parsedContent, String(row[3] || 'assistant')),
    attachments: parseJson(row[5], []),
    status: String(row[6] || "completed") as AiMessageStatus,
    created_at: String(row[7]),
  }
}

function eventFromRow(row: unknown[]): AiEventRecord {
  return {
    id: String(row[0]),
    session_id: String(row[1]),
    sequence: Number(row[2]),
    event_type: String(row[3] || "status") as AiEventType,
    payload: parseJson(row[4], {}),
    created_at: String(row[5]),
  }
}

function permissionFromRow(row: unknown[]): AiPermissionRecord {
  return { id: String(row[0]), session_id: String(row[1]), request_id: String(row[2]), permission: String(row[3]) as AiPermissionRecord['permission'], detail: parseJson(row[4], {}), decision: String(row[5] || 'pending') as AiPermissionRecord['decision'], created_at: String(row[6]), resolved_at: row[7] == null ? null : String(row[7]) }
}

function readSession(id: string): AiSessionRecord | null {
  ensureSessionResourceState(id)
  const row = getDatabase().exec(SESSION_SELECT + ' WHERE s.id=?', [id])[0]?.values?.[0]
  return row ? sessionFromRow(row) : null
}

/**
 * Source `latestSession` contract (`/agent-sessions/latest`): a dedicated
 * `lastActivityAt DESC LIMIT 1` query so resuming the last-touched conversation never
 * depends on the pinned-first list order. `kind` scopes it to the surface requesting
 * it; archived sessions are excluded (source latest only sees active rows).
 */
export function getLatestAiSession(input: { kind?: AiSessionKind } = {}): AiSessionRecord | null {
  const db = getDatabase()
  const rows = db.exec('SELECT id FROM ai_sessions')[0]?.values || []
  for (const row of rows) ensureSessionResourceState(String(row[0]))
  const clauses = ['COALESCE(r.archived,0)=0']
  const params: unknown[] = []
  if (input.kind) { clauses.push('s.kind=?'); params.push(input.kind) }
  const row = db.exec(SESSION_SELECT + ' WHERE ' + clauses.join(' AND ') + ' ORDER BY COALESCE(r.last_activity_at, s.updated_at) DESC, s.id DESC LIMIT 1', params)[0]?.values?.[0]
  return row ? sessionFromRow(row) : null
}

function ensureAllSessionResourceState(): void {
  const rows = getDatabase().exec('SELECT id FROM ai_sessions')[0]?.values || []
  for (const row of rows) ensureSessionResourceState(String(row[0]))
}

export function listAiSessions(input: { query?: string; kind?: AiSessionKind; limit?: number; includeArchived?: boolean; manualOrder?: boolean } = {}): AiSessionRecord[] {
  const db = getDatabase()
  const query = input.query?.trim().toLowerCase()
  const limit = Math.max(1, Math.min(200, Number(input.limit || 100)))
  const ids = db.exec('SELECT id FROM ai_sessions')[0]?.values || []
  for (const row of ids) ensureSessionResourceState(String(row[0]))
  const clauses: string[] = []
  const params: unknown[] = []
  if (!input.includeArchived) clauses.push('COALESCE(r.archived,0)=0')
  if (input.kind) { clauses.push('s.kind=?'); params.push(input.kind) }
  if (query) {
    clauses.push('(lower(s.title) LIKE ? OR lower(s.runtime) LIKE ? OR lower(s.model_id) LIKE ? OR lower(s.provider_id) LIKE ?)')
    const pattern = '%' + query + '%'
    params.push(pattern, pattern, pattern, pattern)
  }
  const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''
  // Activity order stays the default; manual order is the explicit drag-sort mode and
  // matches `manualOrderEntries` (pinned first, un-keyed rows after keyed ones).
  const orderBy = input.manualOrder
    ? " ORDER BY COALESCE(r.pinned,0) DESC, CASE WHEN COALESCE(r.order_key,'')='' THEN 1 ELSE 0 END ASC, COALESCE(r.order_key,'') ASC, COALESCE(r.last_activity_at,s.updated_at) DESC, s.id DESC"
    : " ORDER BY COALESCE(r.pinned,0) DESC, COALESCE(r.last_activity_at,s.updated_at) DESC, COALESCE(r.order_key,'') ASC, s.id DESC"
  const rows = db.exec(SESSION_SELECT + where + orderBy + ' LIMIT ?', [...params, limit])[0]?.values || []
  return rows.map(sessionFromRow)
}

export function updateAiSessionResource(input: { id: string; archived?: boolean; pinned?: boolean; orderKey?: string; groupId?: string | null }): AiSessionRecord {
  const current = readSession(input.id)
  if (!current) throw new Error('AI 会话不存在')
  if (input.archived === true && current.status === 'running') throw new Error('AI_SESSION_ARCHIVE_BLOCKED: 运行中的会话不能归档')
  ensureSessionResourceState(input.id)
  const now = new Date().toISOString()
  const db = getDatabase()
  const state = db.exec("SELECT archived,pinned,order_key,group_id FROM cherry_resource_state WHERE entity_type='session' AND entity_id=?", [input.id])[0]?.values?.[0]
  const archived = input.archived === undefined ? Number(state?.[0] || 0) : input.archived ? 1 : 0
  const pinned = input.pinned === undefined ? Number(state?.[1] || 0) : input.pinned ? 1 : 0
  const orderKey = input.orderKey === undefined ? String(state?.[2] || '') : input.orderKey.trim().slice(0, 200)
  const groupId = input.groupId === undefined ? (state?.[3] == null ? null : String(state[3])) : input.groupId
  db.run("UPDATE cherry_resource_state SET archived=?,deleted_at=?,pinned=?,order_key=?,group_id=?,last_activity_at=?,updated_at=? WHERE entity_type='session' AND entity_id=?", [archived, archived ? now : null, pinned, orderKey, groupId, current.last_activity_at || current.updated_at || now, now, input.id])
  saveDatabase()
  return readSession(input.id)!
}

export function archiveAiSession(id: string): AiSessionRecord { return updateAiSessionResource({ id, archived: true }) }
export function restoreAiSession(id: string): AiSessionRecord { return updateAiSessionResource({ id, archived: false }) }
export function pinAiSession(id: string, pinned: boolean): AiSessionRecord { return updateAiSessionResource({ id, pinned }) }

function readOrderKey(id: string): string {
  ensureSessionResourceState(id)
  const row = getDatabase().exec("SELECT order_key FROM cherry_resource_state WHERE entity_type='session' AND entity_id=?", [id])[0]?.values?.[0]
  return typeof row?.[0] === 'string' ? row[0] : ''
}

/** Id/key pairs of every non-archived session in manual display order (pinned first, empty keys last). */
function manualOrderEntries(): Array<{ id: string; key: string }> {
  const db = getDatabase()
  const ids = (db.exec('SELECT id FROM ai_sessions')[0]?.values || []).map(row => String(row[0]))
  for (const id of ids) ensureSessionResourceState(id)
  const rows = db.exec(`
    SELECT s.id, COALESCE(r.order_key,''), COALESCE(r.pinned,0), COALESCE(r.last_activity_at, s.updated_at)
    FROM ai_sessions s LEFT JOIN cherry_resource_state r ON r.entity_type='session' AND r.entity_id=s.id
    WHERE COALESCE(r.archived,0)=0
  `)[0]?.values || []
  return rows
    .map(row => ({ id: String(row[0]), key: String(row[1] || ''), pinned: Number(row[2] || 0), activity: String(row[3] || '') }))
    .sort((a, b) =>
      b.pinned - a.pinned ||
      compareOrderKeysEmptyLast(a.key, b.key) ||
      (a.activity < b.activity ? 1 : a.activity > b.activity ? -1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ id, key }) => ({ id, key }))
}

function rebalanceSessionOrderKeys(): void {
  const ordered = manualOrderEntries()
  const keys = evenlySpacedKeys(ordered.length)
  const now = new Date().toISOString()
  ordered.forEach((entry, index) => {
    getDatabase().run("UPDATE cherry_resource_state SET order_key=?, updated_at=? WHERE entity_type='session' AND entity_id=?", [keys[index], now, entry.id])
  })
  saveDatabase()
}

/**
 * Source-shaped drop reorder: `overId` is the row under the drop and `position`
 * 'before'/'after' matches the source ResourceList item payload. Neighbors are
 * resolved from the current manual order (excluding the moved row); dropping onto a
 * group ('last') appends at the end. Only the moved row is written unless the two
 * neighbors leave no room, in which case the session scope is rebalanced once.
 */
export function reorderAiSession(input: { id: string; overId: string; position: 'before' | 'after' | 'last' }): AiSessionRecord {
  const session = readSession(input.id)
  if (!session) throw new Error('AI 会话不存在')
  const overId = String(input.overId || '')
  const position = input.position === 'after' || input.position === 'last' ? input.position : 'before'

  const ordered = manualOrderEntries().filter(entry => entry.id !== input.id)
  let previousId: string | null = null
  let nextId: string | null = null

  if (position === 'last') {
    previousId = ordered.length ? ordered[ordered.length - 1].id : null
  } else {
    const overIndex = ordered.findIndex(entry => entry.id === overId)
    if (overIndex === -1) throw new Error('ORDER_OVER_NOT_FOUND: 目标会话不在当前列表中')
    if (position === 'before') {
      previousId = overIndex > 0 ? ordered[overIndex - 1].id : null
      nextId = ordered[overIndex].id
    } else {
      previousId = ordered[overIndex].id
      nextId = overIndex + 1 < ordered.length ? ordered[overIndex + 1].id : null
    }
  }

  let previousKey = previousId ? readOrderKey(previousId) : null
  let nextKey = nextId ? readOrderKey(nextId) : null
  if (previousKey === '') previousKey = null
  if (nextKey === '') nextKey = null

  if (!hasRoomBetween(previousKey, nextKey)) {
    rebalanceSessionOrderKeys()
    previousKey = previousId ? readOrderKey(previousId) : null
    nextKey = nextId ? readOrderKey(nextId) : null
    if (previousKey === '') previousKey = null
    if (nextKey === '') nextKey = null
    if (!hasRoomBetween(previousKey, nextKey)) throw new Error('ORDER_REBALANCE_FAILED: 无法为该位置分配排序键')
  }

  return updateAiSessionResource({ id: input.id, orderKey: orderKeyBetween(previousKey, nextKey) })
}

export function getAiSession(id: string): { session: AiSessionRecord; messages: AiMessageRecord[]; events: AiEventRecord[] } | null {
  const session = readSession(id)
  if (!session) return null
  const db = getDatabase()
  const messages = (db.exec('SELECT id,session_id,sequence,role,content_json,attachments_json,status,created_at FROM ai_messages WHERE session_id=? ORDER BY sequence ASC', [id])[0]?.values || []).map(messageFromRow)
  const events = (db.exec('SELECT id,session_id,sequence,event_type,payload_json,created_at FROM ai_events WHERE session_id=? ORDER BY sequence ASC', [id])[0]?.values || []).map(eventFromRow)
  return { session, messages, events }
}

export function createAiSession(input: { kind?: AiSessionKind; runtime?: AiRuntimeKind; providerId?: string; modelId?: string; title?: string; parentId?: string; metadata?: Record<string, unknown> }): AiSessionRecord {
  if (input.parentId && !readSession(input.parentId)) throw new Error('父级 AI 会话不存在')
  preserveRuntimeMetadata({}, input.metadata || {})
  const now = new Date().toISOString()
  const id = 'ai_session_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24)
  getDatabase().run('INSERT INTO ai_sessions (id,kind,runtime,provider_id,model_id,title,status,parent_id,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id, input.kind || 'chat', input.runtime || 'openai-compatible', input.providerId || '', input.modelId || '', input.title || '新 Agent 会话', 'idle', input.parentId || null, JSON.stringify(input.metadata || {}), now, now])
  getDatabase().run('INSERT OR IGNORE INTO cherry_resource_state (entity_type,entity_id,archived,deleted_at,pinned,order_key,group_id,owner_id,last_activity_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', ['session', id, 0, null, input.metadata?.pinned === true ? 1 : 0, now + ':' + id, typeof input.metadata?.groupId === 'string' ? input.metadata.groupId : null, null, now, now, now])
  saveDatabase()
  return readSession(id)!
}

export function updateAiSession(input: { id: string; title?: string; status?: AiSessionStatus; runtime?: AiRuntimeKind; providerId?: string; modelId?: string; metadata?: Record<string, unknown> }): AiSessionRecord {
  const current = readSession(input.id)
  if (!current) throw new Error('AI 会话不存在')
  const next = {
    title: input.title ?? current.title,
    status: input.status ?? current.status,
    runtime: input.runtime ?? current.runtime,
    providerId: input.providerId ?? current.provider_id,
    modelId: input.modelId ?? current.model_id,
    metadata: preserveRuntimeMetadata(parseJson(getDatabase().exec('SELECT metadata_json FROM ai_sessions WHERE id=?', [input.id])[0]?.values?.[0]?.[0], {}), input.metadata ?? current.metadata),
    updatedAt: new Date().toISOString(),
  }
  getDatabase().run('UPDATE ai_sessions SET title=?,status=?,runtime=?,provider_id=?,model_id=?,metadata_json=?,updated_at=? WHERE id=?', [next.title, next.status, next.runtime, next.providerId, next.modelId, JSON.stringify(next.metadata), next.updatedAt, input.id])
  ensureSessionResourceState(input.id)
  getDatabase().run("UPDATE cherry_resource_state SET last_activity_at=?,updated_at=? WHERE entity_type='session' AND entity_id=?", [next.updatedAt, next.updatedAt, input.id])
  saveDatabase()
  return readSession(input.id)!
}

export function appendAiMessage(input: { sessionId: string; role: AiMessageRole; content: unknown; attachments?: unknown[]; status?: AiMessageStatus; id?: string }): AiMessageRecord {
  if (!readSession(input.sessionId)) throw new Error('AI 会话不存在')
  const db = getDatabase()
  const last = db.exec('SELECT MAX(sequence) FROM ai_messages WHERE session_id=?', [input.sessionId])[0]?.values?.[0]?.[0]
  const sequence = Number(last ?? -1) + 1
  const id = input.id || 'ai_message_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24)
  const createdAt = new Date().toISOString()
  const normalizedContent = toAiMessagePartsContent(input.content, input.role)
  db.run('INSERT INTO ai_messages (id,session_id,sequence,role,content_json,attachments_json,status,created_at) VALUES (?,?,?,?,?,?,?,?)', [id, input.sessionId, sequence, input.role, JSON.stringify(normalizedContent), JSON.stringify(input.attachments || []), input.status || 'completed', createdAt])
  db.run('UPDATE ai_sessions SET updated_at=? WHERE id=?', [createdAt, input.sessionId])
  ensureSessionResourceState(input.sessionId)
  db.run("UPDATE cherry_resource_state SET last_activity_at=?,updated_at=? WHERE entity_type='session' AND entity_id=?", [createdAt, createdAt, input.sessionId])
  saveDatabase()
  return messageFromRow([id, input.sessionId, sequence, input.role, JSON.stringify(normalizedContent), JSON.stringify(input.attachments || []), input.status || 'completed', createdAt])
}

export function getAiMessage(id: string): AiMessageRecord | null {
  const row = getDatabase().exec('SELECT id,session_id,sequence,role,content_json,attachments_json,status,created_at FROM ai_messages WHERE id=?', [id])[0]?.values?.[0]
  return row ? messageFromRow(row) : null
}

export function updateAiMessage(input: { id: string; content?: unknown; attachments?: unknown[]; status?: AiMessageStatus }): AiMessageRecord {
  const current = getAiMessage(input.id)
  if (!current) throw new Error('AI 消息不存在')
  const content = input.content === undefined ? current.content : toAiMessagePartsContent(input.content, current.role)
  const attachments = input.attachments === undefined ? current.attachments : input.attachments
  const status = input.status || current.status
  const updatedAt = new Date().toISOString()
  getDatabase().run('UPDATE ai_messages SET content_json=?,attachments_json=?,status=? WHERE id=?', [JSON.stringify(content), JSON.stringify(attachments), status, input.id])
  getDatabase().run('UPDATE ai_sessions SET updated_at=? WHERE id=?', [updatedAt, current.session_id])
  saveDatabase()
  return getAiMessage(input.id)!
}

export function deleteAiMessage(id: string): boolean {
  const current = getAiMessage(id)
  if (!current) return false
  const result = getDatabase().run('DELETE FROM ai_messages WHERE id=?', [id])
  getDatabase().run('UPDATE ai_sessions SET updated_at=? WHERE id=?', [new Date().toISOString(), current.session_id])
  saveDatabase()
  return Number(result.changes || 0) > 0
}

export function appendAiEvent(input: { sessionId: string; eventType: AiEventType | string; payload?: Record<string, unknown>; id?: string }): AiEventRecord {
  if (!readSession(input.sessionId)) throw new Error('AI 会话不存在')
  const db = getDatabase()
  const last = db.exec('SELECT MAX(sequence) FROM ai_events WHERE session_id=?', [input.sessionId])[0]?.values?.[0]?.[0]
  const sequence = Number(last ?? -1) + 1
  const id = input.id || 'ai_event_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24)
  const createdAt = new Date().toISOString()
  const payload = input.payload || {}
  db.run('INSERT INTO ai_events (id,session_id,sequence,event_type,payload_json,created_at) VALUES (?,?,?,?,?,?)', [id, input.sessionId, sequence, input.eventType, JSON.stringify(payload), createdAt])
  db.run('UPDATE ai_sessions SET updated_at=? WHERE id=?', [createdAt, input.sessionId])
  saveDatabase()
  return eventFromRow([id, input.sessionId, sequence, input.eventType, JSON.stringify(payload), createdAt])
}

export function createAiPermission(input: { sessionId: string; requestId: string; permission: AiPermissionRecord['permission']; detail?: unknown }): AiPermissionRecord {
  if (!readSession(input.sessionId)) throw new Error('AI 会话不存在')
  const id = 'ai_permission_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24)
  const createdAt = new Date().toISOString()
  getDatabase().run('INSERT OR REPLACE INTO ai_permissions (id,session_id,request_id,permission,detail_json,decision,created_at,resolved_at) VALUES (?,?,?,?,?,?,?,?)', [id, input.sessionId, input.requestId, input.permission, JSON.stringify(input.detail || {}), 'pending', createdAt, null])
  saveDatabase()
  return permissionFromRow([id, input.sessionId, input.requestId, input.permission, JSON.stringify(input.detail || {}), 'pending', createdAt, null])
}

export function resolveAiPermission(input: { requestId: string; decision: AiPermissionRecord['decision'] }): AiPermissionRecord | null {
  const row = getDatabase().exec('SELECT id,session_id,request_id,permission,detail_json,decision,created_at,resolved_at FROM ai_permissions WHERE request_id=?', [input.requestId])[0]?.values?.[0]
  if (!row) return null
  // A permission decision is terminal. Keeping the first value means the IPC
  // answer and the send loop cannot overwrite one another with a second
  // (possibly downgraded) decision.
  if (String(row[5] || 'pending') !== 'pending') return permissionFromRow(row)
  const resolvedAt = new Date().toISOString()
  getDatabase().run('UPDATE ai_permissions SET decision=?,resolved_at=? WHERE request_id=?', [input.decision, resolvedAt, input.requestId])
  saveDatabase()
  return permissionFromRow([row[0], row[1], row[2], row[3], row[4], input.decision, row[6], resolvedAt])
}

export function branchAiSession(input: { sessionId: string; title?: string }): AiSessionRecord {
  const source = getAiSession(input.sessionId)
  if (!source) throw new Error('AI 会话不存在')
  const branchMetadata = Object.fromEntries(Object.entries(source.session.metadata).filter(([key]) => key !== 'runtimeSessionId'))
  const next = createAiSession({ kind: source.session.kind, runtime: source.session.runtime, providerId: source.session.provider_id, modelId: source.session.model_id, title: input.title || source.session.title + '（分支）', parentId: source.session.id, metadata: branchMetadata })
  for (const message of source.messages) appendAiMessage({ sessionId: next.id, role: message.role, content: message.content, attachments: message.attachments, status: message.status })
  for (const event of source.events) appendAiEvent({ sessionId: next.id, eventType: event.event_type, payload: event.payload })
  return readSession(next.id)!
}

export function importAiSessionSnapshot(input: { session?: Partial<AiSessionRecord>; messages?: Array<{ role: AiMessageRole; content: unknown; attachments?: unknown[]; status?: AiMessageStatus }>; events?: Array<{ event_type?: string; payload?: Record<string, unknown> }>; attachments?: Array<Partial<AiAttachmentRecord>> }): AiSessionRecord {
  const session = createAiSession({
    kind: input.session?.kind,
    runtime: input.session?.runtime,
    providerId: input.session?.provider_id,
    modelId: input.session?.model_id,
    title: input.session?.title || '导入的 Agent 会话',
    metadata: { ...(input.session?.metadata || {}), importedAt: new Date().toISOString() },
  })
  const attachmentIds = new Map<string, string>()
  for (const attachment of input.attachments || []) {
    const originalId = typeof attachment.id === 'string' ? attachment.id : ''
    const id = 'ai_attachment_imported_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20)
    if (originalId) attachmentIds.set(originalId, id)
    const now = new Date().toISOString()
    getDatabase().run('INSERT INTO ai_attachments (id,session_id,message_id,source_type,file_path,original_name,mime_type,size,sha256,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, session.id, null, attachment.source_type || 'file', '', attachment.original_name || '', attachment.mime_type || 'application/octet-stream', Number(attachment.size || 0), attachment.sha256 || '', 'missing', JSON.stringify({ importedAttachmentId: originalId || null }), now, now])
  }
  for (const message of input.messages || []) {
    const attachments = (message.attachments || []).map(item => {
      if (!item || typeof item !== 'object') return item
      const value = item as Record<string, unknown>
      const oldId = typeof value.attachmentId === 'string' ? value.attachmentId : ''
      return oldId && attachmentIds.has(oldId) ? { ...value, attachmentId: attachmentIds.get(oldId) } : item
    })
    const importedMessage = appendAiMessage({ sessionId: session.id, role: message.role, content: message.content, attachments, status: message.status })
    for (const item of attachments) {
      if (!item || typeof item !== 'object') continue
      const attachmentId = typeof (item as Record<string, unknown>).attachmentId === 'string' ? String((item as Record<string, unknown>).attachmentId) : ''
      if (attachmentId && Array.from(attachmentIds.values()).includes(attachmentId)) getDatabase().run('UPDATE ai_attachments SET message_id=?,updated_at=? WHERE id=?', [importedMessage.id, new Date().toISOString(), attachmentId])
    }
  }
  for (const event of input.events || []) appendAiEvent({ sessionId: session.id, eventType: event.event_type || 'status', payload: event.payload || {} })
  saveDatabase()
  return readSession(session.id)!
}

export function deleteAiSession(id: string): boolean {
  const db = getDatabase()
  let cleanup: OwnedCopyCleanupResult | undefined
  db.exec('BEGIN IMMEDIATE')
  try {
    const attachments = db.exec("SELECT id FROM ai_attachments WHERE session_id=? AND status<>'deleted' ORDER BY rowid", [id])[0]?.values || []
    cleanup = cleanupAiAttachmentCopies(attachments.map(row => String(row[0])))
    if (cleanup.status !== 'completed') throw new OwnedCopyCleanupError('AI_ATTACHMENT_CLEANUP_FAILED', cleanup)
    const result = db.run('DELETE FROM ai_sessions WHERE id=?', [id])
    db.run("DELETE FROM cherry_resource_state WHERE entity_type='session' AND entity_id=?", [id])
    db.exec('COMMIT')
    saveDatabase()
    return Number(result.changes || 0) > 0
  } catch (error) {
    try { db.exec('ROLLBACK') } catch (rollbackError) { console.debug('[sessions] rollback settled', rollbackError) }
    if (cleanup && !(error instanceof OwnedCopyCleanupError)) throw new OwnedCopyCleanupError('AI_ATTACHMENT_DELETE_DB_FAILED', copyFinalizationFailure(cleanup, error, id))
    throw error
  }
}
