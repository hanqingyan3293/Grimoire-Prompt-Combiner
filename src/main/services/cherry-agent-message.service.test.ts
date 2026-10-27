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
import { CHERRY_AGENT_MESSAGE_LIMITS, CherryAgentMessageError, getCherryAgentMessage, listCherryAgentMessages } from './cherry-agent-message.service'

const date = '2026-10-12T00:00:00.000Z', later = '2026-10-12T00:00:01.000Z'
beforeEach(async () => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-agent-messages-')); fs.mkdirSync(path.join(root, 'profile')); await initDatabase() })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })
function session() { return createAgentSessionReadModel({ agentId: createAgentBlueprint({ name: 'Agent', type: null, runtime: 'pi', model: 'provider::model' }).id, name: '', workspace: { type: 'system' } }).id }
function event(sessionId: string, eventId: string, sequence: number, type: string, data: unknown, at = date) {
  getDatabase().run('INSERT INTO agent_session_events (id,session_id,sequence,type,data_json,created_at) VALUES (?,?,?,?,?,?)', [eventId, sessionId, sequence, type, JSON.stringify(data), at])
}
function error(work: () => unknown, status: number, code: string) {
  try { work(); throw new Error('expected refusal') } catch (error) { expect(error).toBeInstanceOf(CherryAgentMessageError); expect(error).toMatchObject({ status, code }) }
}

describe('Cherry read-only Agent message event facade', () => {
  it('returns genuinely empty mapped history and ignores only content-free idle; never writes', () => {
    const s = session(); event(s, 'idle', 0, 'status', { status: 'idle' })
    const before = getDatabase().exec('SELECT * FROM agent_session_events')[0].values
    expect(listCherryAgentMessages(s)).toEqual({ items: [] })
    expect(getDatabase().exec('SELECT * FROM agent_session_events')[0].values).toEqual(before)
    error(() => getCherryAgentMessage(s, 'idle'), 404, 'MESSAGE_NOT_FOUND')
  })
  it('distinguishes unknown, existing unmapped, archived and non-conversation sessions', () => {
    error(() => listCherryAgentMessages('unknown'), 404, 'SESSION_NOT_FOUND')
    getDatabase().run('INSERT INTO agent_sessions (id,runtime,title,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?)', ['legacy', 'pi', '', '{}', date, date])
    error(() => listCherryAgentMessages('legacy'), 409, 'UNMAPPED_SESSION')
    const s = session(); getDatabase().run('UPDATE agent_session_read_model SET deleted_at=? WHERE id=?', [date, s])
    error(() => listCherryAgentMessages(s), 404, 'SESSION_NOT_FOUND')
    getDatabase().run("UPDATE agent_session_read_model SET deleted_at=NULL,type='background' WHERE id=?", [s])
    error(() => listCherryAgentMessages(s), 409, 'UNSUPPORTED_SESSION')
  })
  it('projects exact empty/whitespace/system text with actual service IDs and timestamps; nullable source metadata, no config', () => {
    const s = session()
    getDatabase().run('UPDATE agent_sessions SET data_json=? WHERE id=?', ['{"token":"runtime-secret","agentSession":{"snapshot":{"config":{"env_vars":{"KEY":"snapshot-secret"}}}}}', s])
    getDatabase().run('UPDATE agent_blueprints SET configuration_json=?', ['{"env_vars":{"TOKEN":"blueprint-secret"}}'])
    const actual = appendAgentSessionEvent({ sessionId: s, type: 'message', data: { role: 'user', content: '' } })
    event(s, 'assistant-event', 1, 'message', { role: 'assistant', content: ' \n  exact\t ' })
    event(s, 'system-event', 2, 'message', { role: 'system', content: 'system' })
    expect(getCherryAgentMessage(s, actual.id)).toEqual({ id: actual.id, sessionId: s, role: 'user', data: { parts: [{ type: 'text', text: '' }] }, status: 'success', searchableText: '', modelId: null, messageSnapshot: null, stats: null, runtimeResumeToken: null, createdAt: actual.created_at, updatedAt: actual.created_at })
    expect(getCherryAgentMessage(s, 'assistant-event').data.parts).toEqual([{ type: 'text', text: ' \n  exact\t ' }])
    expect(listCherryAgentMessages(s).items.map(m => m.role)).toEqual(['system', 'assistant', 'user'])
    expect(JSON.stringify(listCherryAgentMessages(s))).not.toContain('secret')
  })
  it.each([false, true])('correlates real tools (telemetry=%s), anchored to call identity with full inline output even deferred', telemetry => {
    const s = session()
    event(s, 'call-event', 0, 'tool-call', { callId: 'real-call', name: 'native/search', input: { query: 'x' }, ...(telemetry ? { telemetry: true } : {}) })
    event(s, 'result-event', 1, 'tool-result', { callId: 'real-call', output: { text: ' \n output ', nested: [1, null] }, ...(telemetry ? { type: 'tool-finished', telemetry: true, ownership: 'runtime' } : { name: 'native/search' }) }, later)
    const page = listCherryAgentMessages(s, { deferToolOutputs: true })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ id: 'call-event', role: 'assistant', createdAt: date, updatedAt: later, status: 'success', searchableText: '', data: { parts: [{ type: 'dynamic-tool', toolCallId: 'real-call', toolName: 'native/search', state: 'output-available', input: { query: 'x' }, output: { text: ' \n output ', nested: [1, null] } }] } })
    expect(listCherryAgentMessages(s, { deferToolOutputs: false })).toEqual(page)
    error(() => getCherryAgentMessage(s, 'result-event'), 404, 'MESSAGE_NOT_FOUND')
  })
  it('retains pending calls and native failure text without inventing outputs', () => {
    const s = session()
    event(s, 'a', 0, 'tool-call', { callId: 'a', name: 'x', input: null })
    event(s, 'b', 1, 'tool-call', { callId: 'b', name: 'x', input: {} })
    event(s, 'r', 2, 'tool-result', { callId: 'b', error: '', telemetry: true, type: 'tool-finished' })
    expect(getCherryAgentMessage(s, 'a')).toMatchObject({ status: 'pending', data: { parts: [{ state: 'input-available', input: null }] } })
    expect(getCherryAgentMessage(s, 'b')).toMatchObject({ status: 'error', data: { parts: [{ state: 'output-error', errorText: '' }] } })
    expect(JSON.stringify(getCherryAgentMessage(s, 'b'))).not.toContain('"output"')
  })
  it('projects an error event honestly at its own sequence, not merged into unrelated assistant text', () => {
    const s = session(); event(s, 'text', 0, 'message', { role: 'assistant', content: 'answer' }); event(s, 'err', 1, 'error', { message: ' \n failure ' })
    expect(listCherryAgentMessages(s).items.map(m => m.id)).toEqual(['err', 'text'])
    expect(getCherryAgentMessage(s, 'err')).toMatchObject({ status: 'error', data: { parts: [{ type: 'data-error', data: { message: ' \n failure ' } }] } })
  })
  it.each([
    ['message', { role: 'tool', content: 'lost' }, 'UNSUPPORTED_MESSAGE'],
    ['message', { role: 'root', content: '' }, 'UNSUPPORTED_MESSAGE'],
    ['message', { role: ['user'], content: '' }, 'UNSUPPORTED_MESSAGE'],
    ['message', { content: 'lost' }, 'UNSUPPORTED_MESSAGE'],
    ['message', { role: 'user', content: null }, 'UNSUPPORTED_MESSAGE'],
    ['message', { role: 'user', content: '', parts: [] }, 'UNSUPPORTED_EVENT_FIELDS'],
    ['permission', { permission: 'read', status: 'approved', detail: { toolCallId: 'x' } }, 'UNSUPPORTED_PERMISSION_HISTORY'],
    ['status', { status: 'idle', content: 'lost' }, 'UNSUPPORTED_STATUS'],
    ['status', { type: 'tool-progress', output: 'lost', callId: 'x' }, 'UNSUPPORTED_STATUS'],
    ['status', { status: 'running' }, 'UNSUPPORTED_STATUS'],
    ['alien', {}, 'UNSUPPORTED_EVENT_TYPE'],
    ['error', { message: 4 }, 'UNSUPPORTED_ERROR'],
    ['message', [], 'MALFORMED_EVENT']
  ])('explicitly refuses %s malformed/unsupported history, including outside requested page', (type, data, code) => {
    const s = session(); event(s, 'bad', 0, type as string, data); event(s, 'valid', 1, 'message', { role: 'user', content: '' })
    error(() => listCherryAgentMessages(s, { limit: 1 }), 409, code as string)
    error(() => getCherryAgentMessage(s, 'valid'), 409, code as string)
  })
  it('reads raw JSON without swallowing parser errors, rejects invalid timestamps and sequences', () => {
    const s = session(); event(s, 'bad', 0, 'message', {})
    getDatabase().run("UPDATE agent_session_events SET data_json='{' WHERE id='bad'")
    error(() => listCherryAgentMessages(s), 409, 'MALFORMED_EVENT')
    getDatabase().run('UPDATE agent_session_events SET data_json=?,created_at=? WHERE id=?', ['{"role":"user","content":""}', 'not-date', 'bad'])
    error(() => listCherryAgentMessages(s), 409, 'UNSUPPORTED_TIMESTAMP')
    getDatabase().run('UPDATE agent_session_events SET created_at=?,sequence=-1 WHERE id=?', [date, 'bad'])
    error(() => listCherryAgentMessages(s), 409, 'UNSUPPORTED_EVENT_IDENTITY')
  })
  it.each(['orphan', 'duplicate-call', 'duplicate-result', 'name-mismatch', 'output-and-error', 'missing-output', 'missing-input'])('refuses ambiguous tool history: %s', kind => {
    const s = session()
    if (kind !== 'orphan') event(s, 'call', 0, 'tool-call', { callId: 'c', name: 'tool', ...(kind === 'missing-input' ? {} : { input: {} }) })
    if (kind === 'duplicate-call') event(s, 'call2', 1, 'tool-call', { callId: 'c', name: 'tool', input: {} })
    else {
      event(s, 'result', 1, 'tool-result', { callId: 'c', ...(kind === 'missing-output' ? {} : { output: null }), ...(kind === 'name-mismatch' ? { name: 'wrong' } : {}), ...(kind === 'output-and-error' ? { error: 'bad' } : {}) })
      if (kind === 'duplicate-result') event(s, 'result2', 2, 'tool-result', { callId: 'c', output: null })
    }
    expect(() => listCherryAgentMessages(s)).toThrow(CherryAgentMessageError)
  })
  it('uses authoritative sequence even with reversed times; pages and anchors with real IDs, stable timestamp ties', () => {
    const s = session()
    for (let n = 0; n < 5; n++) event(s, `e:${n}`, n, 'message', { role: 'user', content: String(n) }, n === 0 ? later : date)
    const first = listCherryAgentMessages(s, { limit: 2 }); expect(first.items.map(m => m.id)).toEqual(['e:4', 'e:3']); expect(first.nextCursor).toBe('3:e:3')
    const second = listCherryAgentMessages(s, { cursor: first.nextCursor, limit: 2 }); expect(second.items.map(m => m.id)).toEqual(['e:2', 'e:1'])
    expect(listCherryAgentMessages(s, { cursor: second.nextCursor, limit: 2 })).toMatchObject({ items: [{ id: 'e:0' }] })
    expect(listCherryAgentMessages(s, { cursor: second.nextCursor, limit: 2 }).nextCursor).toBeUndefined()
    expect(listCherryAgentMessages(s, { messageId: 'e:2', limit: 2 }).items.map(m => m.id)).toEqual(['e:2', 'e:1'])
    expect(listCherryAgentMessages(s, { messageId: 'absent', limit: 1 }).items[0].id).toBe('e:4')
    expect(listCherryAgentMessages(s, { cursor: 'malformed', messageId: 'e:0', limit: 1 }).items[0].id).toBe('e:4')
  })
  it('enforces default50/max200 and session-local cursor/detail identity', () => {
    const s = session(), other = session()
    for (let n = 0; n < 201; n++) event(s, `e${n}`, n, 'message', { role: 'user', content: '' })
    event(other, 'other', 0, 'message', { role: 'user', content: '' })
    expect(listCherryAgentMessages(s).items).toHaveLength(50)
    expect(listCherryAgentMessages(s, { limit: 200 }).items).toHaveLength(200)
    error(() => listCherryAgentMessages(s, { limit: 201 }), 400, 'INVALID_QUERY')
    error(() => listCherryAgentMessages(s, { cursor: '0:other' }), 400, 'INVALID_CURSOR')
    error(() => getCherryAgentMessage(s, 'other'), 404, 'MESSAGE_NOT_FOUND')
    error(() => getCherryAgentMessage(s, ''), 400, 'INVALID_ID')
    error(() => listCherryAgentMessages(s, { deferToolOutputs: 'true' } as never), 400, 'INVALID_QUERY')
    error(() => listCherryAgentMessages(s, { secret: 'config' } as never), 400, 'INVALID_QUERY')
  })
  it('bounds total history bytes and event count before materializing or paging', () => {
    const s = session(), db = getDatabase()
    const content = 'x'.repeat(600000)
    for (let n = 0; n < 28; n++) event(s, `large${n}`, n, 'message', { role: 'user', content })
    error(() => listCherryAgentMessages(s, { limit: 1 }), 409, 'HISTORY_LIMIT_EXCEEDED')
    db.run('DELETE FROM agent_session_events WHERE session_id=?', [s])
    db.exec('BEGIN')
    for (let n = 0; n <= CHERRY_AGENT_MESSAGE_LIMITS.maxEvents; n++) event(s, `idle${n}`, n, 'status', { status: 'idle' })
    db.exec('COMMIT')
    error(() => listCherryAgentMessages(s), 409, 'HISTORY_LIMIT_EXCEEDED')
  })
  it('refuses huge outputs explicitly even deferred, without truncation or fake resolver', () => {
    const s = session(); event(s, 'call', 0, 'tool-call', { callId: 'c', name: 'tool', input: {} })
    event(s, 'result', 1, 'tool-result', { callId: 'c', output: 'x'.repeat(CHERRY_AGENT_MESSAGE_LIMITS.maxEventBytes) })
    error(() => listCherryAgentMessages(s, { deferToolOutputs: true }), 409, 'HISTORY_LIMIT_EXCEEDED')
  })
})
