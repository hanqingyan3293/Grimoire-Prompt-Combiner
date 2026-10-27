import { getDatabase } from '../database'

/** ADAPTER + PARTIAL_EXTRACTION of Cherry Studio 2.1.4 (AGPL-3.0):
 * shared/data/api/schemas/agentSessionMessages.ts, shared/data/types/message.ts,
 * AgentSessionMessageService.listSessionMessages/getSessionMessage and
 * services/utils/keysetCursor.ts. Direct reuse requires Cherry's private
 * Drizzle/application/message store; this facade reads the SAME Grimoire DB.
 *
 * Intentional deviations: IDs are actual event IDs (not invented UUIDv7s);
 * authoritative ordering/cursor key is event sequence, NOT wall-clock time.
 * Codec remains <url-encoded-numeric-key>:<event-id>, descending on both keys.
 * Tools are assistant projections anchored at the real call event, with result
 * timestamps as updatedAt; they are NOT additional persisted text/messages.
 * deferToolOutputs=true still returns full inline outputs: no fake lazy-output
 * resolver or output reference is advertised. Explicit byte/event ceilings
 * refuse oversized history instead of truncating or reading unbounded output.
 * No session config/model/snapshot is inferred as message-owned metadata.
 * Permission history is unsupported until an unambiguous approval projection
 * exists. Entire history is validated before paging, never silently omitted.
 */
export type CherryAgentMessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'data-error'; data: { message: string } }
  | { type: 'dynamic-tool'; toolName: string; toolCallId: string; state: 'input-available'; input: unknown }
  | { type: 'dynamic-tool'; toolName: string; toolCallId: string; state: 'output-available'; input: unknown; output: unknown }
  | { type: 'dynamic-tool'; toolName: string; toolCallId: string; state: 'output-error'; input: unknown; errorText: string }

/** Source entity shape, restricted to the honestly supported parts/null fields.
 * Do not import its runtime schema here: that pulls in the source workspace
 * aliases, provider registry and AI SDK dependency closure into main's build.
 */
export interface CherryAgentMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  data: { parts: CherryAgentMessagePart[] }
  status: 'pending' | 'success' | 'error' | 'paused'
  searchableText: string
  modelId: null
  messageSnapshot: null
  stats: null
  runtimeResumeToken: null
  createdAt: string
  updatedAt: string
}
export interface CherryAgentMessageQuery { cursor?: string; messageId?: string; limit?: number; deferToolOutputs?: boolean }
export interface CherryAgentMessagePage { items: CherryAgentMessage[]; nextCursor?: string }
export class CherryAgentMessageError extends Error {
  constructor(readonly status: 400 | 404 | 409, readonly code: string) {
    super(`CHERRY_AGENT_MESSAGE_${code}`)
    this.name = 'CherryAgentMessageError'
  }
}
export const CHERRY_AGENT_MESSAGE_LIMITS = Object.freeze({ defaultPage: 50, maxPage: 200, maxEvents: 10000, maxHistoryBytes: 16 * 1024 * 1024, maxEventBytes: 1024 * 1024 })
function fail(status: 400 | 404 | 409, code: string): never { throw new CherryAgentMessageError(status, code) }
function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.length || value.length > 512 || /[\u0000-\u001f]/.test(value)) fail(400, 'INVALID_ID')
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function keys(data: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(data).some(key => !allowed.includes(key))) fail(409, 'UNSUPPORTED_EVENT_FIELDS')
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(409, 'UNSUPPORTED_TIMESTAMP')
  return value
}
type Projected = { sequence: number; message: CherryAgentMessage }
type TurnState = { attemptId: string; assistantMessageId: string; ordinal: number; terminal: boolean; projected: Projected }
function projectHistory(sessionId: string): Projected[] {
  id(sessionId)
  const db = getDatabase()
  if (!db.exec('SELECT 1 FROM agent_sessions WHERE id=?', [sessionId])[0]?.values.length) fail(404, 'SESSION_NOT_FOUND')
  const mapping = db.exec('SELECT type,deleted_at,workspace_id FROM agent_session_read_model WHERE id=?', [sessionId])[0]?.values[0]
  if (!mapping) fail(409, 'UNMAPPED_SESSION')
  if (mapping[1] !== null) fail(404, 'SESSION_NOT_FOUND')
  if (mapping[0] !== 'conversation' || !db.exec('SELECT 1 FROM agent_workspaces WHERE id=?', [mapping[2]])[0]?.values.length) fail(409, 'UNSUPPORTED_SESSION')
  const bounds = db.exec('SELECT count(*),coalesce(sum(length(cast(data_json AS blob))),0),coalesce(max(length(cast(data_json AS blob))),0) FROM agent_session_events WHERE session_id=?', [sessionId])[0].values[0]
  if (Number(bounds[0]) > CHERRY_AGENT_MESSAGE_LIMITS.maxEvents || Number(bounds[1]) > CHERRY_AGENT_MESSAGE_LIMITS.maxHistoryBytes || Number(bounds[2]) > CHERRY_AGENT_MESSAGE_LIMITS.maxEventBytes) fail(409, 'HISTORY_LIMIT_EXCEEDED')
  const rows = db.exec('SELECT id,sequence,type,data_json,created_at FROM agent_session_events WHERE session_id=? ORDER BY sequence ASC,id ASC', [sessionId])[0]?.values ?? []
  const messages: Projected[] = [], calls = new Map<string, { projected: Projected; resolved: boolean }>(), turns = new Map<string, TurnState>()
  for (const row of rows) {
    const eventId = row[0], sequence = row[1], type = row[2]
    if (typeof eventId !== 'string' || !eventId.length || !Number.isSafeInteger(sequence) || Number(sequence) < 0) fail(409, 'UNSUPPORTED_EVENT_IDENTITY')
    const createdAt = timestamp(row[4])
    let data: unknown
    try { data = JSON.parse(String(row[3])) } catch { fail(409, 'MALFORMED_EVENT') }
    if (!object(data)) fail(409, 'MALFORMED_EVENT')
    const make = (role: CherryAgentMessage['role'], part: CherryAgentMessagePart, status: CherryAgentMessage['status'], searchableText = ''): Projected => {
      const projected: Projected = { sequence: Number(sequence), message: { id: eventId, sessionId, role, data: { parts: [part] }, status, searchableText, modelId: null, messageSnapshot: null, stats: null, runtimeResumeToken: null, createdAt, updatedAt: createdAt } }
      messages.push(projected)
      return projected
    }
    switch (type) {
      case 'message': {
        if (Object.hasOwn(data, 'cherryTurn')) {
          keys(data, ['role', 'content', 'cherryTurn'])
          const turn = data.cherryTurn
          if (!object(turn) || turn.version !== 1 || turn.kind !== 'anchor' || typeof turn.attemptId !== 'string' || typeof turn.assistantMessageId !== 'string' || turn.assistantMessageId !== eventId || data.role !== 'assistant' || data.content !== '') fail(409, 'MALFORMED_TURN')
          keys(turn, ['version', 'kind', 'attemptId', 'assistantMessageId'])
          if (turns.has(turn.assistantMessageId)) fail(409, 'DUPLICATE_ANCHOR')
          const projected = make('assistant', { type: 'text', text: '' }, 'pending')
          projected.message.data.parts = []
          turns.set(turn.assistantMessageId, { attemptId: turn.attemptId, assistantMessageId: turn.assistantMessageId, ordinal: 0, terminal: false, projected })
          break
        }
        keys(data, ['role', 'content'])
        if (typeof data.role !== 'string' || !['user', 'assistant', 'system'].includes(data.role) || typeof data.content !== 'string') fail(409, 'UNSUPPORTED_MESSAGE')
        make(data.role as CherryAgentMessage['role'], { type: 'text', text: data.content }, 'success', data.content)
        break
      }
      case 'tool-call': {
        keys(data, ['callId', 'name', 'input', 'telemetry'])
        if (typeof data.callId !== 'string' || !data.callId.length || typeof data.name !== 'string' || !data.name.length || (data.telemetry !== undefined && typeof data.telemetry !== 'boolean')) fail(409, 'UNSUPPORTED_TOOL_CALL')
        // Missing native input is unknown, not an invented empty argument object.
        if (!Object.hasOwn(data, 'input')) fail(409, 'UNSUPPORTED_TOOL_INPUT')
        if (calls.has(data.callId)) fail(409, 'DUPLICATE_TOOL_CALL')
        calls.set(data.callId, { projected: make('assistant', { type: 'dynamic-tool', toolName: data.name, toolCallId: data.callId, state: 'input-available', input: data.input }, 'pending'), resolved: false })
        break
      }
      case 'tool-result': {
        keys(data, ['callId', 'name', 'output', 'error', 'telemetry', 'type', 'ownership'])
        if (typeof data.callId !== 'string' || (data.telemetry !== undefined && typeof data.telemetry !== 'boolean') || (data.type !== undefined && data.type !== 'tool-finished') || (data.ownership !== undefined && (typeof data.ownership !== 'string' || !['host', 'runtime'].includes(data.ownership)))) fail(409, 'UNSUPPORTED_TOOL_RESULT')
        const call = calls.get(data.callId)
        if (!call) fail(409, 'ORPHAN_TOOL_RESULT')
        if (call.resolved) fail(409, 'DUPLICATE_TOOL_RESULT')
        const part = call.projected.message.data.parts[0]
        if (part.type !== 'dynamic-tool' || (data.name !== undefined && data.name !== part.toolName)) fail(409, 'UNSUPPORTED_TOOL_RESULT')
        const hasOutput = Object.hasOwn(data, 'output'), hasError = Object.hasOwn(data, 'error')
        if (hasError ? typeof data.error !== 'string' || hasOutput : !hasOutput) fail(409, 'UNSUPPORTED_TOOL_RESULT')
        call.projected.message.data.parts = [hasError
          ? { type: 'dynamic-tool', toolName: part.toolName, toolCallId: part.toolCallId, input: part.input, state: 'output-error', errorText: data.error as string }
          : { type: 'dynamic-tool', toolName: part.toolName, toolCallId: part.toolCallId, input: part.input, state: 'output-available', output: data.output }]
        call.projected.message.status = hasError ? 'error' : 'success'
        call.projected.message.updatedAt = createdAt
        call.resolved = true
        break
      }
      case 'error':
        keys(data, ['message'])
        if (typeof data.message !== 'string') fail(409, 'UNSUPPORTED_ERROR')
        make('assistant', { type: 'data-error', data: { message: data.message } }, 'error', data.message)
        break
      case 'status':
        if (Object.hasOwn(data, 'cherryTurn')) {
          keys(data, ['cherryTurn'])
          const turn = data.cherryTurn
          const ordinal = object(turn) ? turn.ordinal : undefined
          if (!object(turn) || turn.version !== 1 || typeof turn.kind !== 'string' || typeof turn.attemptId !== 'string' || typeof turn.assistantMessageId !== 'string' || typeof ordinal !== 'number' || !Number.isSafeInteger(ordinal) || ordinal < 1) fail(409, 'MALFORMED_TURN')
          const state = turns.get(turn.assistantMessageId)
          if (!state || state.attemptId !== turn.attemptId || state.terminal || ordinal !== state.ordinal + 1) fail(409, 'INVALID_TURN_ORDER')
          const message = state.projected.message
          if (turn.kind === 'text-delta' || turn.kind === 'reasoning-delta') {
            keys(turn, ['version', 'kind', 'attemptId', 'assistantMessageId', 'ordinal', 'text'])
            if (typeof turn.text !== 'string' || !turn.text.length) fail(409, 'INVALID_TURN_DELTA')
            const last = message.data.parts.at(-1)
            if ((last?.type === 'text' || last?.type === 'reasoning') && last.type === turn.kind.replace('-delta', '')) last.text += turn.text
            else message.data.parts.push(turn.kind === 'text-delta' ? { type: 'text', text: turn.text } : { type: 'reasoning', text: turn.text })
          } else if (turn.kind === 'status') {
            keys(turn, ['version', 'kind', 'attemptId', 'assistantMessageId', 'ordinal', 'status'])
            if (turn.status !== 'pending' && turn.status !== 'streaming') fail(409, 'UNSUPPORTED_TURN_STATUS')
          } else if (turn.kind === 'terminal') {
            keys(turn, turn.outcome === 'error' ? ['version', 'kind', 'attemptId', 'assistantMessageId', 'ordinal', 'outcome', 'error'] : ['version', 'kind', 'attemptId', 'assistantMessageId', 'ordinal', 'outcome'])
            if (turn.outcome !== 'success' && turn.outcome !== 'error' && turn.outcome !== 'paused') fail(409, 'UNSUPPORTED_TURN_OUTCOME')
            if (turn.outcome === 'error') {
              if (typeof turn.error !== 'string') fail(409, 'UNSUPPORTED_TURN_ERROR')
              message.data.parts.push({ type: 'data-error', data: { message: turn.error } })
            } else if (Object.hasOwn(turn, 'error')) fail(409, 'UNSUPPORTED_TURN_ERROR')
            message.status = turn.outcome === 'success' ? 'success' : turn.outcome
            state.terminal = true
          } else fail(409, 'UNSUPPORTED_TURN_UPDATE')
          state.ordinal = ordinal
          message.updatedAt = createdAt
          break
        }
        // Only the known content-free idle marker is safe to omit. Progress may
        // contain partial output/errors; refuse it rather than lose that content.
        if (Object.keys(data).length !== 1 || data.status !== 'idle') fail(409, 'UNSUPPORTED_STATUS')
        break
      case 'permission': fail(409, 'UNSUPPORTED_PERMISSION_HISTORY')
      default: fail(409, 'UNSUPPORTED_EVENT_TYPE')
    }
  }
  return messages.reverse() // sequence DESC, id DESC: same order as cursor predicate.
}
function older(a: Projected, sequence: number, eventId: string, inclusive = false): boolean {
  return a.sequence < sequence || (a.sequence === sequence && (a.message.id < eventId || (inclusive && a.message.id === eventId)))
}
export function listCherryAgentMessages(sessionId: string, query: CherryAgentMessageQuery = {}): CherryAgentMessagePage {
  if (!object(query)) fail(400, 'INVALID_QUERY')
  if (Object.keys(query).some(key => !['cursor', 'messageId', 'limit', 'deferToolOutputs'].includes(key))) fail(400, 'INVALID_QUERY')
  const limit = query.limit === undefined ? CHERRY_AGENT_MESSAGE_LIMITS.defaultPage : query.limit
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > CHERRY_AGENT_MESSAGE_LIMITS.maxPage || (query.deferToolOutputs !== undefined && typeof query.deferToolOutputs !== 'boolean')) fail(400, 'INVALID_QUERY')
  if (query.messageId !== undefined) id(query.messageId)
  if (query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length > 1024)) fail(400, 'INVALID_CURSOR')
  let history = projectHistory(sessionId)
  if (query.cursor) {
    // Source malformed-list-cursor policy: newest-page fallback. Well-formed
    // tuples must match a projected event in THIS session (no cross-session use).
    const sep = query.cursor.indexOf(':')
    let key = ''
    try { key = decodeURIComponent(query.cursor.slice(0, sep)) } catch { /* malformed -> newest */ }
    const sequence = Number(key), eventId = query.cursor.slice(sep + 1)
    if (sep > 0 && key !== '' && Number.isSafeInteger(sequence) && sequence >= 0 && eventId) {
      if (!history.some(item => item.sequence === sequence && item.message.id === eventId)) fail(400, 'INVALID_CURSOR')
      history = history.filter(item => older(item, sequence, eventId))
    }
  } else if (query.messageId) {
    const anchor = history.find(item => item.message.id === query.messageId)
    if (anchor) history = history.filter(item => older(item, anchor.sequence, anchor.message.id, true))
  }
  const page = history.slice(0, limit), tail = page.at(-1)
  return { items: page.map(item => item.message), ...(history.length > limit && tail ? { nextCursor: `${encodeURIComponent(String(tail.sequence))}:${tail.message.id}` } : {}) }
}
export function getCherryAgentMessage(sessionId: string, messageId: string): CherryAgentMessage {
  id(messageId)
  return projectHistory(sessionId).find(item => item.message.id === messageId)?.message ?? fail(404, 'MESSAGE_NOT_FOUND')
}
