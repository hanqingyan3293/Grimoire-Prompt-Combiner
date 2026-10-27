import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({ app: { getPath: () => testRoot } }))
import { closeDatabase, getDatabase, initDatabase } from '../database'
import { appendAgentSessionEvent, attachAgentRuntimeReference, attachAgentSession, branchAgentSession, createAgentSession, deleteAgentSession, getAgentSession, listAgentSessions, normalizeAgentSessionData, snapshotAgentSession, updateAgentSession } from './agent-session.service'
import { archiveAgentBlueprint, createAgentBlueprint } from './agent-blueprint.service'
import type { AgentSessionSnapshot } from '../../shared/agent-types'

function blueprint(runtime: 'pi' | 'codex' = 'pi') {
  return createAgentBlueprint({ name: 'Test agent', type: null, runtime, model: 'p::m' })
}
function namespace(id: string) { return normalizeAgentSessionData(getAgentSession(id)!.session.data.agentSession) }
function rawData(id: string) { return JSON.parse(String(getDatabase().exec('SELECT data_json FROM agent_sessions WHERE id=?', [id])[0].values[0][0])) as Record<string, unknown> }
import { deleteMcpServer, listMcpServers, saveMcpServer, updateMcpServerStatus } from './mcp.service'
import { createPersistedTask } from './task-repository'
import { deleteWD14History, getWD14History, readWD14HistoryImageData, saveWD14History } from './wd14-history.service'

beforeEach(() => { testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-agent-')) })
afterEach(() => { closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

describe('agent session persistence', () => {
  it('creates events and branches with copied history', async () => {
    await initDatabase()
    const source = createAgentSession({ runtime: 'openai-compatible', model: 'test', title: '源会话' })
    appendAgentSessionEvent({ sessionId: source.id, type: 'message', data: { text: 'hello' } })
    const branch = branchAgentSession({ sessionId: source.id })
    const loaded = getAgentSession(branch.id)
    expect(loaded?.session.parent_id).toBe(source.id)
    expect(loaded?.events).toHaveLength(1)
  })

  it('deletes the session and cascades its events', async () => {
    await initDatabase()
    const session = createAgentSession({ runtime: 'codex' })
    appendAgentSessionEvent({ sessionId: session.id, type: 'status', data: { status: 'running' } })
    expect(deleteAgentSession(session.id)).toBe(true)
    expect(getAgentSession(session.id)).toBeNull()
  })

  it('keeps event sequence numbers ordered after multiple appends', async () => {
    await initDatabase()
    const session = createAgentSession({ runtime: 'openai-compatible' })
    appendAgentSessionEvent({ sessionId: session.id, type: 'message', data: { content: 'one' } })
    appendAgentSessionEvent({ sessionId: session.id, type: 'message', data: { content: 'two' } })
    expect(getAgentSession(session.id)?.events.map(event => event.sequence)).toEqual([0, 1])
  })

  it('stores a main-owned runtime reference without allowing generic data replacement to inject it', async () => {
    await initDatabase()
    const session = createAgentSession({ runtime: 'opencode' })
    attachAgentRuntimeReference({ id: session.id, runtimeSessionId: 'remote-session-1' })
    expect(normalizeAgentSessionData(getAgentSession(session.id)!.session.data.agentSession)?.runtimeSessionId).toBe('remote-session-1')
    expect(() => updateAgentSession({ id: session.id, data: { agentSession: { version: 1, runtimeSessionId: 'forged' } } })).toThrow('AGENT_SESSION_NAMESPACE_OWNED')
    expect(normalizeAgentSessionData(getAgentSession(session.id)!.session.data.agentSession)?.runtimeSessionId).toBe('remote-session-1')
  })

  it('clears native runtime identity when branching instead of reusing the parent remote session', async () => {
    await initDatabase()
    const parent = createAgentSession({ runtime: 'opencode' })
    attachAgentRuntimeReference({ id: parent.id, runtimeSessionId: 'remote-parent' })
    const branch = branchAgentSession({ sessionId: parent.id })
    expect(normalizeAgentSessionData(getAgentSession(branch.id)!.session.data.agentSession)?.runtimeSessionId).toBeUndefined()
    expect(normalizeAgentSessionData(getAgentSession(parent.id)!.session.data.agentSession)?.runtimeSessionId).toBe('remote-parent')
  })

  it('creates and additively attaches the agentSession namespace without dropping legacy data', async () => {
    await initDatabase()
    const agent = blueprint()
    const session = createAgentSession({
      runtime: 'pi', providerId: 'p', model: 'm', agentId: agent.id, workspace: { type: 'user', workspaceId: 'ws-1' },
      attachments: [{ id: 'file-1', sourceType: 'upload', originalName: 'prompt.txt', mimeType: 'text/plain', size: 4, sha256: 'a'.repeat(64), status: 'available' }],
      snapshot: { version: 1, capturedAt: new Date().toISOString(), runtime: 'pi', providerId: 'p', model: 'm', config: { temperature: 0.2 } },
    })
    const original = namespace(session.id)
    expect(original?.agentId).toBe(agent.id)
    updateAgentSession({ id: session.id, data: { endpoint: 'http://127.0.0.1:1', token: 'legacy-token', command: 'pi', args: ['--json'], permissionMode: 'request', unknown: { keep: true } } })
    expect(namespace(session.id)).toEqual(original)
    attachAgentSession({ id: session.id, workspace: { type: 'system', path: 'workspace' }, attachments: [{ id: 'file-2', sourceType: 'paste', originalName: 'x.png', mimeType: 'image/png', size: 0, sha256: 'b'.repeat(64), status: 'missing' }] })
    snapshotAgentSession({ id: session.id, snapshot: { version: 1, capturedAt: new Date().toISOString(), runtime: 'pi', providerId: 'p', model: 'm', config: { temperature: 0.2 } } })
    const loaded = getAgentSession(session.id)!.session
    expect(loaded.data).toMatchObject({ endpoint: 'http://127.0.0.1:1', token: 'legacy-token', command: 'pi', args: ['--json'], permissionMode: 'request', unknown: { keep: true } })
    expect(loaded.data.agentSession).toMatchObject({ version: 1, workspace: { type: 'system', path: 'workspace' } })
    expect((loaded.data.agentSession as any).snapshot.model).toBe('m')
    expect((loaded.data.agentSession as any).attachments).toHaveLength(1)
  })

  it('keeps snapshots immutable until explicit snapshot operation', async () => {
    await initDatabase()
    const first = { version: 1 as const, capturedAt: new Date().toISOString(), runtime: 'codex' as const, providerId: 'p', model: 'one' }
    const oldAgent = blueprint('codex'), newAgent = blueprint('codex')
    const session = createAgentSession({ runtime: 'codex', providerId: 'p', model: 'one', agentId: oldAgent.id, snapshot: first })
    const captured = namespace(session.id)?.snapshot
    attachAgentSession({ id: session.id, agentId: newAgent.id })
    expect(namespace(session.id)?.snapshot).toEqual(captured)
    snapshotAgentSession({ id: session.id, snapshot: { ...first, agentId: newAgent.id, config: { temperature: 0.4 } } })
    expect(namespace(session.id)?.snapshot).toMatchObject({ agentId: newAgent.id, config: { temperature: 0.4 } })
  })

  it('branches namespace and events with mutation-independent copies', async () => {
    await initDatabase()
    const source = createAgentSession({ runtime: 'pi', agentId: blueprint().id, workspace: { type: 'user', workspaceId: 'w' }, attachments: [{ id: 'f', sourceType: 'upload', originalName: 'a.txt', mimeType: 'text/plain', size: 1, sha256: 'c'.repeat(64), status: 'available' }] })
    appendAgentSessionEvent({ sessionId: source.id, type: 'message', data: { nested: { value: 1 } } })
    const branch = branchAgentSession({ sessionId: source.id })
    const loaded = getAgentSession(branch.id)!
    ;(loaded.session.data.agentSession as any).attachments[0].originalName = 'changed'
    ;(loaded.events[0].data.nested as any).value = 99
    const original = getAgentSession(source.id)!
    expect((original.session.data.agentSession as any).attachments[0].originalName).toBe('a.txt')
    expect((original.events[0].data.nested as any).value).toBe(1)
    expect(loaded.session.parent_id).toBe(source.id)
  })

  it('rejects unsafe attachment metadata and tolerates malformed legacy JSON', async () => {
    await initDatabase()
    const session = createAgentSession({ runtime: 'pi' })
    expect(() => attachAgentSession({ id: session.id, attachments: [{ id: 'x', sourceType: 'upload', originalName: '../secret', mimeType: 'text/plain', size: 1, sha256: 'd'.repeat(64), status: 'available' }] })).toThrow('AGENT_SESSION_INVALID_ATTACHMENT')
    getDatabase().run('UPDATE agent_sessions SET data_json=? WHERE id=?', [JSON.stringify({ legacy: { keep: true }, agentSession: { version: 1, agentId: { invalid: true } } }), session.id])
    const agent = blueprint()
    expect(() => attachAgentSession({ id: session.id, agentId: agent.id })).not.toThrow()
    expect(getAgentSession(session.id)?.session.data.legacy).toEqual({ keep: true })
    expect(getAgentSession(session.id)?.session.data.agentSession).toMatchObject({ version: 1, agentId: agent.id })
  })
})

describe('owned session metadata safety', () => {
  it('rejects generic namespace injection or replacement and accepts an unchanged safe echo', async () => {
    await initDatabase()
    const session = createAgentSession({ runtime: 'pi', agentId: blueprint().id })
    expect(() => updateAgentSession({ id: session.id, data: { agentSession: { version: 1, agentId: null } } })).toThrow('AGENT_SESSION_NAMESPACE_OWNED')
    expect(() => updateAgentSession({ id: session.id, data: { agentSession: null } })).toThrow('AGENT_SESSION_NAMESPACE_OWNED')
    updateAgentSession({ id: session.id, data: { ...session.data, command: 'pi' } })
    expect(namespace(session.id)?.agentId).toBe(normalizeAgentSessionData(session.data.agentSession)?.agentId)
    const empty = createAgentSession({ runtime: 'pi' })
    expect(() => updateAgentSession({ id: empty.id, data: { agentSession: { version: 1 } } })).toThrow('AGENT_SESSION_NAMESPACE_OWNED')
  })

  it.each([[], null, 1, true, 'plain'])('rejects non-record config %j on creation and snapshot replacement', async config => {
    await initDatabase()
    const snapshot = { version: 1, capturedAt: new Date().toISOString(), runtime: 'pi', providerId: 'p', model: 'm', config } as unknown as AgentSessionSnapshot
    expect(() => createAgentSession({ runtime: 'pi', providerId: 'p', model: 'm', snapshot })).toThrow('AGENT_SESSION_INVALID_CONFIG')
    const session = createAgentSession({ runtime: 'pi', providerId: 'p', model: 'm' })
    expect(() => snapshotAgentSession({ id: session.id, snapshot })).toThrow('AGENT_SESSION_INVALID_CONFIG')
  })

  it('rejects missing/archived newly supplied blueprints without rewriting captured history', async () => {
    await initDatabase()
    const agent = blueprint()
    const session = createAgentSession({ runtime: 'pi', agentId: agent.id })
    archiveAgentBlueprint(agent.id)
    expect(() => createAgentSession({ runtime: 'pi', agentId: agent.id })).toThrow('AGENT_SESSION_AGENT_NOT_FOUND')
    expect(() => createAgentSession({ runtime: 'pi', agentId: 'missing' })).toThrow('AGENT_SESSION_AGENT_NOT_FOUND')
    expect(() => attachAgentSession({ id: session.id, agentId: agent.id })).toThrow('AGENT_SESSION_AGENT_NOT_FOUND')
    expect(() => attachAgentSession({ id: session.id, agentId: 'missing' })).toThrow('AGENT_SESSION_AGENT_NOT_FOUND')
    expect(namespace(branchAgentSession({ sessionId: session.id }).id)?.agentId).toBe(agent.id)
    attachAgentSession({ id: session.id, agentId: null })
    expect(namespace(session.id)?.agentId).toBeNull()
  })

  it('checks snapshot runtime, provider, model and supplied association on both write paths', async () => {
    await initDatabase()
    const agent = blueprint(), other = blueprint()
    const snapshot: AgentSessionSnapshot = { version: 1, capturedAt: new Date().toISOString(), runtime: 'pi', providerId: 'p', model: 'm', agentId: agent.id }
    const session = createAgentSession({ runtime: 'pi', providerId: 'p', model: 'm', agentId: agent.id, snapshot })
    for (const bad of [{ ...snapshot, runtime: 'codex' as const }, { ...snapshot, providerId: 'other' }, { ...snapshot, model: 'other' }, { ...snapshot, agentId: other.id }, { ...snapshot, agentId: null }]) {
      expect(() => createAgentSession({ runtime: 'pi', providerId: 'p', model: 'm', agentId: agent.id, snapshot: bad })).toThrow('AGENT_SESSION_SNAPSHOT_MISMATCH')
      expect(() => snapshotAgentSession({ id: session.id, snapshot: bad })).toThrow('AGENT_SESSION_SNAPSHOT_MISMATCH')
    }
    const captured = namespace(session.id)?.snapshot
    expect(() => updateAgentSession({ id: session.id, data: { agentSession: { ...namespace(session.id), snapshot: { ...snapshot, config: { changed: true } } } } })).toThrow('AGENT_SESSION_NAMESPACE_OWNED')
    expect(namespace(session.id)?.snapshot).toEqual(captured)
  })

  it.each(['/private/data', 'C:/private/data', '\\\\server\\share', 'file:///private/data'])('rejects absolute namespace paths %s', async value => {
    await initDatabase()
    const session = createAgentSession({ runtime: 'pi', providerId: 'p', model: 'm' })
    expect(() => attachAgentSession({ id: session.id, agentId: value })).toThrow('AGENT_SESSION_INVALID_AGENT_ID')
    expect(() => attachAgentSession({ id: session.id, workspace: { type: 'user', workspaceId: value } })).toThrow('AGENT_SESSION_INVALID_WORKSPACE')
    const snapshot: AgentSessionSnapshot = { version: 1, capturedAt: new Date().toISOString(), runtime: 'pi', providerId: 'p', model: 'm' }
    for (const field of ['agentId', 'providerId', 'model'] as const) expect(() => snapshotAgentSession({ id: session.id, snapshot: { ...snapshot, [field]: value } })).toThrow()
  })

  it('sanitizes get/list independently but preserves raw metadata through generic writes, explicit patches and branches', async () => {
    await initDatabase()
    const session = createAgentSession({ runtime: 'pi' })
    const rawNamespace = { version: 1, agentId: '/private/agent', workspace: { type: 'user', workspaceId: 'safe-workspace' }, snapshot: { version: 1, capturedAt: new Date().toISOString(), runtime: 'pi', providerId: '/private/provider', model: 'm', config: { apiKey: 'hidden' } }, attachments: [{ id: '/private/file' }], secret: 'raw-kept' }
    getDatabase().run('UPDATE agent_sessions SET data_json=? WHERE id=?', [JSON.stringify({ token: 'legacy-kept', agentSession: rawNamespace }), session.id])
    expect(namespace(session.id)).toEqual({ version: 1, workspace: { type: 'user', workspaceId: 'safe-workspace' }, attachments: [] })
    expect(listAgentSessions().find(item => item.id === session.id)?.data).toEqual(getAgentSession(session.id)?.session.data)
    updateAgentSession({ id: session.id, status: 'running' })
    expect(rawData(session.id).agentSession).toEqual(rawNamespace)
    updateAgentSession({ id: session.id, data: { ...getAgentSession(session.id)!.session.data, command: 'pi' } })
    expect(rawData(session.id).agentSession).toEqual(rawNamespace)
    expect(rawData(session.id).token).toBe('legacy-kept')
    const branch = branchAgentSession({ sessionId: session.id })
    expect(rawData(branch.id).agentSession).toEqual(rawNamespace)
    attachAgentSession({ id: session.id, workspace: { type: 'system', path: 'relative-workspace' } })
    expect(rawData(session.id).agentSession).toEqual({ ...rawNamespace, workspace: { type: 'system', path: 'relative-workspace' } })
  })
})

describe('MCP server persistence', () => {
  it('saves, updates status, lists and deletes without exposing env secrets', async () => {
    await initDatabase()
    const server = saveMcpServer({ name: 'test', transport: 'http', endpoint: 'http://127.0.0.1:1', env: { SECRET: 'hidden' }, tools: [{ name: 'search' }] })
    expect(listMcpServers()[0]).toMatchObject({ id: server.id, name: 'test', status: 'disconnected', env: {}, enabled_tools: [] })
    const enabled = saveMcpServer({ id: server.id, enabled_tools: ['search'] })
    expect(enabled.enabled_tools).toEqual(['search'])
    expect(enabled.enabled).toBe(true)
    expect(updateMcpServerStatus(server.id, 'failed', 'unreachable')).toMatchObject({ status: 'failed', error_message: 'unreachable' })
    expect(deleteMcpServer(server.id)).toBe(true)
  })
})

describe('WD14 history snapshots', () => {
  it('keeps the history image readable after the source image row is deleted', async () => {
    await initDatabase()
    const sourcePath = path.join(testRoot, 'source.png')
    fs.writeFileSync(sourcePath, Buffer.from('snapshot-data'))
    getDatabase().run('INSERT INTO image_refs (file_path,storage_mode,mime_type,original_name,available) VALUES (?,?,?,?,?)', [sourcePath, 'managed', 'image/png', 'source.png', 1])
    const imageId = Number(getDatabase().exec('SELECT last_insert_rowid()')[0].values[0][0])
    const task = createPersistedTask({ kind: 'wd14', input: { imageId } })
    const history = saveWD14History({ taskId: task.id, imageId, tags: { general: [{ name: 'cat', confidence: 0.9 }] } })
    getDatabase().run('DELETE FROM image_refs WHERE id=?', [imageId])
    expect(getWD14History(history.id)?.image_snapshot_available).toBe(true)
    expect(await readWD14HistoryImageData(history.id)).toBe('data:image/png;base64,' + Buffer.from('snapshot-data').toString('base64'))
    expect(deleteWD14History(history.id)).toBe(true)
  })
})
