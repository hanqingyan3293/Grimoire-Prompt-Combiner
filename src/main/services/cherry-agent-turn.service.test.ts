import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: (name: string) => name === 'exe' ? path.join(root, 'Grimoire.exe') : path.join(root, 'profile') } }))
import { closeDatabase, getDatabase, initDatabase } from '../database'
import { createAgentBlueprint } from './agent-blueprint.service'
import { createAgentSessionReadModel } from './agent-session-read-model.service'
import { appendAgentSessionEvent } from './agent-session.service'
import { CherryAgentTurnError, appendCherryAgentTurn, finalizeCherryAgentTurn, getCherryAgentTurn, reserveCherryAgentTurn } from './cherry-agent-turn.service'
import { listCherryAgentMessages } from './cherry-agent-message.service'

beforeEach(async () => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-agent-turn-')); fs.mkdirSync(path.join(root, 'profile')); await initDatabase() })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })
function session() { return createAgentSessionReadModel({ agentId: createAgentBlueprint({ name: 'Agent', type: null, runtime: 'pi', model: 'provider::model' }).id, name: '', workspace: { type: 'system' } }).id }
function expectCode(work: () => unknown, code: string): void { try { work(); throw new Error('expected refusal') } catch (error) { expect(error).toBeInstanceOf(CherryAgentTurnError); expect(error).toMatchObject({ code }) } }
function count(s: string) { return Number(getDatabase().exec('SELECT count(*) FROM agent_session_events WHERE session_id=?', [s])[0].values[0][0]) }

describe('Cherry Agent turn persistence reservation', () => {
  it('reserves terminal budget when the event ceiling rejects further output', () => {
    const s = session(), now = new Date().toISOString()
    getDatabase().run("WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<9996) INSERT INTO agent_session_events (id,session_id,sequence,type,data_json,created_at) SELECT 'budget_'||i,?,i,'status','{\"status\":\"idle\"}',? FROM n", [s, now])
    const r = reserveCherryAgentTurn({ sessionId: s, content: 'budget boundary' })
    expectCode(() => appendCherryAgentTurn({ ...r, expectedOrdinal: 1, update: { kind: 'text-delta', text: 'cannot consume terminal row' } }), 'HISTORY_LIMIT_EXCEEDED')
    finalizeCherryAgentTurn({ ...r, expectedOrdinal: 1, outcome: 'error', error: 'output limit reached' })
    expect(getCherryAgentTurn(r).status).toBe('error')
    expect(count(s)).toBe(10000)
  })
  it('keeps terminal error capacity at the history byte ceiling', () => {
    const s = session(), r = reserveCherryAgentTurn({ sessionId: s, content: 'byte ceiling' }), db = getDatabase(), now = new Date().toISOString()
    const insert = (index: number, text: string) => db.run('INSERT INTO agent_session_events (id,session_id,sequence,type,data_json,created_at) VALUES (?,?,?,?,?,?)', ['byte_'+index, s, index+2, 'message', JSON.stringify({ role: 'user', content: text }), now])
    for (let i = 0; i < 16; i++) insert(i, 'x'.repeat(1_000_000))
    const used = Number(db.exec('SELECT sum(length(cast(data_json AS blob))) FROM agent_session_events WHERE session_id=?', [s])[0].values[0][0])
    const envelope = Buffer.byteLength(JSON.stringify({ role: 'user', content: '' }))
    insert(16, 'x'.repeat(16*1024*1024 - used - envelope - 8192 - 100))
    expectCode(() => appendCherryAgentTurn({ ...r, expectedOrdinal: 1, update: { kind: 'text-delta', text: 'x'.repeat(20_000) } }), 'HISTORY_LIMIT_EXCEEDED')
    expectCode(() => finalizeCherryAgentTurn({ ...r, expectedOrdinal: 1, outcome: 'error', error: 'x'.repeat(1025) }), 'INVALID_TERMINAL_ERROR')
    finalizeCherryAgentTurn({ ...r, expectedOrdinal: 1, outcome: 'error', error: '界'.repeat(1024) })
    expect(getCherryAgentTurn(r).status).toBe('error')
  })
  it('requires the exact persisted attempt even after terminal settlement', () => {
    const s = session(), r = reserveCherryAgentTurn({ sessionId: s, content: 'identity' })
    finalizeCherryAgentTurn({ ...r, expectedOrdinal: 1, outcome: 'success' })
    expectCode(() => getCherryAgentTurn({ ...r, attemptId: 'wrong-attempt' }), 'ATTEMPT_MISMATCH')
  })
  it('atomically reserves exact user content and one real pending assistant anchor', () => {
    const s = session(), reservation = reserveCherryAgentTurn({ sessionId: s, content: '  preserve\n\t' })
    expect(reservation).toMatchObject({ version: 1, sessionId: s, nextOrdinal: 1 })
    expect(reservation.userMessageId).not.toBe(reservation.assistantMessageId)
    const page = listCherryAgentMessages(s)
    expect(page.items.map(m => [m.id, m.role, m.status])).toEqual([[reservation.assistantMessageId, 'assistant', 'pending'], [reservation.userMessageId, 'user', 'success']])
    expect(page.items[1].data.parts).toEqual([{ type: 'text', text: '  preserve\n\t' }])
    expect(page.items[0].data.parts).toEqual([])
  })
  it('folds ordered text/reasoning segments in place, preserving transitions and partial failure', () => {
    const s = session(), r = reserveCherryAgentTurn({ sessionId: s, content: 'question' })
    let next = appendCherryAgentTurn({ ...r, expectedOrdinal: 1, update: { kind: 'text-delta', text: 'one' } }).nextOrdinal
    next = appendCherryAgentTurn({ ...r, expectedOrdinal: next, update: { kind: 'text-delta', text: ' two' } }).nextOrdinal
    next = appendCherryAgentTurn({ ...r, expectedOrdinal: next, update: { kind: 'reasoning-delta', text: 'think' } }).nextOrdinal
    next = appendCherryAgentTurn({ ...r, expectedOrdinal: next, update: { kind: 'text-delta', text: ' answer' } }).nextOrdinal
    finalizeCherryAgentTurn({ ...r, expectedOrdinal: next, outcome: 'error', error: 'provider failed' })
    const assistant = getCherryAgentTurn(r)
    expect(assistant.id).toBe(r.assistantMessageId)
    expect(assistant.status).toBe('error')
    expect(assistant.data.parts).toEqual([
      { type: 'text', text: 'one two' },
      { type: 'reasoning', text: 'think' },
      { type: 'text', text: ' answer' },
      { type: 'data-error', data: { message: 'provider failed' } }
    ])
    expect(assistant.updatedAt).not.toBe(assistant.createdAt)
  })
  it('persists paused as terminal cancellation and leaves partial parts after restart-like reread', () => {
    const s = session(), r = reserveCherryAgentTurn({ sessionId: s, content: 'cancel me' })
    appendCherryAgentTurn({ ...r, expectedOrdinal: 1, update: { kind: 'reasoning-delta', text: 'partial' } })
    finalizeCherryAgentTurn({ ...r, expectedOrdinal: 2, outcome: 'paused' })
    expect(getCherryAgentTurn(r)).toMatchObject({ id: r.assistantMessageId, status: 'paused', data: { parts: [{ type: 'reasoning', text: 'partial' }] } })
    expectCode(() => appendCherryAgentTurn({ ...r, expectedOrdinal: 3, update: { kind: 'text-delta', text: 'late' } }), 'ATTEMPT_MISMATCH')
  })
  it('blocks another reservation while pending, but allows a new reservation after terminal completion', () => {
    const s = session(), r = reserveCherryAgentTurn({ sessionId: s, content: 'first' })
    expectCode(() => reserveCherryAgentTurn({ sessionId: s, content: 'second' }), 'TURN_ALREADY_PENDING')
    finalizeCherryAgentTurn({ ...r, expectedOrdinal: 1, outcome: 'success' })
    const next = reserveCherryAgentTurn({ sessionId: s, content: 'second' })
    expect(next.assistantMessageId).not.toBe(r.assistantMessageId)
    expect(count(s)).toBe(5)
  })
  it('rejects cross-session and mismatched attempts without adding events', () => {
    const a = session(), b = session(), r = reserveCherryAgentTurn({ sessionId: a, content: 'a' }), before = count(a)
    expectCode(() => appendCherryAgentTurn({ ...r, sessionId: b, expectedOrdinal: 1, update: { kind: 'text-delta', text: 'wrong' } }), 'ATTEMPT_MISMATCH')
    expectCode(() => appendCherryAgentTurn({ ...r, attemptId: 'other', expectedOrdinal: 1, update: { kind: 'text-delta', text: 'wrong' } }), 'ATTEMPT_MISMATCH')
    expect(count(a)).toBe(before); expect(count(b)).toBe(0)
    expectCode(() => getCherryAgentTurn({ ...r, sessionId: b }), 'MESSAGE_NOT_FOUND')
  })
  it('rolls back invalid append/finalize and never creates duplicate terminal rows', () => {
    const s = session(), r = reserveCherryAgentTurn({ sessionId: s, content: 'x' }), before = count(s)
    expectCode(() => appendCherryAgentTurn({ ...r, expectedOrdinal: 2, update: { kind: 'text-delta', text: 'out of order' } }), 'INVALID_TURN_ORDER')
    expect(count(s)).toBe(before)
    finalizeCherryAgentTurn({ ...r, expectedOrdinal: 1, outcome: 'success' }); const terminalCount = count(s)
    expectCode(() => finalizeCherryAgentTurn({ ...r, expectedOrdinal: 2, outcome: 'success' }), 'ATTEMPT_MISMATCH')
    expect(count(s)).toBe(terminalCount)
  })
  it('refuses existing unsupported permission history before reservation', () => {
    const s = session(); appendAgentSessionEvent({ sessionId: s, type: 'permission', data: { permission: 'read', status: 'approved', detail: { secret: 'must not project' } } })
    expectCode(() => reserveCherryAgentTurn({ sessionId: s, content: 'do not guess' }), 'UNSUPPORTED_EXISTING_HISTORY')
    expect(count(s)).toBe(1)
  })
  it('refuses secret-like arbitrary turn fields and preserves source role/status compatibility', () => {
    const s = session(); appendAgentSessionEvent({ sessionId: s, type: 'message', data: { role: 'system', content: 'system instruction' } })
    const r = reserveCherryAgentTurn({ sessionId: s, content: 'user' })
    const row = getDatabase().exec('SELECT sequence FROM agent_session_events WHERE id=?', [r.assistantMessageId])[0].values[0][0]
    getDatabase().run('UPDATE agent_session_events SET data_json=? WHERE id=?', [JSON.stringify({ cherryTurn: { version: 1, kind: 'text-delta', attemptId: r.attemptId, assistantMessageId: r.assistantMessageId, ordinal: 1, text: 'x', apiKey: 'secret' } }), r.assistantMessageId])
    expect(row).toBe(2)
    expectCode(() => appendCherryAgentTurn({ ...r, expectedOrdinal: 1, update: { kind: 'text-delta', text: 'safe' } }), 'UNSUPPORTED_EXISTING_HISTORY')
  })
})
