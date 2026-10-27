import crypto from 'node:crypto'

import { getDatabase, saveDatabase } from '../database'
import type { CherryAgentMessage } from './cherry-agent-message.service'
import { CHERRY_AGENT_MESSAGE_LIMITS, CherryAgentMessageError, getCherryAgentMessage } from './cherry-agent-message.service'

/**
 * ADAPTER of Cherry Studio's AgentChatContextProvider.persistDispatchTx onto
 * Grimoire's existing agent_session_events table. This reserves persistence;
 * it does not launch a runtime, open a stream, or claim resumable execution.
 *
 * The assistant anchor and all turn updates are ordinary event rows. Turn
 * updates are strict, versioned, secret-free envelopes; arbitrary runtime
 * payloads/configuration are refused rather than cloned into history.
 */
export type CherryTurnAttempt = { readonly version: 1; readonly attemptId: string; readonly assistantMessageId: string }
export type CherryTurnReservation = CherryTurnAttempt & { readonly sessionId: string; readonly userMessageId: string; readonly nextOrdinal: number }
export type CherryTurnUpdate =
  | { readonly kind: 'text-delta'; readonly text: string }
  | { readonly kind: 'reasoning-delta'; readonly text: string }
  | { readonly kind: 'status'; readonly status: 'pending' | 'streaming' }
export type CherryTurnOutcome = 'success' | 'error' | 'paused'
export type CherryTurnAppendInput = CherryTurnAttempt & { readonly sessionId: string; readonly expectedOrdinal: number; readonly update: CherryTurnUpdate }
export type CherryTurnFinalizeInput = CherryTurnAttempt & { readonly sessionId: string; readonly expectedOrdinal: number; readonly outcome: CherryTurnOutcome; readonly error?: string }
const MAX_TURN_PARTS = 2048
export class CherryAgentTurnError extends Error {
  constructor(readonly status: 400 | 404 | 409, readonly code: string) { super(`CHERRY_AGENT_TURN_${code}`); this.name = 'CherryAgentTurnError' }
}
const MAX_TEXT = 512 * 1024
function fail(status: 400 | 404 | 409, code: string): never { throw new CherryAgentTurnError(status, code) }
function id(value: unknown, code = 'INVALID_ID'): asserts value is string { if (typeof value !== 'string' || !value || value.length > 256 || /[\u0000-\u001f]/.test(value)) fail(400, code) }
function text(value: unknown): asserts value is string { if (typeof value !== 'string' || value.length > MAX_TEXT) fail(400, 'INVALID_TEXT') }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function tx<T>(work: () => T): T { const db = getDatabase(); db.exec('BEGIN IMMEDIATE'); try { const result = work(); db.exec('COMMIT'); saveDatabase(); return result } catch (error) { try { db.exec('ROLLBACK') } catch {} throw error } }
function sessionIsWritable(sessionId: string): void {
  id(sessionId, 'INVALID_SESSION_ID')
  const db = getDatabase()
  if (!db.exec('SELECT 1 FROM agent_sessions WHERE id=?', [sessionId])[0]?.values.length) fail(404, 'SESSION_NOT_FOUND')
  const row = db.exec('SELECT type,deleted_at,workspace_id FROM agent_session_read_model WHERE id=?', [sessionId])[0]?.values[0]
  if (!row) fail(409, 'UNMAPPED_SESSION')
  if (row[1] !== null) fail(404, 'SESSION_NOT_FOUND')
  if (row[0] !== 'conversation' || !db.exec('SELECT 1 FROM agent_workspaces WHERE id=?', [row[2]])[0]?.values.length) fail(409, 'UNSUPPORTED_SESSION')
}
function nextSequence(sessionId: string): number { const row = getDatabase().exec('SELECT coalesce(max(sequence),-1)+1 FROM agent_session_events WHERE session_id=?', [sessionId])[0].values[0][0]; if (!Number.isSafeInteger(Number(row))) fail(409, 'SEQUENCE_EXHAUSTED'); return Number(row) }
function insert(sessionId: string, type: string, data: Record<string, unknown>, eventId = crypto.randomUUID()): string { const sequence = nextSequence(sessionId); const createdAt = new Date().toISOString(); getDatabase().run('INSERT INTO agent_session_events (id,session_id,sequence,type,data_json,created_at) VALUES (?,?,?,?,?,?)', [eventId, sessionId, sequence, type, JSON.stringify(data), createdAt]); return eventId }
function rows(sessionId: string): Array<{ id: string; type: string; data: unknown; createdAt: string }> {
  return (getDatabase().exec('SELECT id,type,data_json,created_at FROM agent_session_events WHERE session_id=? ORDER BY sequence ASC,id ASC', [sessionId])[0]?.values ?? []).map(row => { let data: unknown; try { data = JSON.parse(String(row[2])) } catch { fail(409, 'MALFORMED_HISTORY') }; return { id: String(row[0]), type: String(row[1]), data, createdAt: String(row[3]) } })
}
function anchorData(_sessionId: string, attempt: CherryTurnAttempt): Record<string, unknown> { return { role: 'assistant', content: '', cherryTurn: { version: 1, kind: 'anchor', attemptId: attempt.attemptId, assistantMessageId: attempt.assistantMessageId } } }
function assertNoUnsupportedHistory(sessionId: string): void {
  // Reuse the authoritative strict source projection: a reservation must not
  // guess around malformed/unsupported pre-existing events.
  try { getCherryAgentMessage(sessionId, '__missing__') } catch (error) { if (error instanceof Error && error.name === 'CherryAgentMessageError' && (error as CherryAgentTurnError).code !== 'MESSAGE_NOT_FOUND') throw new CherryAgentTurnError(409, 'UNSUPPORTED_EXISTING_HISTORY') }
}
function activeTurn(sessionId: string): { attemptId: string; assistantMessageId: string; ordinal: number; terminal: boolean } | null {
  const turns = new Map<string, { attemptId: string; assistantMessageId: string; ordinal: number; terminal: boolean }>()
  for (const row of rows(sessionId)) {
    if (!object(row.data)) continue
    if (row.type === 'message' && object(row.data.cherryTurn)) {
      const c = row.data.cherryTurn
      if (c.version !== 1 || c.kind !== 'anchor' || typeof c.attemptId !== 'string' || typeof c.assistantMessageId !== 'string') fail(409, 'MALFORMED_TURN')
      if (turns.has(c.assistantMessageId)) fail(409, 'DUPLICATE_ANCHOR')
      turns.set(c.assistantMessageId, { attemptId: c.attemptId, assistantMessageId: c.assistantMessageId, ordinal: 0, terminal: false })
    } else if (row.type === 'status' && object(row.data.cherryTurn)) {
      const c = row.data.cherryTurn
      const ordinal = c.ordinal
      if (c.version !== 1 || typeof c.attemptId !== 'string' || typeof c.assistantMessageId !== 'string' || typeof ordinal !== 'number' || !Number.isSafeInteger(ordinal) || ordinal < 1) fail(409, 'MALFORMED_TURN')
      const turn = turns.get(c.assistantMessageId)
      if (!turn || turn.attemptId !== c.attemptId || turn.terminal || ordinal !== turn.ordinal + 1) fail(409, 'INVALID_TURN_ORDER')
      turn.ordinal = ordinal
      if (c.kind === 'terminal') turn.terminal = true
      else if (!['text-delta', 'reasoning-delta', 'status'].includes(String(c.kind))) fail(409, 'UNSUPPORTED_TURN_UPDATE')
    }
  }
  const open = [...turns.values()].filter(turn => !turn.terminal)
  if (open.length > 1) fail(409, 'MULTIPLE_PENDING_TURNS')
  return open[0] ?? null
}
function boundedBeforeInsert(sessionId: string, data: Record<string, unknown>): void {
  const terminal = object(data.cherryTurn) && data.cherryTurn.kind === 'terminal'
  // Reserve one terminal row, one error part and sufficient bytes while accepting
  // nonterminal writes. Exhausting output must never strand a pending assistant.
  const reserveRows = terminal ? 0 : 1, reserveBytes = terminal ? 0 : 8192, reserveParts = terminal ? 0 : 1
  const db = getDatabase(), count = Number(db.exec('SELECT count(*) FROM agent_session_events WHERE session_id=?', [sessionId])[0].values[0][0]), bytes = Number(db.exec('SELECT coalesce(sum(length(cast(data_json AS blob))),0) FROM agent_session_events WHERE session_id=?', [sessionId])[0].values[0][0])
  const added = Buffer.byteLength(JSON.stringify(data), 'utf8')
  if (count + 1 + reserveRows > CHERRY_AGENT_MESSAGE_LIMITS.maxEvents || bytes + added + reserveBytes > CHERRY_AGENT_MESSAGE_LIMITS.maxHistoryBytes || added > CHERRY_AGENT_MESSAGE_LIMITS.maxEventBytes) fail(409, 'HISTORY_LIMIT_EXCEEDED')
  // Bound the reduced assistant projection as well as raw event storage. This
  // prevents many tiny deltas from creating an unbounded parts array and makes
  // the next immediate read valid under the same history budget.
  let parts = 0, cumulativeTextBytes = 0
  for (const row of db.exec("SELECT data_json FROM agent_session_events WHERE session_id=? AND type='status'", [sessionId])[0]?.values ?? []) {
    try {
      const event = JSON.parse(String(row[0])) as Record<string, unknown>, turn = event.cherryTurn
      if (!object(turn)) continue
      if (turn.kind === 'text-delta' || turn.kind === 'reasoning-delta') { parts += 1; if (typeof turn.text === 'string') cumulativeTextBytes += Buffer.byteLength(turn.text, 'utf8') }
      if (turn.kind === 'terminal' && typeof turn.error === 'string') { parts += 1; cumulativeTextBytes += Buffer.byteLength(turn.error, 'utf8') }
    } catch { fail(409, 'MALFORMED_HISTORY') }
  }
  const next = data.cherryTurn
  if (object(next) && (next.kind === 'text-delta' || next.kind === 'reasoning-delta')) { parts += 1; if (typeof next.text === 'string') cumulativeTextBytes += Buffer.byteLength(next.text, 'utf8') }
  if (object(next) && next.kind === 'terminal' && typeof next.error === 'string') { parts += 1; cumulativeTextBytes += Buffer.byteLength(next.error, 'utf8') }
  if (parts + reserveParts > MAX_TURN_PARTS || cumulativeTextBytes + reserveBytes > CHERRY_AGENT_MESSAGE_LIMITS.maxHistoryBytes) fail(409, 'HISTORY_LIMIT_EXCEEDED')
}
function attempt(input: CherryTurnAttempt): void { if (!object(input) || input.version !== 1) fail(400, 'INVALID_ATTEMPT'); id(input.attemptId, 'INVALID_ATTEMPT_ID'); id(input.assistantMessageId, 'INVALID_ASSISTANT_ID') }
function verifyOwned(sessionId: string, input: CherryTurnAttempt): { ordinal: number; terminal: boolean } {
  attempt(input); const current = activeTurn(sessionId); if (!current || current.attemptId !== input.attemptId || current.assistantMessageId !== input.assistantMessageId) fail(409, 'ATTEMPT_MISMATCH'); return { ordinal: current.ordinal, terminal: current.terminal }
}
export function reserveCherryAgentTurn(input: { sessionId: string; content: string }): CherryTurnReservation {
  if (!object(input)) fail(400, 'INVALID_INPUT'); id(input.sessionId, 'INVALID_SESSION_ID'); text(input.content); return tx(() => {
    sessionIsWritable(input.sessionId); assertNoUnsupportedHistory(input.sessionId); if (activeTurn(input.sessionId)) fail(409, 'TURN_ALREADY_PENDING')
    const attemptId = crypto.randomUUID(), userMessageId = crypto.randomUUID(), assistantMessageId = crypto.randomUUID()
    const userData = { role: 'user', content: input.content }
    boundedBeforeInsert(input.sessionId, userData); insert(input.sessionId, 'message', userData, userMessageId)
    const assistantData = anchorData(input.sessionId, { version: 1, attemptId, assistantMessageId })
    boundedBeforeInsert(input.sessionId, assistantData); insert(input.sessionId, 'message', assistantData, assistantMessageId)
    return { version: 1, sessionId: input.sessionId, attemptId, userMessageId, assistantMessageId, nextOrdinal: 1 }
  })
}
export function appendCherryAgentTurn(input: CherryTurnAppendInput): { nextOrdinal: number } {
  if (!object(input) || !object(input.update)) fail(400, 'INVALID_INPUT'); id(input.sessionId, 'INVALID_SESSION_ID'); if (!Number.isSafeInteger(input.expectedOrdinal) || input.expectedOrdinal < 1) fail(400, 'INVALID_ORDINAL'); return tx(() => {
    sessionIsWritable(input.sessionId); assertNoUnsupportedHistory(input.sessionId); const state = verifyOwned(input.sessionId, input); if (state.terminal || state.ordinal !== input.expectedOrdinal - 1) fail(409, 'INVALID_TURN_ORDER'); const u = input.update; let data: Record<string, unknown>
    if (u.kind === 'text-delta' || u.kind === 'reasoning-delta') { text(u.text); if (!u.text.length) fail(400, 'EMPTY_DELTA'); data = { cherryTurn: { version: 1, kind: u.kind, attemptId: input.attemptId, assistantMessageId: input.assistantMessageId, ordinal: input.expectedOrdinal, text: u.text } } }
    else if (u.kind === 'status' && (u.status === 'pending' || u.status === 'streaming')) data = { cherryTurn: { version: 1, kind: 'status', attemptId: input.attemptId, assistantMessageId: input.assistantMessageId, ordinal: input.expectedOrdinal, status: u.status } }
    else fail(400, 'UNSUPPORTED_TURN_UPDATE')
    boundedBeforeInsert(input.sessionId, data); insert(input.sessionId, 'status', data); return { nextOrdinal: input.expectedOrdinal + 1 }
  })
}
export function finalizeCherryAgentTurn(input: CherryTurnFinalizeInput): { nextOrdinal: number } {
  if (!object(input) || !['success', 'error', 'paused'].includes(input.outcome)) fail(400, 'INVALID_OUTCOME'); id(input.sessionId, 'INVALID_SESSION_ID'); if (!Number.isSafeInteger(input.expectedOrdinal) || input.expectedOrdinal < 1) fail(400, 'INVALID_ORDINAL'); if (input.error !== undefined) { text(input.error); if (input.error.length > 1024) fail(400, 'INVALID_TERMINAL_ERROR') }; return tx(() => {
    sessionIsWritable(input.sessionId); assertNoUnsupportedHistory(input.sessionId); const state = verifyOwned(input.sessionId, input); if (state.terminal || state.ordinal !== input.expectedOrdinal - 1) fail(409, 'INVALID_TURN_ORDER'); if (input.outcome === 'error' && input.error === undefined) fail(400, 'ERROR_TEXT_REQUIRED'); if (input.outcome !== 'error' && input.error !== undefined) fail(400, 'UNEXPECTED_ERROR_TEXT')
    const data: Record<string, unknown> = { cherryTurn: { version: 1, kind: 'terminal', attemptId: input.attemptId, assistantMessageId: input.assistantMessageId, ordinal: input.expectedOrdinal, outcome: input.outcome, ...(input.error === undefined ? {} : { error: input.error }) } }; boundedBeforeInsert(input.sessionId, data); insert(input.sessionId, 'status', data); return { nextOrdinal: input.expectedOrdinal + 1 }
  })
}
export function getCherryAgentTurn(input: CherryTurnAttempt & { sessionId: string }): CherryAgentMessage {
  id(input.sessionId, 'INVALID_SESSION_ID'); attempt(input)
  const row = getDatabase().exec("SELECT data_json FROM agent_session_events WHERE session_id=? AND id=? AND type='message'", [input.sessionId, input.assistantMessageId])[0]?.values[0]
  if (!row) fail(404, 'MESSAGE_NOT_FOUND')
  let anchor: unknown
  try { anchor = JSON.parse(String(row[0])) } catch { fail(409, 'MALFORMED_HISTORY') }
  const turn = object(anchor) ? anchor.cherryTurn : undefined
  if (!object(turn) || turn.version !== 1 || turn.kind !== 'anchor' || turn.attemptId !== input.attemptId || turn.assistantMessageId !== input.assistantMessageId) fail(409, 'ATTEMPT_MISMATCH')
  try {
    const message = getCherryAgentMessage(input.sessionId, input.assistantMessageId)
    if (message.role !== 'assistant') fail(409, 'INVALID_ASSISTANT_ANCHOR')
    return message
  } catch (error) {
    if (error instanceof CherryAgentMessageError) fail(error.status, error.code)
    throw error
  }
}
