import crypto from 'crypto'
import { isDeepStrictEqual } from 'node:util'
import { getAgentBlueprint } from './agent-blueprint.service'
import type {
  AgentRuntimeKind,
  AgentSessionAttachment,
  AgentSessionData,
  AgentSessionEventRecord,
  AgentSessionEventType,
  AgentSessionRecord,
  AgentSessionSnapshot,
  AgentSessionStatus,
  AgentSessionWorkspace,
} from '../../shared/agent-types'
import { getDatabase, saveDatabase } from '../database'
import { preserveRuntimeMetadata, publicRuntimeMetadata } from './agent-runtime-reference.service'

const NAMESPACE_KEY = 'agentSession'
const MAX_NAME_LENGTH = 255
const MAX_ATTACHMENTS = 100
const MAX_CONFIG_DEPTH = 8

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function cloneJson<T>(value: T): T {
  try { return JSON.parse(JSON.stringify(value)) as T } catch { return value }
}

function parseJson(value: unknown, fallback: Record<string, unknown> = {}) {
  try {
    const parsed = JSON.parse(String(value ?? '{}'))
    return isPlainObject(parsed) ? cloneJson(parsed) : cloneJson(fallback)
  } catch {
    return cloneJson(fallback)
  }
}

function rejectUnsafeKey(key: string): void {
  if (/^(?:__proto__|prototype|constructor)$/i.test(key) || /(secret|token|password|api[_-]?key|authorization|cookie|env)/i.test(key)) {
    throw new Error('AGENT_SESSION_UNSAFE_METADATA')
  }
}

function isAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^[/\\]{1,2}/.test(value) || /^file:/i.test(value)
}

function validateJsonValue(value: unknown, depth = 0): void {
  if (depth > MAX_CONFIG_DEPTH || value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new Error('AGENT_SESSION_INVALID_CONFIG')
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('AGENT_SESSION_INVALID_CONFIG')
    if (typeof value === 'string' && isAbsolutePath(value)) throw new Error('AGENT_SESSION_UNSAFE_METADATA')
    return
  }
  if (Array.isArray(value)) { value.forEach(item => validateJsonValue(item, depth + 1)); return }
  if (!isPlainObject(value)) throw new Error('AGENT_SESSION_INVALID_CONFIG')
  for (const [key, child] of Object.entries(value)) { rejectUnsafeKey(key); validateJsonValue(child, depth + 1) }
}

function validateId(value: unknown, field: string, nullable = false, strict = true): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null && nullable) return null
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value) || isAbsolutePath(value)) {
    if (strict) throw new Error(`AGENT_SESSION_INVALID_${field.toUpperCase()}`)
    return undefined
  }
  return value
}

function validateBlueprintReference(agentId: string | null | undefined): void {
  if (typeof agentId === 'string' && !getAgentBlueprint(agentId)) throw new Error('AGENT_SESSION_AGENT_NOT_FOUND')
}

function normalizeAttachment(value: unknown, strict: boolean): AgentSessionAttachment | null {
  if (!isPlainObject(value)) { if (strict) throw new Error('AGENT_SESSION_INVALID_ATTACHMENT'); return null }
  const id = validateId(value.id, 'attachment_id', false, strict)
  const sourceType = value.sourceType
  const originalName = value.originalName
  const mimeType = value.mimeType
  const size = value.size
  const sha256 = value.sha256
  const status = value.status
  const invalid = typeof id !== 'string' || typeof sourceType !== 'string' || !/^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(sourceType)
    || typeof originalName !== 'string' || originalName.length === 0 || originalName.length > MAX_NAME_LENGTH || /[\\/\u0000-\u001f\u007f]/.test(originalName)
    || typeof mimeType !== 'string' || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(mimeType)
    || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0
    || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256)
    || (status !== 'available' && status !== 'missing')
    || (value.filePath !== undefined && (typeof value.filePath !== 'string' || isAbsolutePath(value.filePath)))
  if (invalid) { if (strict) throw new Error('AGENT_SESSION_INVALID_ATTACHMENT'); return null }
  // filePath is intentionally not projected. Paths are main-owned and must never escape in session DTOs.
  return { id, sourceType, originalName, mimeType, size, sha256: sha256.toLowerCase(), status }
}

function normalizeWorkspace(value: unknown, strict: boolean): AgentSessionWorkspace | undefined {
  if (value === undefined) return undefined
  if (!isPlainObject(value) || (value.type !== 'user' && value.type !== 'system')) { if (strict) throw new Error('AGENT_SESSION_INVALID_WORKSPACE'); return undefined }
  if (value.type === 'user') {
    const workspaceId = validateId(value.workspaceId, 'workspace', false, strict)
    if (typeof workspaceId !== 'string') { if (strict) throw new Error('AGENT_SESSION_INVALID_WORKSPACE'); return undefined }
    return { type: 'user', workspaceId }
  }
  if (value.path !== undefined && (typeof value.path !== 'string' || isAbsolutePath(value.path) || value.path.length > 512)) { if (strict) throw new Error('AGENT_SESSION_UNSAFE_METADATA'); return undefined }
  const workspaceId = validateId(value.workspaceId, 'workspace', false, strict)
  return { type: 'system', ...(value.path === undefined ? {} : { path: value.path as string }), ...(typeof workspaceId === 'string' ? { workspaceId } : {}) }
}

function normalizeSnapshot(value: unknown, strict: boolean): AgentSessionSnapshot | undefined {
  if (value === undefined) return undefined
  if (!isPlainObject(value) || value.version !== 1 || typeof value.capturedAt !== 'string' || Number.isNaN(Date.parse(value.capturedAt))
    || typeof value.runtime !== 'string' || typeof value.providerId !== 'string' || typeof value.model !== 'string') {
    if (strict) throw new Error('AGENT_SESSION_INVALID_SNAPSHOT')
    return undefined
  }
  const runtime = value.runtime as AgentRuntimeKind
  if (!['openai-compatible', 'anthropic', 'google', 'codex', 'opencode', 'pi'].includes(runtime)) { if (strict) throw new Error('AGENT_SESSION_INVALID_SNAPSHOT'); return undefined }
  const agentId = validateId(value.agentId, 'agent_id', true, strict)
  for (const field of ['providerId', 'model'] as const) {
    if (value[field] !== '' && typeof validateId(value[field], field, false, strict) !== 'string') return undefined
  }
  if (value.config !== undefined) {
    if (!isPlainObject(value.config)) { if (strict) throw new Error('AGENT_SESSION_INVALID_CONFIG'); return undefined }
    try { validateJsonValue(value.config) } catch { if (strict) throw new Error('AGENT_SESSION_UNSAFE_METADATA'); return undefined }
  }
  return {
    version: 1,
    capturedAt: value.capturedAt,
    ...(agentId !== undefined ? { agentId } : {}),
    runtime,
    providerId: value.providerId,
    model: value.model,
    ...(value.config === undefined ? {} : { config: cloneJson(value.config as Record<string, unknown>) }),
  }
}

export function normalizeAgentSessionData(value: unknown): AgentSessionData | undefined {
  try {
    if (!isPlainObject(value) || value.version !== 1) return undefined
    const result: AgentSessionData = { version: 1 }
    const runtimeSessionId = validateId(value.runtimeSessionId, 'runtime_session_id', false, false)
    if (typeof runtimeSessionId === 'string') result.runtimeSessionId = runtimeSessionId
    const agentId = validateId(value.agentId, 'agent_id', true, false)
    if (agentId !== undefined) result.agentId = agentId
    const workspace = normalizeWorkspace(value.workspace, false)
    if (workspace) result.workspace = workspace
    const snapshot = normalizeSnapshot(value.snapshot, false)
    if (snapshot) result.snapshot = snapshot
    if (Array.isArray(value.attachments)) {
      const attachments = value.attachments.slice(0, MAX_ATTACHMENTS).map(item => normalizeAttachment(item, false)).filter((item): item is AgentSessionAttachment => !!item)
      result.attachments = attachments
    }
    return result
  } catch {
    // Legacy data is untrusted. A malformed namespace must not make session reads or
    // generic runtime operations fail; callers retain the rest of data_json unchanged.
    return undefined
  }
}

function namespaceFromInput(input: { agentId?: string | null; workspace?: AgentSessionWorkspace; attachments?: unknown[]; snapshot?: AgentSessionSnapshot }, includeSnapshot = true): AgentSessionData | undefined {
  const result: AgentSessionData = { version: 1 }
  const agentId = validateId(input.agentId, 'agent_id', true)
  validateBlueprintReference(agentId)
  if (agentId !== undefined) result.agentId = agentId
  const workspace = normalizeWorkspace(input.workspace, true)
  if (workspace) result.workspace = workspace
  if (input.attachments !== undefined) {
    if (!Array.isArray(input.attachments) || input.attachments.length > MAX_ATTACHMENTS) throw new Error('AGENT_SESSION_INVALID_ATTACHMENT')
    result.attachments = input.attachments.map(item => normalizeAttachment(item, true)!).filter(Boolean)
  }
  if (includeSnapshot && input.snapshot !== undefined) {
    const snapshot = normalizeSnapshot(input.snapshot, true)
    if (snapshot) result.snapshot = snapshot
  }
  return Object.keys(result).length > 1 || input.agentId !== undefined || input.workspace !== undefined || input.attachments !== undefined || input.snapshot !== undefined ? result : undefined
}

function mergeNamespace(data: Record<string, unknown>, patch: AgentSessionData, allowSnapshot: boolean): Record<string, unknown> {
  const next = cloneJson(data)
  // Explicit operations patch the authoritative blob, not its redacted DTO.
  const current = next[NAMESPACE_KEY]
  const namespace: Record<string, unknown> = { ...(isPlainObject(current) ? current : {}), version: 1 }
  if (patch.agentId !== undefined) namespace.agentId = patch.agentId
  if (patch.workspace !== undefined) namespace.workspace = cloneJson(patch.workspace)
  if (patch.attachments !== undefined) namespace.attachments = cloneJson(patch.attachments)
  if (allowSnapshot && patch.snapshot !== undefined) namespace.snapshot = cloneJson(patch.snapshot)
  next[NAMESPACE_KEY] = namespace
  return next
}

function safeSessionData(value: unknown): Record<string, unknown> {
  const data = publicRuntimeMetadata(parseJson(value))
  if (Object.hasOwn(data, NAMESPACE_KEY)) {
    const namespace = normalizeAgentSessionData(data[NAMESPACE_KEY])
    if (namespace) data[NAMESPACE_KEY] = namespace
    else delete data[NAMESPACE_KEY]
  }
  return data
}
function rowToSession(row: unknown[], privateRead = false): AgentSessionRecord {
  return { id: String(row[0]), runtime: String(row[1]) as AgentRuntimeKind, provider_id: String(row[2] || ''), model: String(row[3] || ''), title: String(row[4] || ''), status: String(row[5] || 'idle') as AgentSessionStatus, parent_id: row[6] == null ? null : String(row[6]), data: privateRead ? parseJson(row[7]) : safeSessionData(row[7]), created_at: String(row[8]), updated_at: String(row[9]) }
}
function rowToEvent(row: unknown[]): AgentSessionEventRecord {
  return { id: String(row[0]), session_id: String(row[1]), sequence: Number(row[2]), type: String(row[3]) as AgentSessionEventType, data: parseJson(row[4]), created_at: String(row[5]) }
}
function sessionQuery(id: string, privateRead = false): AgentSessionRecord | null {
  const row = getDatabase().exec('SELECT id,runtime,provider_id,model,title,status,parent_id,data_json,created_at,updated_at FROM agent_sessions WHERE id=?', [id])[0]?.values?.[0]
  return row ? rowToSession(row, privateRead) : null
}

export function listAgentSessions(): AgentSessionRecord[] {
  const result = getDatabase().exec('SELECT id,runtime,provider_id,model,title,status,parent_id,data_json,created_at,updated_at FROM agent_sessions ORDER BY updated_at DESC')
  return (result[0]?.values || []).map(row => rowToSession(row))
}
export function getAgentSession(id: string): { session: AgentSessionRecord; events: AgentSessionEventRecord[] } | null {
  const session = sessionQuery(id)
  if (!session) return null
  const eventRows = getDatabase().exec('SELECT id,session_id,sequence,type,data_json,created_at FROM agent_session_events WHERE session_id=? ORDER BY sequence ASC', [id])[0]?.values || []
  return { session: { ...session, data: cloneJson(session.data) }, events: eventRows.map(rowToEvent).map(event => ({ ...event, data: cloneJson(event.data) })) }
}

function checkSnapshot(snapshot: AgentSessionSnapshot, session: Pick<AgentSessionRecord, 'runtime' | 'provider_id' | 'model' | 'data'>): AgentSessionSnapshot {
  const agentId = normalizeAgentSessionData(session.data[NAMESPACE_KEY])?.agentId ?? null
  if (snapshot.runtime !== session.runtime || snapshot.providerId !== session.provider_id || snapshot.model !== session.model
    || (snapshot.agentId !== undefined && snapshot.agentId !== agentId)) throw new Error('AGENT_SESSION_SNAPSHOT_MISMATCH')
  validateBlueprintReference(agentId)
  return { ...snapshot, agentId }
}

function persistSession(session: AgentSessionRecord): AgentSessionRecord {
  getDatabase().run('UPDATE agent_sessions SET status=?,title=?,data_json=?,updated_at=? WHERE id=?', [session.status, session.title, JSON.stringify(session.data), new Date().toISOString(), session.id])
  saveDatabase()
  return getAgentSession(session.id)!.session
}

type SessionNamespaceInput = { agentId?: string | null; workspace?: AgentSessionWorkspace; attachments?: unknown[]; snapshot?: AgentSessionSnapshot }
type CreateRuntimeSession = { runtime: AgentRuntimeKind; providerId?: string; model?: string; title?: string; parentId?: string } & SessionNamespaceInput
export function createAgentSession(input: CreateRuntimeSession): AgentSessionRecord {
  const session = createAgentSessionTx(input)
  saveDatabase()
  return session
}
/** DB-only main-internal primitive: caller owns transaction/save. The source
 * AgentSessionService.createTx reserves identity before workspace allocation.
 * No new history store, snapshot or runtime lifecycle/lease is introduced here.
 */
export function createAgentSessionTx(input: CreateRuntimeSession, reserved?: { id: string; createdAt: string }): AgentSessionRecord {
  const now = reserved?.createdAt ?? new Date().toISOString()
  const id = reserved?.id ?? 'agent_session_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24)
  const parent = input.parentId ? sessionQuery(input.parentId, true) : null
  if (input.parentId && !parent) throw new Error('父 Agent 会话不存在')
  const patch = namespaceFromInput(input)
  const inheritedData = publicRuntimeMetadata(cloneJson(parent?.data || {}))
  const data = patch ? mergeNamespace(inheritedData, patch, true) : inheritedData
  if (patch?.snapshot) {
    patch.snapshot = checkSnapshot(patch.snapshot, { runtime: input.runtime, provider_id: input.providerId || '', model: input.model || '', data })
    data[NAMESPACE_KEY] = mergeNamespace(data, patch, true)[NAMESPACE_KEY]
  }
  getDatabase().run('INSERT INTO agent_sessions (id,runtime,provider_id,model,title,status,parent_id,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [id, input.runtime, input.providerId || '', input.model || '', reserved ? input.title ?? '' : input.title || '新 Agent 会话', 'idle', input.parentId || null, JSON.stringify(data), now, now])
  return getAgentSession(id)!.session
}
export function appendAgentSessionEvent(input: { sessionId: string; type: AgentSessionEventType; data: Record<string, unknown> }): AgentSessionEventRecord {
  const session = getAgentSession(input.sessionId)
  if (!session) throw new Error('Agent 会话不存在')
  const sequence = session.events.length ? session.events[session.events.length - 1].sequence + 1 : 0
  const event = { id: 'agent_event_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24), session_id: input.sessionId, sequence, type: input.type, data: cloneJson(input.data), created_at: new Date().toISOString() }
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.run('INSERT INTO agent_session_events (id,session_id,sequence,type,data_json,created_at) VALUES (?,?,?,?,?,?)', [event.id, event.session_id, event.sequence, event.type, JSON.stringify(event.data), event.created_at])
    db.run("UPDATE agent_sessions SET updated_at=? WHERE id=?", [event.created_at, input.sessionId])
    // Source advanceLastActivityAtTx: only actual conversation messages count.
    // Same commit as the event; unmapped legacy rows and telemetry are untouched.
    if (event.type === 'message' && (event.data.role === 'user' || event.data.role === 'assistant')) {
      db.run('UPDATE agent_session_read_model SET last_activity_at=max(last_activity_at,?),updated_at=max(updated_at,?) WHERE id=? AND deleted_at IS NULL', [event.created_at, event.created_at, input.sessionId])
    }
    db.exec('COMMIT')
    saveDatabase()
    return cloneJson(event)
  } catch (error) { try { db.exec('ROLLBACK') } catch {} throw error }
}
export function updateAgentSession(input: { id: string; status?: AgentSessionStatus; title?: string; data?: Record<string, unknown> }): AgentSessionRecord {
  const current = sessionQuery(input.id, true)
  if (!current) throw new Error('Agent 会话不存在')
  if (input.title !== undefined && getDatabase().exec('SELECT 1 FROM agent_session_read_model WHERE id=?', [input.id])[0]?.values.length) throw new Error('AGENT_SESSION_READ_MODEL_OWNED')
  let data = current.data
  if (input.data !== undefined) {
    if (!isPlainObject(input.data)) throw new Error('AGENT_SESSION_INVALID_DATA')
    if (Object.hasOwn(input.data, NAMESPACE_KEY)) {
      const projected = normalizeAgentSessionData(current.data[NAMESPACE_KEY])
      if (!Object.hasOwn(current.data, NAMESPACE_KEY) || !isDeepStrictEqual(input.data[NAMESPACE_KEY], projected)) throw new Error('AGENT_SESSION_NAMESPACE_OWNED')
    }
    data = preserveRuntimeMetadata(current.data, cloneJson(input.data))
    if (Object.hasOwn(current.data, NAMESPACE_KEY)) data[NAMESPACE_KEY] = cloneJson(current.data[NAMESPACE_KEY])
  }
  return persistSession({ ...current, status: input.status || current.status, title: input.title ?? current.title, data })
}
export function attachAgentSession(input: { id: string } & Omit<SessionNamespaceInput, 'snapshot'>): AgentSessionRecord {
  const current = sessionQuery(input.id, true)
  if (!current) throw new Error('Agent 会话不存在')
  if ((input.agentId !== undefined || input.workspace !== undefined) && getDatabase().exec('SELECT 1 FROM agent_session_read_model WHERE id=?', [input.id])[0]?.values.length) throw new Error('AGENT_SESSION_READ_MODEL_OWNED')
  const patch = namespaceFromInput(input, false)
  if (!patch) return getAgentSession(input.id)!.session
  return persistSession({ ...current, data: mergeNamespace(current.data, patch, false) })
}
export function snapshotAgentSession(input: { id: string; snapshot: AgentSessionSnapshot }): AgentSessionRecord {
  const current = sessionQuery(input.id, true)
  if (!current) throw new Error('Agent 会话不存在')
  const snapshot = normalizeSnapshot(input.snapshot, true)
  if (!snapshot) throw new Error('AGENT_SESSION_INVALID_SNAPSHOT')
  const patch: AgentSessionData = { version: 1, snapshot: checkSnapshot(snapshot, current) }
  return persistSession({ ...current, data: mergeNamespace(current.data, patch, true) })
}

/** Main-only runtime mapping. The renderer cannot choose or overwrite this id. */
export function attachAgentRuntimeReference(input: { id: string; runtimeSessionId: string }): AgentSessionRecord {
  const current = sessionQuery(input.id, true)
  if (!current) throw new Error('Agent 会话不存在')
  const runtimeSessionId = validateId(input.runtimeSessionId, 'runtime_session_id')
  if (typeof runtimeSessionId !== 'string') throw new Error('AGENT_SESSION_INVALID_RUNTIME_SESSION_ID')
  const currentNamespace = isPlainObject(current.data[NAMESPACE_KEY]) ? current.data[NAMESPACE_KEY] as Record<string, unknown> : {}
  const nextNamespace = { ...cloneJson(currentNamespace), version: 1, runtimeSessionId }
  return persistSession({ ...current, data: { ...current.data, [NAMESPACE_KEY]: nextNamespace } })
}

/** A branch may keep blueprint/attachment metadata, but never the parent's native runtime session. */
export function clearAgentRuntimeReference(id: string): AgentSessionRecord {
  const current = sessionQuery(id, true)
  if (!current) throw new Error('Agent 会话不存在')
  const namespace = isPlainObject(current.data[NAMESPACE_KEY]) ? cloneJson(current.data[NAMESPACE_KEY]) as Record<string, unknown> : null
  if (!namespace || !Object.hasOwn(namespace, 'runtimeSessionId')) return getAgentSession(id)!.session
  delete namespace.runtimeSessionId
  return persistSession({ ...current, data: { ...current.data, [NAMESPACE_KEY]: namespace } })
}
export function branchAgentSession(input: { sessionId: string; title?: string }): AgentSessionRecord {
  const source = getAgentSession(input.sessionId)
  if (!source) throw new Error('Agent 会话不存在')
  const next = createAgentSession({ runtime: source.session.runtime, providerId: source.session.provider_id, model: source.session.model, title: input.title || source.session.title + '（分支）', parentId: source.session.id })
  clearAgentRuntimeReference(next.id)
  for (const event of source.events) appendAgentSessionEvent({ sessionId: next.id, type: event.type, data: cloneJson(event.data) })
  return getAgentSession(next.id)!.session
}
export function deleteAgentSession(id: string): boolean {
  const result = getDatabase().run('DELETE FROM agent_sessions WHERE id=?', [id])
  saveDatabase()
  return Number(result.changes || 0) > 0
}
