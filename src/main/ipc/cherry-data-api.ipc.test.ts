import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({
  app: { getPath: () => testRoot },
  ipcMain: { handle: vi.fn() },
  // No windows in tests; the shell calls are asserted through their validation gates,
  // which reject before reaching Electron.
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  shell: { openExternal: vi.fn(async () => undefined), showItemInFolder: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() }
}))

import { BrowserWindow } from 'electron'
import * as blueprints from '../services/agent-blueprint.service'
import * as runtimeRegistry from '../ai/runtime/registry'
import { createAgentSession } from '../services/agent-session.service'
import { allocateSystemAgentWorkspace, getAgentWorkspaceInternal } from '../services/agent-workspace.service'
import { getAgentSession } from '../services/agent-session.service'
import { closeDatabase, getDatabase, initDatabase } from '../database'
import { listMcpServers } from '../services/mcp.service'
import { createAiSession } from '../services/ai-session.service'
import { saveAiTopic } from '../services/cherry-assistant.service'
import * as topicTrees from '../services/topic-tree.service'
import { __test, projectGrimoireProvider } from './cherry-data-api.ipc'
import { AgentPrewarmUnavailableError, agentSessionPrewarmService } from '../services/agent-session-prewarm.service'

const { handleRequest, handleIpcApiRoute, sourceProviderFromRow } = __test

beforeEach(() => { testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-cherry-data-api-')) })
afterEach(() => { vi.restoreAllMocks(); vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]); closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

function seedProvider(id: string, name: string, baseUrl: string, apiKey: string, active = false): void {
  getDatabase().run(
    'INSERT INTO providers (id,name,access_mode,protocol,base_url,api_key,default_model,test_model,context_size,models,config_toml,auth_json,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, name, 'api', 'chat_completions', baseUrl, apiKey, 'gpt-4o', '', 128000, JSON.stringify(['gpt-4o', 'gpt-4o-mini']), '', '', active ? 1 : 0, '2026-01-01', '2026-01-01']
  )
}

describe('Cherry DataApi v33 independent Topic tree foundation', () => {
  const request = (method: string, path: string, body?: unknown, params?: Record<string, unknown>) =>
    handleRequest({ id: 'topic-request', method, path, body, params }) as any
  const dto = (text = 'new') => ({ role: 'user', data: { parts: [{ type: 'text', text }] }, status: 'success' })
  async function fixture() {
    await initDatabase()
    const session = createAiSession({ title: 'Shared legacy session' })
    const a = saveAiTopic({ session_id: session.id, title: 'A' }), b = saveAiTopic({ session_id: session.id, title: 'B' })
    const legacy = saveAiTopic({ session_id: session.id, title: 'Unresolved' })
    getDatabase().run('INSERT INTO ai_messages (id,session_id,sequence,role,content_json,attachments_json,status,created_at) VALUES (?,?,?,?,?,?,?,?)',
      ['legacy-topic-msg', session.id, 7, 'assistant', '{"text":"NEVER ADOPT","keep":true}', '[]', 'completed', '2026-01-01T00:00:00.000Z'])
    const rootA = topicTrees.initializeTopicTree(a.id).rootId, rootB = topicTrees.initializeTopicTree(b.id).rootId
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ isDestroyed: () => false, webContents: { send } }] as unknown as BrowserWindow[])
    return { a: a.id, b: b.id, legacy: legacy.id, rootA, rootB, send }
  }
  function snapshot() {
    return ['topic_tree_state', 'topic_tree_messages', 'ai_topics', 'ai_messages', 'ai_sessions', 'cherry_resource_state'].map(table => getDatabase().exec(`SELECT * FROM ${table}`))
  }
  const messagesPath = (id: string) => '/topics/' + id + '/messages'

  it('reads two initialized topics on one session without inferring legacy history or sibling groups', async () => {
    const { a, b, rootA, rootB, send } = await fixture()
    const before = snapshot()
    expect(request('GET', messagesPath(a))).toMatchObject({ id: 'topic-request', status: 200, data: { items: [], rootId: rootA, activeNodeId: null, assistantId: null } })
    expect(request('GET', messagesPath(b)).data.rootId).toBe(rootB)
    expect(rootA).not.toBe(rootB)
    expect(snapshot()).toEqual(before)
    expect(send).not.toHaveBeenCalled()
    const ma = request('POST', messagesPath(a), dto('A')).data, mb = request('POST', messagesPath(b), dto('B')).data
    expect(ma).toMatchObject({ topicId: a, parentId: rootA, searchableText: 'A', siblingsGroupId: 0, modelId: null, messageSnapshot: null, stats: null, compactionSummary: null })
    expect(ma.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(ma.createdAt).toBe(new Date(ma.createdAt).toISOString())
    expect(request('GET', messagesPath(a)).data.items).toEqual([{ message: ma }])
    expect(request('GET', messagesPath(b)).data.items).toEqual([{ message: mb }])
    for (const query of ['', '?includeSiblings=true', '?includeSiblings=false']) {
      expect(request('GET', messagesPath(a) + query).data.items).toEqual([{ message: ma }])
    }
    expect(request('GET', messagesPath(a), undefined, { includeSiblings: false }).data.items).toEqual([{ message: ma }])
    expect(getDatabase().exec('SELECT id,sequence,content_json FROM ai_messages')[0].values).toEqual([['legacy-topic-msg', 7, '{"text":"NEVER ADOPT","keep":true}']])
  })

  it('appends source fields, selects internal nodes by the exact PUT route and preserves query-only paths/cursors', async () => {
    const { a, rootA } = await fixture(), path = messagesPath(a)
    const first = request('POST', path, dto('first')).data
    const child = request('POST', path, { ...dto('child'), role: 'assistant' }).data
    const third = request('POST', path, { role: 'system', data: {} }).data
    expect(third).toMatchObject({ parentId: child.id, status: 'pending', searchableText: '' })
    expect(request('GET', path + '?limit=2').data).toMatchObject({ items: [{ message: child }, { message: third }], nextCursor: child.id, activeNodeId: third.id })
    expect(request('GET', path, undefined, { cursor: child.id, limit: 2 }).data.items).toEqual([{ message: first }])
    expect(request('GET', path + '?nodeId=' + child.id).data).toMatchObject({ items: [{ message: first }, { message: child }], activeNodeId: third.id })
    expect(topicTrees.getTopicTreeState(a).activeNodeId).toBe(third.id)
    expect(request('PUT', '/topics/' + a + '/active-node', { nodeId: first.id })).toMatchObject({ status: 200, data: { activeNodeId: first.id } })
    const fork = request('POST', path, { ...dto('fork'), data: { parts: [], modelSelection: 'explicit' } }).data
    expect(fork.parentId).toBe(first.id)
    expect(request('GET', path).data.items.map((i: any) => i.message.id)).toEqual([first.id, fork.id])
    const hidden = request('POST', path, { ...dto('root branch'), parentId: null, setAsActive: false, status: 'paused' }).data
    expect(hidden).toMatchObject({ parentId: rootA, status: 'paused' })
    expect(topicTrees.getTopicTreeState(a).activeNodeId).toBe(fork.id)
    expect(request('GET', path, undefined, { cursor: hidden.id })).toMatchObject({ status: 404, error: { code: 'NOT_FOUND' } })
    expect(request('POST', path, { ...dto(), parentId: rootA, setAsActive: false }).data.parentId).toBe(rootA)
  })

  it('normalizes searchableText using the source content projection, never reasoning or tool inputs', async () => {
    const { a } = await fixture()
    const data = { parts: [
      { type: 'data-error', data: { message: 'error' } }, { type: 'reasoning', text: 'private reasoning' },
      { type: 'text', text: 'hello' }, { type: 'text', text: '   ' },
      { type: 'data-code', data: { content: 'code' } }, { type: 'data-translation', data: { content: 'translated' } },
      { type: 'data-compact', data: { content: 'compact', compactedContent: 'summary' } },
      { type: 'dynamic-tool', input: { text: 'private input' } }
    ] }
    const created = request('POST', messagesPath(a), { role: 'assistant', data, status: 'error' })
    expect(created).toMatchObject({ status: 201, data: { searchableText: 'hello code translated compact summary error', data } })
    expect(request('GET', messagesPath(a)).data.items[0].message).toEqual(created.data)
  })

  it('keeps unresolved legacy explicitly 501 and never auto-initializes through any transport route', async () => {
    const { legacy, rootA, send } = await fixture(), before = snapshot()
    for (const response of [request('GET', messagesPath(legacy)), request('POST', messagesPath(legacy), dto()), request('PUT', '/topics/' + legacy + '/active-node', { nodeId: rootA })]) {
      expect(response).toMatchObject({ status: 501, error: { code: 'NOT_IMPLEMENTED' } })
      expect(response.error.message).toContain('legacy session history is not adopted')
    }
    expect(request('POST', '/topics/' + legacy + '/initialize').status).toBe(404)
    expect(snapshot()).toEqual(before)
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects cross-topic parent/selection/path/cursor and virtual root selection without writes/effects', async () => {
    const { a, b, rootA, send } = await fixture()
    const other = topicTrees.appendTopicMessage(b, dto() as any)
    const before = snapshot()
    for (const response of [request('POST', messagesPath(a), { ...dto(), parentId: other.id }), request('PUT', '/topics/' + a + '/active-node', { nodeId: other.id }), request('GET', messagesPath(a), undefined, { nodeId: other.id }), request('PUT', '/topics/' + a + '/active-node', { nodeId: rootA })]) {
      expect(response).toMatchObject({ status: 409, error: { code: 'INVALID_OPERATION' } })
    }
    expect(request('GET', messagesPath(a), undefined, { cursor: other.id }).status).toBe(404)
    expect(request('GET', messagesPath(a), undefined, { nodeId: rootA }).status).toBe(409)
    expect(request('GET', messagesPath('missing')).status).toBe(404)
    expect(request('GET', '/topics/%ZZ/messages').status).toBe(400)
    expect(snapshot()).toEqual(before)
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects malformed query/body/UUID controls and unsupported writes/routes explicitly', async () => {
    const { a, send } = await fixture(), path = messagesPath(a), before = snapshot()
    for (const params of [{ limit: 0 }, { limit: 1.5 }, { limit: '2' }, { nodeId: 'not-uuid' }, { cursor: 'not-uuid' }, { includeSiblings: 'false' }, { includeSiblings: 1 }, { includeSiblings: null }, { unknown: true }]) {
      expect(request('GET', path, undefined, params)).toMatchObject({ status: 400, error: { code: 'VALIDATION_ERROR' } })
    }
    for (const query of ['limit=', 'limit=true', 'includeSiblings=1', 'includeSiblings=', 'nodeId=x', 'limit=1&limit=2', 'unknown=x']) expect(request('GET', path + '?' + query).status).toBe(400)
    expect(request('GET', path + '?limit=1', undefined, { limit: 1 }).status).toBe(400)
    for (const body of [null, [], 'text', {}, { ...dto(), role: 'root' }, { ...dto(), status: 'completed' }, { ...dto(), setAsActive: 'false' }, { ...dto(), parentId: 'bad' }, { ...dto(), data: { parts: 'text' } }, { ...dto(), data: { modelSelection: 'invalid' } }]) expect(request('POST', path, body).status).toBe(400)
    for (const field of ['siblingsGroupId', 'modelId', 'messageSnapshot', 'modelSnapshot', 'unknown']) expect(request('POST', path, { ...dto(), [field]: field === 'siblingsGroupId' ? 0 : {} })).toMatchObject({ status: 501, error: { code: 'NOT_IMPLEMENTED' } })
    for (const data of [{ parts: [{ type: 'file', url: 'file:///secret' }] }, { parts: [{ type: 'dynamic-tool', output: { $persistedToolOutput: 'id' } }] }, { fileEntryId: 'id' }, { turnOptions: {} }]) expect(request('POST', path, { role: 'user', data }).status).toBe(501)
    for (const body of [[], {}, { nodeId: null }, { nodeId: 'bad' }, { nodeId: 'bad', extra: true }]) expect(request('PUT', '/topics/' + a + '/active-node', body).status).toBe(400)
    for (const [method, route] of [['DELETE', path], ['PATCH', path], ['POST', '/topics/' + a + '/active-node'], ['GET', '/topics/' + a + '/tree'], ['GET', '/topics/' + a + '/path'], ['POST', '/topics/' + a + '/duplicate'], ['POST', '/messages/id/siblings'], ['POST', '/messages/id/branches'], ['PATCH', '/messages/id']]) expect(request(method, route).status).toBe(501)
    expect(snapshot()).toEqual(before)
    expect(send).not.toHaveBeenCalled()
  })

  it('rolls back insert/selection failures and emits source-scoped effects only after commit', async () => {
    const { a, send } = await fixture(), db = getDatabase(), path = messagesPath(a)
    const before = snapshot()
    db.exec(`CREATE TRIGGER fail_topic_selection BEFORE UPDATE ON topic_tree_state BEGIN SELECT RAISE(ABORT, 'fixture transaction failure'); END`)
    expect(request('POST', path, dto())).toMatchObject({ status: 500, error: { code: 'INTERNAL' } })
    expect(snapshot()).toEqual(before)
    expect(send).not.toHaveBeenCalled()
    db.exec('DROP TRIGGER fail_topic_selection')
    let observedAfterCommit = false
    send.mockImplementation(() => {
      // Beginning a fresh transaction proves the write transaction ended before effects.
      db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK')
      observedAfterCommit = true
    })
    const created = request('POST', path, dto())
    expect(created.status).toBe(201)
    const effects = [
      { endpoint: '/topics/:topicId/messages', kind: 'membership', routeParams: { topicId: a }, entityIds: [created.data.id] },
      { endpoint: '/topics/:topicId/tree', routeParams: { topicId: a }, entityIds: [created.data.id] },
      { endpoint: '/topics', kind: 'projection', entityIds: [a] },
      { endpoint: '/topics/:id', routeParams: { id: a }, entityIds: [a] }
    ]
    expect(send).toHaveBeenCalledExactlyOnceWith('data-api:data-changed', effects)
    expect(observedAfterCommit).toBe(true)
    send.mockClear()
    const committed = snapshot()
    db.exec(`CREATE TRIGGER fail_topic_selection BEFORE UPDATE ON topic_tree_state BEGIN SELECT RAISE(ABORT, 'fixture selection failure'); END`)
    expect(request('PUT', '/topics/' + a + '/active-node', { nodeId: created.data.id }).status).toBe(500)
    expect(snapshot()).toEqual(committed)
    expect(send).not.toHaveBeenCalled()
    db.exec('DROP TRIGGER fail_topic_selection')
    expect(request('PUT', '/topics/' + a + '/active-node', { nodeId: created.data.id }).status).toBe(200)
    expect(send).toHaveBeenCalledExactlyOnceWith('data-api:data-changed', effects)
    send.mockImplementation(() => { throw new Error('destroyed renderer') })
    expect(request('POST', path, dto('committed despite destroyed renderer')).status).toBe(201)
  })
})

describe('Cherry DataApi source Agent blueprint transport', () => {
  const request = (method: string, path: string, body?: unknown, params?: Record<string, unknown>) =>
    handleRequest({ id: 'agent-request', method, path, body, params }) as any
  const create = (name = 'Research') => blueprints.createAgentBlueprint({
    type: 'pi', runtime: 'pi', name, description: 'literal %_ search', instructions: 'Assist',
    model: 'provider::unknown-model', configuration: { avatar: 'A', language: 'English' }
  })
  function observeWrites() {
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ isDestroyed: () => false, webContents: { send } }] as unknown as BrowserWindow[])
    return send
  }

  it('returns the source DTO in a page envelope with nullable modelName and no runtime/secrets', async () => {
    await initDatabase()
    const agent = create()
    // Legacy/imported internal metadata must not be laundered into the source DTO.
    getDatabase().run('UPDATE agent_blueprints SET configuration_json=? WHERE id=?', [JSON.stringify({
      avatar: 'A', env_vars: { TOKEN: 'env-secret' }, runtime: 'opencode',
      internal: { token: 'internal-secret' }, slash_commands: [{ secret: 'nested-secret' }]
    }), agent.id])
    const response = request('GET', '/agents')
    expect(response).toMatchObject({ id: 'agent-request', status: 200 })
    expect(Object.keys(response.data).sort()).toEqual(['items', 'page', 'total'])
    expect(response.data).toMatchObject({ page: 1, total: 1 })
    expect(response.data.items[0]).toEqual({
      id: agent.id, type: 'pi', name: 'Research', description: 'literal %_ search', instructions: 'Assist',
      model: 'provider::unknown-model', modelName: null, orderKey: agent.orderKey,
      createdAt: agent.createdAt, updatedAt: agent.updatedAt, configuration: { avatar: 'A' },
      mcps: [], knowledgeBaseIds: [], disabledTools: []
    })
    expect(request('GET', '/agents/' + agent.id).data).toEqual(response.data.items[0])
    expect(JSON.stringify(response)).not.toMatch(/env-secret|internal-secret|nested-secret|opencode|runtime/)
    blueprints.updateAgentBlueprint(agent.id, { model: null })
    expect(request('GET', '/agents/' + agent.id).data).toMatchObject({ model: null, modelName: null })
  })

  it('honors pagination, URL scalar coercion, IDs, literal search and trash filters', async () => {
    await initDatabase()
    const first = create('First'), second = create('Second')
    const page = request('GET', '/agents?page=2&limit=1')
    expect(page.data).toMatchObject({ page: 2, total: 2 })
    expect(page.data.items.map((agent: any) => agent.id)).toEqual([first.id])
    expect(request('GET', '/agents', undefined, { ids: [second.id], search: '  %_  ' }).data.total).toBe(1)
    expect(request('GET', '/agents?ids=' + first.id).data.items[0].id).toBe(first.id)
    blueprints.archiveAgentBlueprint(second.id)
    expect(request('GET', '/agents?inTrash=false').data.total).toBe(1)
    expect(request('GET', '/agents?inTrash=true').data.items[0]).toMatchObject({ id: second.id, deletedAt: expect.any(String) })
    expect(request('GET', '/agents/' + second.id).status).toBe(404)
    expect(request('GET', '/agents/' + first.id).status).toBe(200)
  })

  it.each([
    { page: 0 }, { page: 1.5 }, { page: '2' }, { limit: 501 }, { limit: 0 },
    { page: Number.MAX_SAFE_INTEGER, limit: 500 }, { search: '  ' }, { search: 42 },
    { ids: [] }, { ids: [''] }, { ids: 'id' }, { ids: Array(501).fill('id') },
    { inTrash: 'false' }, { inTrash: 1 }, { runtime: 'pi' }, { tags: [] }
  ])('rejects invalid source list query %j', async params => {
    await initDatabase()
    const response = request('GET', '/agents', undefined, params)
    expect(response).toMatchObject({ status: 400, error: { code: 'VALIDATION_ERROR' } })
  })

  it.each(['page=', 'page=true', 'limit=501', 'inTrash=0', 'search=%20', 'page=1&page=2', 'unknown=x'])('rejects invalid URL query %s', async query => {
    await initDatabase()
    expect(request('GET', '/agents?' + query)).toMatchObject({ status: 400, error: { code: 'VALIDATION_ERROR' } })
  })

  it('returns 404 for unknown IDs and leaves unsupported routes genuinely unbridged', async () => {
    await initDatabase()
    const send = observeWrites()
    expect(request('GET', '/agents/missing')).toMatchObject({ status: 404, error: { code: 'NOT_FOUND' } })
    expect(request('PATCH', '/agents/missing', { name: 'New' }).status).toBe(404)
    expect(request('GET', '/agents/%ZZ').status).toBe(400)
    for (const [method, path] of [['POST', '/agents'], ['POST', '/agents/missing/clone'], ['PATCH', '/agents/missing/order'], ['DELETE', '/agents/missing']]) {
      expect(request(method, path).status).toBe(404)
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('explicitly refuses unrepresentable source types without dropping rows, leaking runtime or writing', async () => {
    await initDatabase()
    create()
    const agent = blueprints.createAgentBlueprint({ type: null, runtime: 'opencode', name: 'Private', model: 'provider::model' })
    const send = observeWrites(), update = vi.spyOn(blueprints, 'updateAgentBlueprint')
    for (const response of [request('GET', '/agents'), request('GET', '/agents/' + agent.id), request('PATCH', '/agents/' + agent.id, { name: 'Changed' })]) {
      expect(response).toMatchObject({ status: 409, error: { code: 'AGENT_SOURCE_TYPE_UNREPRESENTABLE' } })
      expect(response.data).toBeUndefined()
      expect(JSON.stringify(response)).not.toContain('opencode')
    }
    expect(update).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(blueprints.getAgentBlueprint(agent.id)?.name).toBe('Private')
  })

  it('forwards only source mutable fields and lets the service merge authoritative configuration safely', async () => {
    await initDatabase()
    const agent = create()
    getDatabase().run('UPDATE agent_blueprints SET configuration_json=? WHERE id=?', [JSON.stringify({
      avatar: 'A', language: 'English', internal: { keep: true }, env_vars: { TOKEN: 'persisted-secret' }
    }), agent.id])
    const patch = {
      name: 'Changed', description: '', instructions: '', model: null, planModel: 'p::plan', smallModel: null,
      mcps: ['mcp'], knowledgeBaseIds: ['kb', 'kb'], disabledTools: ['Read', 'Read'],
      configuration: { language: ' Thai ', avatar: undefined }, skillUpdates: []
    }
    const update = vi.spyOn(blueprints, 'updateAgentBlueprint'), send = observeWrites()
    const response = request('PATCH', '/agents/' + agent.id, patch)
    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledExactlyOnceWith(agent.id, {
      name: 'Changed', description: '', instructions: '', model: null, planModel: 'p::plan', smallModel: null,
      mcps: ['mcp'], knowledgeBaseIds: ['kb'], disabledTools: ['Read'], configuration: { language: 'Thai', avatar: undefined }
    })
    expect(response.data).toMatchObject({ name: 'Changed', model: null, modelName: null, planModel: 'p::plan', configuration: { language: 'Thai' } })
    expect(response.data.configuration).not.toHaveProperty('avatar')
    expect(JSON.stringify(response)).not.toContain('persisted-secret')
    const stored = JSON.parse(String(getDatabase().exec('SELECT configuration_json FROM agent_blueprints WHERE id=?', [agent.id])[0].values[0][0]))
    expect(stored).toEqual({ language: 'Thai', internal: { keep: true }, env_vars: { TOKEN: 'persisted-secret' } })
    expect(send).toHaveBeenCalledExactlyOnceWith('data-api:data-changed', [
      { endpoint: '/agents', kind: 'projection', entityIds: [agent.id] },
      { endpoint: '/agents/:agentId', routeParams: { agentId: agent.id }, entityIds: [agent.id] }
    ])
  })

  it.each([
    { runtime: 'opencode' }, { type: 'dsh' }, { id: 'other' }, { orderKey: 'first' },
    { createdAt: 'now' }, { updatedAt: 'now' }, { deletedAt: 'now' }, { modelName: 'Invented' },
    { skillUpdates: [{ skillId: 'skill', isEnabled: true }] }, { skillIds: [] }, { workspace: {} },
    { configuration: { env_vars: { TOKEN: 'new-secret' } } }, { configuration: { runtime: 'pi' } },
    { configuration: { builtin_role: 'assistant' } }
  ])('refuses unsupported source PATCH fields %j without any mutation', async body => {
    await initDatabase()
    const agent = create(), send = observeWrites(), update = vi.spyOn(blueprints, 'updateAgentBlueprint')
    const response = request('PATCH', '/agents/' + agent.id, { name: 'Must not change', ...body })
    expect(response).toMatchObject({ status: 409, error: { code: 'AGENT_SOURCE_FIELD_UNSUPPORTED' } })
    expect(update).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(blueprints.getAgentBlueprint(agent.id)?.name).toBe('Research')
  })

  it.each([null, [], 'patch', { name: '' }, { model: 'invalid' }, { planModel: 'invalid' }, { knowledgeBaseIds: [''] }, { configuration: { permission_mode: 'invalid' } }, { skillUpdates: {} }])('validates patch body before mutation %j', async body => {
    await initDatabase()
    const agent = create(), send = observeWrites(), update = vi.spyOn(blueprints, 'updateAgentBlueprint')
    expect(request('PATCH', '/agents/' + agent.id, body)).toMatchObject({ status: 400, error: { code: 'VALIDATION_ERROR' } })
    expect(update).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('does not write or emit effects for empty/no-op patches, reads or failed writes', async () => {
    await initDatabase()
    const agent = create(), send = observeWrites(), update = vi.spyOn(blueprints, 'updateAgentBlueprint')
    for (const body of [{}, { skillUpdates: [] }, { name: agent.name }, { configuration: { language: 'English' } }, { planModel: null }]) {
      expect(request('PATCH', '/agents/' + agent.id, body).status).toBe(200)
    }
    expect(request('GET', '/agents').status).toBe(200)
    expect(update).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    update.mockImplementationOnce(() => { throw new Error('write failed') })
    expect(request('PATCH', '/agents/' + agent.id, { name: 'Fail' }).status).toBe(500)
    expect(send).not.toHaveBeenCalled()
  })

  it('does not report a committed write as failure when event delivery fails', async () => {
    await initDatabase()
    const agent = create(), send = observeWrites()
    send.mockImplementation(() => { throw new Error('window gone') })
    expect(request('PATCH', '/agents/' + agent.id, { name: 'Committed' }).status).toBe(200)
    expect(blueprints.getAgentBlueprint(agent.id)?.name).toBe('Committed')
  })
})

describe('Cherry DataApi retained usage statistics', () => {
  const request = (path: string, params?: Record<string, unknown>) =>
    handleRequest({ id: 'usage-request', method: 'GET', path, params }) as any
  const from = Date.parse('2026-03-01T00:00:00.000Z')
  const to = Date.parse('2026-03-04T00:00:00.000Z')

  function seedUsage(): void {
    const insert = getDatabase().run.bind(getDatabase())
    for (const row of [
      ['u1', 'p1', 'm1', 's1', 100, 20, 5, '2026-03-01T12:00:00.000Z'],
      ['u2', 'p1', 'm1', 's1', 50, null, null, '2026-03-02T12:00:00.000Z'],
      ['u3', 'p2', 'm2', 's2', 30, 10, null, '2026-03-03T12:00:00.000Z'],
      ['u4', 'p2', 'm2', 's2', null, null, null, '2026-03-03T13:00:00.000Z']
    ]) {
      insert(
        'INSERT INTO ai_usage_records (id,session_id,message_id,runtime,protocol,provider_id,model_id,input_tokens,output_tokens,cached_tokens,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [row[0], row[3], null, 'opencode', 'chat', row[1], row[2], row[4], row[5], row[6], row[7]]
      )
    }
  }

  it('serves source query-shaped stats and timeline with real provider/model groups', async () => {
    await initDatabase()
    seedUsage()

    const stats = request('/ai-usage-records/stats', {
      groupBy: 'provider', metric: 'tokens', currency: 'USD', limit: 10, from, to
    })
    expect(stats.status).toBe(200)
    expect(stats.data.buckets).toHaveLength(2)
    expect(stats.data.buckets[0]).toMatchObject({
      groupBy: 'provider', providerId: 'p1', totalInputTokens: 150, totalOutputTokens: 20, totalTokens: 170, recordCount: 2
    })
    expect(stats.data.totals).toMatchObject({
      totalInputTokens: 180, totalOutputTokens: 30, totalTokens: 210,
      recordCount: 4, requestCount: 4, totalCost: null, costCurrency: null
    })
    const viaPathQuery = request(
      `/ai-usage-records/stats?groupBy=provider&metric=tokens&currency=USD&limit=10&from=${from}&to=${to}`
    )
    expect(viaPathQuery).toMatchObject({ status: 200, data: { totals: { totalTokens: 210, recordCount: 4 } } })

    const models = request('/ai-usage-records/stats', {
      groupBy: 'model', metric: 'requests', currency: 'USD', limit: 10, from, to
    })
    expect(models.data.buckets.map((bucket: any) => bucket.modelId)).toEqual(['m1', 'm2'])
    expect(models.data.buckets[0].requestCount).toBe(2)

    const timeline = request('/ai-usage-records/timeline', {
      groupBy: 'provider', metric: 'tokens', currency: 'USD', limit: 10, from, to
    })
    expect(timeline.status).toBe(200)
    expect(timeline.data.costTotals).toEqual([])
    expect(timeline.data.dailyCosts).toEqual([])
    expect(timeline.data.buckets.filter((bucket: any) => !bucket.isOther).map((bucket: any) => bucket.providerId)).toEqual(['p1', 'p1', 'p2'])
  })

  it('returns a real keyset cursor for entries and a null-token empty contract', async () => {
    await initDatabase()
    seedUsage()

    const first = request('/ai-usage-records', { sortBy: 'createdAt', sortOrder: 'desc', limit: 2 })
    expect(first.status).toBe(200)
    expect(first.data.total).toBe(4)
    expect(first.data.items).toHaveLength(2)
    expect(first.data.nextCursor).toEqual(expect.any(String))
    const second = request('/ai-usage-records', { sortBy: 'createdAt', sortOrder: 'desc', limit: 2, cursor: first.data.nextCursor })
    expect(second.status).toBe(200)
    expect(second.data.nextCursor).toBeUndefined()
    expect(new Set([...first.data.items, ...second.data.items].map((item: any) => item.id)).size).toBe(4)
    expect([...first.data.items, ...second.data.items].find((item: any) => item.id === 'u4'))
      .toMatchObject({ totalTokens: null, cost: null, costCurrency: null })

    getDatabase().run('DELETE FROM ai_usage_records')
    const emptyStats = request('/ai-usage-records/stats', { groupBy: 'provider', metric: 'tokens', limit: 10, from, to })
    expect(emptyStats).toMatchObject({
      status: 200,
      data: { buckets: [], totals: { recordCount: 0, totalTokens: null, totalCost: null, costCurrency: null } }
    })
    expect(request('/ai-usage-records/timeline', { metric: 'tokens', limit: 10, from, to })).toEqual({
      id: 'usage-request',
      status: 200,
      data: { buckets: [], costTotals: [], dailyCosts: [] }
    })
    expect(request('/ai-usage-records', { limit: 10 })).toEqual({
      id: 'usage-request',
      status: 200,
      data: { items: [], total: 0 }
    })
  })

  it('surfaces invalid and unrepresentable usage queries instead of returning a fake page', async () => {
    await initDatabase()
    expect(request('/ai-usage-records/stats', { groupBy: 'provider', metric: 'tokens', limit: 10, from: to, to: from }))
      .toMatchObject({ status: 400, error: { code: 'VALIDATION_ERROR' } })
    expect(request('/ai-usage-records/timeline', { metric: 'tokens', limit: 10, to }))
      .toMatchObject({ status: 400, error: { code: 'VALIDATION_ERROR' } })
    expect(request('/ai-usage-records', { messageKind: 'chat', messageId: 'message-1' }))
      .toMatchObject({ status: 501, error: { code: 'NOT_IMPLEMENTED' } })
    expect(request('/ai-usage-records', { cursor: 'bad-cursor' }))
      .toMatchObject({ status: 400, error: { code: 'VALIDATION_ERROR' } })
  })
})

describe('Cherry source Agent workspace repository transport', () => {
  let outside = ''
  beforeEach(() => { outside = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-api-workspaces-')) })
  afterEach(() => { fs.rmSync(outside, { recursive: true, force: true }) })
  const request = (method: string, path: string, body?: unknown) => handleRequest({ method, path, body }) as any
  function folder(name: string) { const target = path.join(outside, name); fs.mkdirSync(target); return target }
  function observe() {
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ isDestroyed: () => false, webContents: { send } }] as unknown as BrowserWindow[])
    return send
  }

  it('registers/reuses real user directories with exact DTO, 201/200 and committed effects', async () => {
    await initDatabase()
    const target = folder('user'), send = observe()
    fs.writeFileSync(path.join(target, 'keep'), 'unchanged')
    expect(request('GET', '/agent-workspaces').data).toEqual([])
    const created = request('POST', '/agent-workspaces', { path: target, name: '  Source  ' })
    expect(created.status).toBe(201)
    const workspace = created.data
    expect(Object.keys(workspace).sort()).toEqual(['id', 'name', 'path', 'type', 'orderKey', 'createdAt', 'updatedAt'].sort())
    expect(workspace).toMatchObject({ name: 'Source', type: 'user', id: expect.any(String) })
    expect(send).toHaveBeenCalledExactlyOnceWith('data-api:data-changed', [
      { endpoint: '/agent-workspaces', kind: 'membership', entityIds: [workspace.id] },
      { endpoint: '/agent-workspaces/:workspaceId', entityIds: [workspace.id] }
    ])
    send.mockClear()
    expect(request('POST', '/agent-workspaces', { path: target + path.sep, name: 'Not renamed' })).toMatchObject({ status: 200, data: workspace })
    expect(request('GET', '/agent-workspaces').data).toEqual([workspace])
    expect(request('GET', '/agent-workspaces/' + workspace.id).data).toEqual(workspace)
    expect(send).not.toHaveBeenCalled()
    const renamed = request('PATCH', '/agent-workspaces/' + workspace.id, { name: 'Renamed' })
    expect(renamed.data).toMatchObject({ id: workspace.id, name: 'Renamed', path: workspace.path })
    expect(send.mock.calls[0][1][0]).toEqual({ endpoint: '/agent-workspaces', kind: 'projection', entityIds: [workspace.id] })
    send.mockClear()
    expect(request('PATCH', '/agent-workspaces/' + workspace.id, { name: ' Renamed ' }).status).toBe(200)
    expect(send).not.toHaveBeenCalled()
    expect(fs.readFileSync(path.join(target, 'keep'), 'utf8')).toBe('unchanged')
  })

  it('keeps system rows hidden and refuses fake references, batch ordering and deletion', async () => {
    await initDatabase()
    const user = request('POST', '/agent-workspaces', { path: folder('user') }).data
    const system = allocateSystemAgentWorkspace({ sessionId: 'safe', createdAt: Date.now() }), send = observe()
    expect(request('GET', '/agent-workspaces').data.map((row: any) => row.id)).toEqual([user.id])
    for (const [method, suffix, body] of [['GET', '', undefined], ['PATCH', '', { name: 'bad' }], ['PATCH', '/order', { position: 'last' }], ['GET', '/references', undefined]] as const) {
      expect(request(method, '/agent-workspaces/' + system.id + suffix, body).status).toBe(404)
    }
    expect(request('GET', '/agent-workspaces/' + user.id + '/references')).toMatchObject({ status: 501, error: { code: 'NOT_IMPLEMENTED' } })
    expect(request('PATCH', '/agent-workspaces/order:batch', { moves: [] }).status).toBe(501)
    expect(request('DELETE', '/agent-workspaces/' + user.id).status).toBe(404)
    expect(request('GET', '/agent-workspaces/missing').status).toBe(404)
    expect(request('GET', '/agent-workspaces/%ZZ').status).toBe(400)
    expect(getAgentWorkspaceInternal(system.id)).toEqual(system)
    expect(fs.existsSync(system.path)).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('supports strict source single-row ordering with no-op detection and system anchors refused', async () => {
    await initDatabase()
    const a = request('POST', '/agent-workspaces', { path: folder('a') }).data
    const b = request('POST', '/agent-workspaces', { path: folder('b') }).data
    const system = allocateSystemAgentWorkspace({ sessionId: 'safe', createdAt: Date.now() }), send = observe()
    const moved = request('PATCH', '/agent-workspaces/' + a.id + '/order', { before: b.id })
    expect(moved).toMatchObject({ status: 200, data: null })
    expect(request('GET', '/agent-workspaces').data.map((row: any) => row.id)).toEqual([a.id, b.id])
    expect(send.mock.calls[0][1][0]).toEqual({ endpoint: '/agent-workspaces', kind: 'order', dimension: 'orderKey', entityIds: [a.id] })
    send.mockClear()
    for (const body of [{ before: b.id }, { position: 'first' }, { before: a.id }]) expect(request('PATCH', '/agent-workspaces/' + a.id + '/order', body).status).toBe(200)
    for (const body of [{}, { position: 'bad' }, { before: b.id, after: b.id }, { before: b.id, extra: true }]) expect(request('PATCH', '/agent-workspaces/' + a.id + '/order', body).status).toBe(400)
    expect(request('PATCH', '/agent-workspaces/' + a.id + '/order', { before: system.id }).status).toBe(404)
    expect(send).not.toHaveBeenCalled()
  })

  it('validates input and refuses managed paths including symlink aliases without writes/effects', async () => {
    await initDatabase()
    const target = folder('user'), send = observe()
    for (const body of [null, [], {}, { path: '' }, { path: 'relative' }, { path: path.join(outside, 'missing') }, { path: target, type: 'system' }, { path: target, name: '  ' }]) {
      expect(request('POST', '/agent-workspaces', body).status).toBe(400)
    }
    expect(request('POST', '/agent-workspaces', { path: testRoot }).status).toBe(403)
    const alias = path.join(outside, 'managed-alias')
    fs.symlinkSync(testRoot, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(request('POST', '/agent-workspaces', { path: alias }).status).toBe(403)
    expect(request('GET', '/agent-workspaces').data).toEqual([])
    expect(send).not.toHaveBeenCalled()
    const user = request('POST', '/agent-workspaces', { path: target }).data
    send.mockClear()
    for (const body of [{}, { name: '' }, { name: 'ok', path: target }, { name: 'ok', type: 'system' }]) expect(request('PATCH', '/agent-workspaces/' + user.id, body).status).toBe(400)
    expect(send).not.toHaveBeenCalled()
    expect(request('GET', '/agent-workspaces/' + user.id).data.name).toBe('user')
  })

  it('does not emit membership for a failed repository transaction', async () => {
    await initDatabase()
    const send = observe()
    getDatabase().exec("CREATE TRIGGER reject_workspace BEFORE INSERT ON agent_workspaces BEGIN SELECT RAISE(ABORT,'fixture failure'); END;")
    expect(request('POST', '/agent-workspaces', { path: folder('rollback') }).status).toBe(500)
    expect(request('GET', '/agent-workspaces').data).toEqual([])
    expect(send).not.toHaveBeenCalled()
  })
})

describe('Cherry source Agent session reads capability boundary', () => {
  const read = (path: string, params?: Record<string, unknown>) => handleRequest({ path, params }) as any
  const agent = () => blueprints.createAgentBlueprint({ type: 'pi', runtime: 'pi', name: 'Owner', model: 'p::m' })
  function observe() {
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ isDestroyed: () => false, webContents: { send } }] as unknown as BrowserWindow[])
    return send
  }

  it('returns source latest-null and cursor empty-list on a fresh store without effects', async () => {
    await initDatabase()
    const send = observe()
    expect(read('/agent-sessions/latest')).toMatchObject({ status: 200, data: { session: null } })
    expect(read('/agent-sessions').data).toEqual({ items: [] })
    expect(read('/agent-sessions?limit=50&cursor=entity:').data).toEqual({ items: [] })
    expect(read('/agent-sessions?cursor=stale-cursor').data).toEqual({ items: [] })
    expect(read('/agent-sessions', { inTrash: true, ids: ['absent'], limit: '200' }).data).toEqual({ items: [] })
    for (const agentId of ['unknown', 'unlinked', agent().id]) {
      expect(read('/agent-sessions/latest', { agentId }).data).toEqual({ session: null })
      expect(read('/agent-sessions', { agentId }).data).toEqual({ items: [] })
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('does not substitute ai_sessions for real runtime Agent sessions', async () => {
    await initDatabase()
    const chat = createAiSession({ title: 'Chat, not Agent session' })
    expect(read('/agent-sessions/latest').data).toEqual({ session: null })
    expect(read('/agent-sessions').data).toEqual({ items: [] })
    expect(read('/agent-sessions/' + chat.id)).toMatchObject({ status: 404, error: { code: 'NOT_FOUND' } })
  })

  it('refuses unresolved legacy sessions instead of claiming empty, remapping IDs or leaking metadata', async () => {
    await initDatabase()
    const session = createAgentSession({ runtime: 'opencode', title: 'Private legacy' }), send = observe()
    getDatabase().run('UPDATE agent_sessions SET data_json=? WHERE id=?', [JSON.stringify({ token: 'legacy-secret', workspacePath: 'D:/private', type: 'background' }), session.id])
    for (const path of ['/agent-sessions/latest', '/agent-sessions', '/agent-sessions/' + session.id, '/agent-sessions?cursor=entity:later:any', '/agent-sessions?inTrash=true']) {
      const response = read(path)
      expect(response).toMatchObject({ status: 409, error: { code: 'AGENT_SESSION_SOURCE_UNREPRESENTABLE' } })
      expect(response.data).toBeUndefined()
      expect(JSON.stringify(response)).not.toMatch(/legacy-secret|D:\/private|opencode|Private legacy/)
    }
    // Unnamespaced fields, including a guessed type='background', are not source
    // ownership or background evidence; an unknown scope cannot silently skip it.
    expect(read('/agent-sessions/latest', { agentId: 'unknown' }).status).toBe(409)
    expect(read('/agent-sessions', { ids: [session.id] }).status).toBe(409)
    expect(read('/agent-sessions', { ids: ['absent'] }).data).toEqual({ items: [] })
    expect(send).not.toHaveBeenCalled()
  })

  it('honors exact namespace owner/workspace filters without fabricating source workspace rows', async () => {
    await initDatabase()
    const owner = agent(), other = agent()
    const session = createAgentSession({ runtime: 'pi', agentId: owner.id, workspace: { type: 'user', workspaceId: 'workspace-ref' } })
    for (const path of ['/agent-sessions/latest', '/agent-sessions']) {
      expect(read(path, { agentId: owner.id }).status).toBe(409)
      expect(read(path, { agentId: other.id }).data).toEqual(path.endsWith('/latest') ? { session: null } : { items: [] })
      expect(read(path, { agentId: 'unknown' }).status).toBe(200)
    }
    expect(read('/agent-sessions', { workspaceId: 'workspace-ref' }).status).toBe(409)
    expect(read('/agent-sessions', { workspaceId: 'different' }).data).toEqual({ items: [] })
    expect(read('/agent-sessions/latest', { agentId: 'unlinked' }).data).toEqual({ session: null })
    blueprints.archiveAgentBlueprint(owner.id)
    expect(read('/agent-sessions/latest', { agentId: 'unlinked' }).status).toBe(409)
    expect(read('/agent-sessions/latest', { agentId: owner.id }).data).toEqual({ session: null })
    expect(read('/agent-sessions', { agentId: owner.id }).data).toEqual({ items: [] })
    expect(read('/agent-sessions', { agentId: owner.id, inTrash: true }).status).toBe(409)
    expect(read('/agent-sessions/' + session.id).status).toBe(409)
  })

  it('distinguishes source latest unlinked semantics from exact list agentId filtering', async () => {
    await initDatabase()
    createAgentSession({ runtime: 'pi', agentId: null, workspace: { type: 'system' } })
    expect(read('/agent-sessions/latest', { agentId: 'unlinked' }).status).toBe(409)
    expect(read('/agent-sessions', { agentId: 'unlinked' }).data).toEqual({ items: [] })
    expect(read('/agent-sessions', { agentId: '' }).status).toBe(409)
    expect(read('/agent-sessions', { workspaceId: 'unknown-system-id' }).status).toBe(409)
  })

  it.each([
    { page: 1 }, { limit: 0 }, { limit: 201 }, { limit: 'bad' }, { limit: 1.5 },
    { ids: [] }, { ids: [''] }, { ids: Array(201).fill('id') }, { ids: 'id' },
    { agentId: 42 }, { workspaceId: '' }, { cursor: 1 }, { inTrash: 'false' }, { type: 'background' }
  ])('validates source session list query %j', async params => {
    await initDatabase()
    expect(read('/agent-sessions', params)).toMatchObject({ status: 400, error: { code: 'VALIDATION_ERROR' } })
  })

  it.each([{ agentId: '' }, { agentId: null }, { limit: 50 }, { inTrash: false }, { cursor: '' }])('validates strict latest query %j', async params => {
    await initDatabase()
    expect(read('/agent-sessions/latest', params)).toMatchObject({ status: 400, error: { code: 'VALIDATION_ERROR' } })
  })

  it('returns detail and mutation 404 for unknown IDs and rejects invalid creation', async () => {
    await initDatabase()
    const send = observe()
    expect(read('/agent-sessions/missing').status).toBe(404)
    expect(read('/agent-sessions/%ZZ').status).toBe(400)
    expect((handleRequest({ method: 'POST', path: '/agent-sessions', body: {} }) as any).status).toBe(400)
    for (const [method, path] of [['PATCH', '/agent-sessions/missing'], ['PUT', '/agent-sessions/missing/workspace']]) {
      expect((handleRequest({ method, path, body: {} }) as any).status).toBe(404)
    }
    expect(send).not.toHaveBeenCalled()
  })
})

describe('Cherry mapped source Agent session transport', () => {
  const request = (method: string, path: string, body?: unknown, params?: Record<string, unknown>) => handleRequest({ method, path, body, params }) as any
  const owner = () => blueprints.createAgentBlueprint({ type: 'pi', runtime: 'pi', name: 'Mapped owner', model: 'provider::model::variant' })
  const create = (agentId: string, name = '') => request('POST', '/agent-sessions', { agentId, name, workspace: { type: 'system' } })
  function observe() {
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ isDestroyed: () => false, webContents: { send } }] as unknown as BrowserWindow[])
    return send
  }

  it('creates an actual joined system workspace DTO without mkdir, snapshot or fake runtime fields', async () => {
    await initDatabase()
    const agent = owner(), send = observe(), response = create(agent.id)
    expect(response.status).toBe(201)
    const session = response.data
    expect(Object.keys(session).sort()).toEqual(['id', 'agentId', 'name', 'isNameManuallyEdited', 'description', 'workspaceId', 'workspace', 'orderKey', 'lastActivityAt', 'createdAt', 'updatedAt'].sort())
    expect(session).toMatchObject({ agentId: agent.id, name: '', isNameManuallyEdited: false, workspace: { id: session.workspaceId, type: 'system' } })
    expect(getAgentWorkspaceInternal(session.workspaceId)).toEqual(session.workspace)
    expect(fs.existsSync(session.workspace.path)).toBe(false)
    expect(getAgentSession(session.id)?.session).toMatchObject({ id: session.id, runtime: 'pi', provider_id: 'provider', model: 'model::variant' })
    expect(getAgentSession(session.id)?.session.data.agentSession).not.toHaveProperty('snapshot')
    expect(send.mock.calls[0][1]).toEqual([
      { endpoint: '/agent-sessions', kind: 'membership', entityIds: [session.id] },
      { endpoint: '/agent-sessions', kind: 'order', dimension: 'lastActivityAt', entityIds: [session.id] },
      { endpoint: '/agent-sessions/:sessionId', entityIds: [session.id] }, { endpoint: '/agent-sessions/latest' }
    ])
    send.mockClear()
    expect(request('GET', '/agent-sessions/' + session.id).data).toEqual(session)
    expect(request('GET', '/agent-sessions/latest').data).toEqual({ session })
    expect(request('GET', '/agent-sessions', undefined, { agentId: agent.id }).data).toEqual({ items: [session] })
    expect(send).not.toHaveBeenCalled()
  })

  it('pages real entity order while latest uses actual activity and excludes background/trash', async () => {
    await initDatabase()
    const agent = owner(), first = create(agent.id, 'first').data, second = create(agent.id, 'second').data
    getDatabase().run('UPDATE agent_session_read_model SET last_activity_at=? WHERE id=?', ['2099-01-01T00:00:00.000Z', first.id])
    expect(request('GET', '/agent-sessions/latest').data.session.id).toBe(first.id)
    const page = request('GET', '/agent-sessions', undefined, { limit: '1' }).data
    expect(page.items[0].id).toBe(second.id)
    expect(page.nextCursor).toBe('entity:' + second.orderKey + ':' + second.id)
    expect(request('GET', '/agent-sessions', undefined, { limit: 1, cursor: page.nextCursor }).data).toEqual({ items: [request('GET', '/agent-sessions/' + first.id).data] })
    getDatabase().run("UPDATE agent_session_read_model SET type='background' WHERE id=?", [first.id])
    expect(request('GET', '/agent-sessions/latest').data.session.id).toBe(second.id)
    expect(request('GET', '/agent-sessions/' + first.id).status).toBe(404)
    expect(request('PATCH', '/agent-sessions/' + first.id, { name: 'bad' }).status).toBe(404)
    getDatabase().run('UPDATE agent_session_read_model SET deleted_at=? WHERE id=?', ['2026-01-01T00:00:00.000Z', second.id])
    expect(request('GET', '/agent-sessions/latest').data).toEqual({ session: null })
    expect(request('GET', '/agent-sessions').data).toEqual({ items: [] })
    expect(request('GET', '/agent-sessions', undefined, { inTrash: true }).data.items[0].id).toBe(second.id)
  })

  it('patches exact source fields with no-op detection, owner metadata only and committed effects', async () => {
    await initDatabase()
    const a = owner(), b = owner(), session = create(a.id, 'Original').data, send = observe()
    const runtime = getAgentSession(session.id)?.session
    const changed = request('PATCH', '/agent-sessions/' + session.id, { name: 'Renamed', description: 'Note', agentId: b.id })
    expect(changed).toMatchObject({ status: 200, data: { name: 'Renamed', description: 'Note', agentId: b.id, isNameManuallyEdited: true } })
    expect(getAgentSession(session.id)?.session).toMatchObject({ id: runtime!.id, runtime: runtime!.runtime, provider_id: runtime!.provider_id, model: runtime!.model, status: runtime!.status })
    expect(getAgentSession(session.id)?.session.data.agentSession).not.toHaveProperty('snapshot')
    expect(send.mock.calls[0][1][0]).toMatchObject({ endpoint: '/agent-sessions', kind: 'projection' })
    send.mockClear()
    for (const patch of [{}, { name: 'Renamed' }, { description: 'Note', agentId: b.id }]) expect(request('PATCH', '/agent-sessions/' + session.id, patch).status).toBe(200)
    for (const patch of [{ model: 'p::m' }, { runtime: 'pi' }, { orderKey: 'n' }, { name: 'x'.repeat(256) }, { agentId: null }]) expect(request('PATCH', '/agent-sessions/' + session.id, patch).status).toBe(400)
    expect(request('PATCH', '/agent-sessions/' + session.id, { agentId: 'missing' }).status).toBe(404)
    expect(send).not.toHaveBeenCalled()
  })

  it('replaces workspace via the real repository, only before messages, with no directory creation', async () => {
    await initDatabase()
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-session-workdir-'))
    try {
      const user = request('POST', '/agent-workspaces', { path: outside }).data
      const session = create(owner().id).data, send = observe()
      const updated = request('PUT', '/agent-sessions/' + session.id + '/workspace', { type: 'user', workspaceId: user.id })
      expect(updated).toMatchObject({ status: 200, data: { workspaceId: user.id, workspace: user } })
      expect(getDatabase().exec('SELECT id FROM agent_workspaces WHERE id=?', [session.workspaceId])[0]?.values ?? []).toEqual([])
      expect(fs.readdirSync(outside)).toEqual([])
      expect(send).toHaveBeenCalledOnce()
      send.mockClear()
      expect(request('PUT', '/agent-sessions/' + session.id + '/workspace', { type: 'user', workspaceId: user.id }).status).toBe(200)
      expect(send).not.toHaveBeenCalled()
      getDatabase().run('INSERT INTO agent_session_events(id,session_id,sequence,type,data_json,created_at) VALUES (?,?,?,?,?,?)', ['message', session.id, 1, 'message', '{}', new Date().toISOString()])
      expect(request('PUT', '/agent-sessions/' + session.id + '/workspace', { type: 'system' })).toMatchObject({ status: 409, error: { code: 'INVALID_OPERATION' } })
      expect(send).not.toHaveBeenCalled()
    } finally { fs.rmSync(outside, { recursive: true, force: true }) }
  })

  it('retains the unmapped legacy409 fence alongside mapped rows and refuses unsupported mutations', async () => {
    await initDatabase()
    const agent = owner(), mapped = create(agent.id).data, legacy = createAgentSession({ runtime: 'pi', agentId: agent.id }), send = observe()
    expect(request('GET', '/agent-sessions').status).toBe(409)
    expect(request('GET', '/agent-sessions/latest', undefined, { agentId: agent.id }).status).toBe(409)
    expect(request('GET', '/agent-sessions/' + legacy.id).status).toBe(409)
    expect(request('GET', '/agent-sessions', undefined, { ids: [mapped.id] }).data.items[0].id).toBe(mapped.id)
    expect(request('POST', '/agent-sessions', { agentId: 'missing', name: '', workspace: { type: 'system' } }).status).toBe(404)
    expect(request('POST', '/agent-sessions', { agentId: agent.id, name: '', workspace: { type: 'system' }, runtime: 'opencode' }).status).toBe(400)
    expect(request('PUT', '/agent-sessions/' + mapped.id + '/workspace', { type: 'system', path: outsidePath() }).status).toBe(400)
    expect(request('PATCH', '/agent-sessions/' + mapped.id + '/order', { position: 'first' }).status).toBe(404)
    expect(send).not.toHaveBeenCalled()
  })
  function outsidePath() { return path.join(os.tmpdir(), 'must-not-be-written') }
})

describe('Cherry source reuse-or-create Agent session IPC', () => {
  const owner = () => blueprints.createAgentBlueprint({ type: 'pi', runtime: 'pi', name: 'Reuse owner', model: 'p::m' })
  const reuse = (input: unknown) => handleIpcApiRoute('ai.agent.session.reuse_or_create', input) as Promise<any>
  function observe() {
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ isDestroyed: () => false, webContents: { send } }] as unknown as BrowserWindow[])
    return send
  }
  const createBlank = (agentId: string, workspace: unknown = { type: 'system' }) => (handleRequest({ method: 'POST', path: '/agent-sessions', body: { agentId, name: '', workspace } }) as any).data

  it('creates once, reuses one identity, emits real monotonic activity changes and honors exclusion', async () => {
    await initDatabase()
    const agent = owner(), command = { agentId: agent.id, workspace: { type: 'system' } }, send = observe()
    const first = await reuse(command)
    expect(first).toMatchObject({ ok: true, data: { created: true, deletedDuplicateSessionIds: [] } })
    const id = first.data.session.id
    expect(first.data.session).not.toHaveProperty('runtime')
    expect(fs.existsSync(first.data.session.workspace.path)).toBe(false)
    expect(send).toHaveBeenCalledOnce()
    send.mockClear()
    getDatabase().run('UPDATE agent_session_read_model SET updated_at=?,last_activity_at=? WHERE id=?', ['2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z', id])
    const second = await reuse(command)
    expect(second).toMatchObject({ ok: true, data: { created: false, deletedDuplicateSessionIds: [], session: { id } } })
    expect(send.mock.calls[0][1][0]).toMatchObject({ endpoint: '/agent-sessions', kind: 'projection', entityIds: [id] })
    send.mockClear()
    getDatabase().run('UPDATE agent_session_read_model SET updated_at=?,last_activity_at=? WHERE id=?', ['2099-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', id])
    expect((await reuse(command)).data.session.id).toBe(id)
    expect(send).not.toHaveBeenCalled()
    expect(getDatabase().exec('SELECT count(*) FROM agent_session_read_model')[0].values[0][0]).toBe(1)
    const excluded = await reuse({ ...command, excludeSessionId: id })
    expect(excluded.data.created).toBe(true)
    expect(excluded.data.session.id).not.toBe(id)
    expect(getAgentSession(id)).not.toBeNull()
  })

  it('cleans only safe system duplicates while keeping user duplicates and all legacy data', async () => {
    await initDatabase()
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-reuse-user-'))
    try {
      const agent = owner(), a = createBlank(agent.id), b = createBlank(agent.id)
      const legacy = createAgentSession({ runtime: 'pi', agentId: agent.id, title: 'Legacy keep' })
      const beforeLegacy = getAgentSession(legacy.id)
      const send = observe(), result = await reuse({ agentId: agent.id, workspace: { type: 'system' } })
      expect(result.ok).toBe(true)
      expect(result.data.deletedDuplicateSessionIds).toHaveLength(1)
      const deleted = result.data.deletedDuplicateSessionIds[0]
      expect([a.id, b.id]).toContain(deleted)
      expect(getAgentSession(deleted)).toBeNull()
      expect(getAgentSession(legacy.id)).toEqual(beforeLegacy)
      expect(send.mock.calls[0][1][0]).toEqual({ endpoint: '/agent-sessions', kind: 'membership', entityIds: [result.data.session.id, deleted] })
      const user = (handleRequest({ method: 'POST', path: '/agent-workspaces', body: { path: outside } }) as any).data
      const one = createBlank(agent.id, { type: 'user', workspaceId: user.id }), two = createBlank(agent.id, { type: 'user', workspaceId: user.id })
      const userResult = await reuse({ agentId: agent.id, workspace: { type: 'user', workspaceId: user.id } })
      expect(userResult.data).toMatchObject({ created: false, deletedDuplicateSessionIds: [] })
      expect(getAgentSession(one.id)).not.toBeNull()
      expect(getAgentSession(two.id)).not.toBeNull()
      expect(fs.readdirSync(outside)).toEqual([])
    } finally { fs.rmSync(outside, { recursive: true, force: true }) }
  })

  it('returns typed unsafe purge refusal and rolls back deletion/touch without effects', async () => {
    await initDatabase()
    const agent = owner(), first = createBlank(agent.id), second = createBlank(agent.id)
    getDatabase().run('UPDATE agent_session_read_model SET updated_at=? WHERE id=?', ['2000-01-01T00:00:00.000Z', first.id])
    getDatabase().run('UPDATE agent_session_read_model SET updated_at=? WHERE id=?', ['2099-01-01T00:00:00.000Z', second.id])
    getDatabase().run('INSERT INTO agent_session_events(id,session_id,sequence,type,data_json,created_at) VALUES (?,?,?,?,?,?)', ['history', first.id, 1, 'status', '{}', new Date().toISOString()])
    const send = observe(), command = { agentId: agent.id, workspace: { type: 'system' } }
    expect(await reuse(command)).toMatchObject({ ok: false, error: { code: 'AGENT_SESSION_READ_MODEL_UNSAFE_PLACEHOLDER_PURGE' } })
    expect(getAgentSession(first.id)).not.toBeNull()
    expect(send).not.toHaveBeenCalled()
    getDatabase().run('DELETE FROM agent_session_events WHERE id=?', ['history'])
    getDatabase().exec("CREATE TRIGGER reject_reuse BEFORE UPDATE OF last_activity_at ON agent_session_read_model BEGIN SELECT RAISE(ABORT,'touch failure'); END;")
    expect(await reuse(command)).toMatchObject({ ok: false, error: { code: 'INTERNAL' } })
    expect(getAgentSession(first.id)).not.toBeNull()
    expect(getAgentSession(second.id)).not.toBeNull()
    expect(send).not.toHaveBeenCalled()
  })

  it.each([null, [], {}, { agentId: 'missing', workspace: { type: 'system' } },
    { agentId: '', workspace: { type: 'system' } }, { workspace: { type: 'system' }, runtime: 'pi' },
    { workspace: { type: 'system', path: 'made-up' } }, { workspace: { type: 'system' }, excludeSessionId: '' },
    { workspace: { type: 'system' }, skillIds: [] }])('rejects invalid or unsupported reuse command %j without effects', async extra => {
    await initDatabase()
    const agent = owner(), send = observe()
    const input = extra === null || Array.isArray(extra) ? extra : { agentId: agent.id, ...extra }
    expect(await reuse(input)).toMatchObject({ ok: false })
    expect(getDatabase().exec('SELECT count(*) FROM agent_session_read_model')[0].values[0][0]).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('Cherry source Agent message read facade transport', () => {
  const request = (path: string, params?: Record<string, unknown>) => handleRequest({ path, params }) as any
  function mapped() {
    const agent = blueprints.createAgentBlueprint({ type: 'pi', runtime: 'pi', name: 'Messages', model: 'p::m' })
    return (handleRequest({ method: 'POST', path: '/agent-sessions', body: { agentId: agent.id, name: '', workspace: { type: 'system' } } }) as any).data
  }
  function event(sessionId: string, id: string, sequence: number, type: string, data: unknown) {
    getDatabase().run('INSERT INTO agent_session_events(id,session_id,sequence,type,data_json,created_at) VALUES (?,?,?,?,?,?)', [id, sessionId, sequence, type, JSON.stringify(data), '2026-01-01T00:00:00.000Z'])
  }
  it('reads actual text/tool/error messages with cursor anchors, nullable metadata and no read effects', async () => {
    await initDatabase()
    const session = mapped(), base = '/agent-sessions/' + session.id + '/messages'
    expect(request(base).data).toEqual({ items: [] })
    event(session.id, 'user', 1, 'message', { role: 'user', content: 'Actual user text' })
    event(session.id, 'call', 2, 'tool-call', { callId: 'native-call', name: 'real-tool', input: { query: 'test' } })
    event(session.id, 'result', 3, 'tool-result', { callId: 'native-call', output: { answer: 'Actual result' } })
    event(session.id, 'error', 4, 'error', { message: 'Actual error' })
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ isDestroyed: () => false, webContents: { send } }] as unknown as BrowserWindow[])
    const page = request(base + '?limit=1&deferToolOutputs=true')
    expect(page.status).toBe(200)
    expect(page.data.items[0]).toMatchObject({ id: 'error', status: 'error', modelId: null, messageSnapshot: null, stats: null, runtimeResumeToken: null })
    const next = request(base, { cursor: page.data.nextCursor, limit: '1' })
    expect(next.data.items[0]).toMatchObject({ id: 'call', data: { parts: [{ type: 'dynamic-tool', toolCallId: 'native-call', state: 'output-available', output: { answer: 'Actual result' } }] } })
    expect(request(base + '/call').data).toEqual(next.data.items[0])
    expect(request(base, { messageId: 'user' }).data.items.map((message: any) => message.id)).toEqual(['user'])
    expect(request(base + '/missing').status).toBe(404)
    expect(send).not.toHaveBeenCalled()
  })
  it('refuses unsupported history, unmapped legacy and background rather than silently empty', async () => {
    await initDatabase()
    const session = mapped(), base = '/agent-sessions/' + session.id + '/messages'
    event(session.id, 'permission', 1, 'permission', { token: 'private-secret' })
    const failure = request(base)
    expect(failure.status).toBe(409)
    expect(failure.data).toBeUndefined()
    expect(JSON.stringify(failure)).not.toContain('private-secret')
    expect(request(base + '/permission').status).toBe(409)
    const legacy = createAgentSession({ runtime: 'pi' })
    expect(request('/agent-sessions/' + legacy.id + '/messages').status).toBe(409)
    getDatabase().run("UPDATE agent_session_read_model SET type='background' WHERE id=?", [session.id])
    expect(request(base).status).toBe(404)
    expect(request('/agent-sessions/missing/messages').status).toBe(404)
  })
  it.each([{ limit: 0 }, { limit: 201 }, { limit: 'bad' }, { messageId: '' }, { cursor: 42 }, { deferToolOutputs: 'true' }, { runtime: 'pi' }])('validates strict message query %j', async params => {
    await initDatabase()
    const session = mapped()
    expect(request('/agent-sessions/' + session.id + '/messages', params).status).toBe(400)
  })
  it('keeps message mutation/send routes unbridged and rejects bad URL encoding', async () => {
    await initDatabase()
    const session = mapped(), base = '/agent-sessions/' + session.id + '/messages'
    expect(request(base + '/%ZZ').status).toBe(400)
    expect(request(base + '?limit=1&limit=2').status).toBe(400)
    for (const method of ['POST', 'PATCH', 'DELETE']) expect((handleRequest({ method, path: base + '/message', body: {} }) as any).status).toBe(404)
  })
})

describe('Cherry source ai.agent.create storage-only command', () => {
  const command = { type: 'pi', name: 'Created through IPC', model: 'provider::model::variant' }
  async function setup() {
    await initDatabase()
    runtimeRegistry.registerBuiltInAgentRuntimes()
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ isDestroyed: () => false, webContents: { send } }] as unknown as BrowserWindow[])
    return send
  }

  it('creates a real pi blueprint, returns the source DTO and emits membership only after commit', async () => {
    const send = await setup(), create = vi.spyOn(blueprints, 'createAgentBlueprint')
    const input = {
      ...command, description: '', instructions: 'Help', planModel: 'p::plan', smallModel: 'p::small',
      mcps: ['mcp'], knowledgeBaseIds: ['kb', 'kb'], disabledTools: ['Read', 'Read'], skillIds: [],
      configuration: { avatar: 'P', language: ' Thai ', reasoning_effort: 'high' }
    }
    const response = await handleIpcApiRoute('ai.agent.create', input)
    expect(response).toMatchObject({ ok: true, data: { type: 'pi', name: command.name, model: command.model, modelName: null } })
    const data = response.data as any
    expect(data.id).toEqual(expect.any(String))
    expect(data).not.toHaveProperty('runtime')
    expect(data).not.toHaveProperty('skillIds')
    expect(create).toHaveBeenCalledExactlyOnceWith({
      type: 'pi', runtime: 'pi', name: command.name, model: command.model, description: '', instructions: 'Help',
      planModel: 'p::plan', smallModel: 'p::small', mcps: ['mcp'], knowledgeBaseIds: ['kb'], disabledTools: ['Read'],
      configuration: { avatar: 'P', language: 'Thai', reasoning_effort: 'high' }
    })
    expect(blueprints.getAgentBlueprint(data.id)).toMatchObject({ id: data.id, type: 'pi', runtime: 'pi', name: command.name })
    expect((handleRequest({ path: '/agents/' + data.id }) as any).data).toEqual(data)
    expect((handleRequest({ path: '/agents', params: { ids: [data.id] } }) as any).data.items).toEqual([data])
    expect(send).toHaveBeenCalledExactlyOnceWith('data-api:data-changed', [{ endpoint: '/agents', kind: 'membership', entityIds: [data.id] }])
    // No runtime/workspace/session provisioning is part of this storage slice.
    expect(getDatabase().exec('SELECT count(*) FROM agent_sessions')[0].values[0][0]).toBe(0)
    expect(getDatabase().exec('SELECT count(*) FROM ai_sessions')[0].values[0][0]).toBe(0)
  })

  it.each([
    null, [], {}, { ...command, name: '' }, { ...command, model: null },
    { ...command, model: 'bare-model' }, { ...command, model: 'p::model?bad' },
    { ...command, planModel: null }, { ...command, smallModel: null },
    { ...command, type: null }, { ...command, type: 'opencode' },
    { ...command, skillIds: [''] }, { ...command, configuration: { language: '  ' } }
  ])('rejects invalid source creation %j without effects', async input => {
    const send = await setup(), create = vi.spyOn(blueprints, 'createAgentBlueprint')
    expect(await handleIpcApiRoute('ai.agent.create', input)).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
    expect(create).not.toHaveBeenCalled()
    expect(blueprints.listAgentBlueprints().total).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })

  it.each([
    { skillIds: ['skill'] }, { runtime: 'codex' }, { id: 'assigned' }, { orderKey: 'first' },
    { modelName: 'fake' }, { skillUpdates: [] }, { workspace: {} },
    { configuration: { env_vars: { TOKEN: 'secret' } } },
    { configuration: { builtin_role: 'assistant' } }
  ])('refuses unsupported creation fields %j without partial writes', async extra => {
    const send = await setup(), create = vi.spyOn(blueprints, 'createAgentBlueprint')
    const response = await handleIpcApiRoute('ai.agent.create', { ...command, ...extra })
    expect(response).toMatchObject({ ok: false, error: { code: 'AGENT_SOURCE_FIELD_UNSUPPORTED' } })
    expect(JSON.stringify(response)).not.toContain('secret')
    expect(create).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it.each(['claude-code', 'dsh'])('refuses unavailable source type %s rather than substituting another runtime', async type => {
    const send = await setup(), create = vi.spyOn(blueprints, 'createAgentBlueprint')
    expect(await handleIpcApiRoute('ai.agent.create', { ...command, type })).toMatchObject({ ok: false, error: { code: 'AGENT_SOURCE_RUNTIME_UNAVAILABLE' } })
    expect(create).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses pi if its runtime is not registered and does not instantiate a runtime', async () => {
    const send = await setup(), create = vi.spyOn(blueprints, 'createAgentBlueprint'), launch = vi.spyOn(runtimeRegistry, 'createAgentRuntime')
    vi.spyOn(runtimeRegistry, 'hasAgentRuntime').mockReturnValue(false)
    expect(await handleIpcApiRoute('ai.agent.create', command)).toMatchObject({ ok: false, error: { code: 'AGENT_SOURCE_RUNTIME_UNAVAILABLE' } })
    expect(create).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('does not emit effects when creation fails, and does not expose DataApi POST', async () => {
    const send = await setup()
    vi.spyOn(blueprints, 'createAgentBlueprint').mockImplementationOnce(() => { throw new Error('storage unavailable') })
    expect(await handleIpcApiRoute('ai.agent.create', command)).toMatchObject({ ok: false, error: { code: 'INTERNAL' } })
    expect(send).not.toHaveBeenCalled()
    expect((handleRequest({ method: 'POST', path: '/agents', body: command }) as any).status).toBe(404)
    expect(blueprints.listAgentBlueprints().total).toBe(0)
  })
})

describe('Cherry authoritative registered model detail', () => {
  const read = (path: string, params?: Record<string, unknown>) => handleRequest({ path, params }) as any
  it('shares the source list projection, decodes IDs once and splits on the first separator', async () => {
    await initDatabase()
    seedProvider('provider', 'Registered provider', 'https://example.invalid', 'never-leak-key')
    const ids = ['plain', 'vendor/model::variant', 'unicode-模型', 'percent%2Fmodel']
    getDatabase().run('UPDATE providers SET models=? WHERE id=?', [JSON.stringify(ids), 'provider'])
    const list = read('/models', { providerId: 'provider' })
    expect(list.data).toHaveLength(4)
    for (const modelId of ids) {
      const uniqueId = 'provider::' + modelId
      const detail = read('/models/' + encodeURIComponent(uniqueId))
      expect(detail).toMatchObject({ status: 200, data: { id: uniqueId, providerId: 'provider', apiModelId: modelId,
        name: modelId, capabilities: [], supportsStreaming: false, isEnabled: true, isHidden: false } })
      expect(detail.data).toEqual(list.data.find((model: any) => model.id === uniqueId))
      expect(Object.keys(detail.data).sort()).toEqual(['id', 'providerId', 'apiModelId', 'name', 'group', 'capabilities', 'supportsStreaming', 'isEnabled', 'isHidden'].sort())
      expect(JSON.stringify(detail)).not.toContain('never-leak-key')
    }
    expect(read('/models/provider::vendor/model::variant').data.apiModelId).toBe('vendor/model::variant')
    expect(read('/models?providerId=provider').data).toEqual(list.data)
    expect(read('/models?providerId=missing').data).toEqual([])
    expect(read('/models', { providerId: 42 }).status).toBe(400)
  })

  it('returns validation/missing errors without fabricating phantom models or CRUD', async () => {
    await initDatabase()
    seedProvider('provider', 'Provider', '', 'secret')
    for (const id of ['provider::phantom', 'missing::gpt-4o', '::gpt-4o', 'provider::']) expect(read('/models/' + encodeURIComponent(id)).status).toBe(404)
    expect(read('/models/bare-id').status).toBe(400)
    expect(read('/models/%ZZ').status).toBe(400)
    for (const method of ['POST', 'PATCH', 'DELETE']) expect((handleRequest({ method, path: '/models/provider::gpt-4o', body: {} }) as any).status).toBe(404)
    expect((handleRequest({ method: 'POST', path: '/models', body: [] }) as any).status).toBe(404)
  })

  it('does not coerce corrupted catalog objects into invented IDs or emit read effects', async () => {
    await initDatabase()
    seedProvider('provider', 'Provider', '', 'secret')
    getDatabase().run('UPDATE providers SET models=? WHERE id=?', [JSON.stringify(['real', 'real', '', { id: 'fake', token: 'catalog-secret' }, null]), 'provider'])
    const send = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ isDestroyed: () => false, webContents: { send } }] as unknown as BrowserWindow[])
    expect(read('/models').data.map((model: any) => model.id)).toEqual(['provider::real'])
    expect(read('/models/provider::real').status).toBe(200)
    expect(read('/models/provider::fake').status).toBe(404)
    expect(JSON.stringify(read('/models'))).not.toContain('catalog-secret')
    expect(send).not.toHaveBeenCalled()
  })
})

describe('Cherry DataApi provider transport', () => {
  it('lists providers in the source Provider shape with masked keys only', async () => {
    await initDatabase()
    seedProvider('pvd_a', 'OpenAI', 'https://api.openai.com/v1', 'sk-secret', true)
    const response = handleRequest({ id: 'r1', method: 'GET', path: '/providers' }) as any
    expect(response.status).toBe(200)
    expect(response.data).toHaveLength(1)
    const provider = response.data[0]
    expect(provider).toMatchObject({ id: 'pvd_a', name: 'OpenAI', authType: 'api-key', isEnabled: true, defaultChatEndpoint: 'openai' })
    expect(provider.apiKeys).toHaveLength(1)
    expect(provider.apiKeys[0].key).not.toContain('sk-secret')
    expect(JSON.stringify(response.data)).not.toContain('sk-secret')
  })

  it('reads one provider, updates name/baseUrl/enabled, and reports missing providers', async () => {
    await initDatabase()
    seedProvider('pvd_a', 'OpenAI', 'https://old.example/v1', 'sk-1')

    const get = handleRequest({ id: 'r', method: 'GET', path: '/providers/pvd_a' }) as any
    expect(get.data.endpointConfigs.openai.baseUrl).toBe('https://old.example/v1')

    const patch = handleRequest({
      id: 'r', method: 'PATCH', path: '/providers/pvd_a',
      body: { name: '新名字', isEnabled: true, endpointConfigs: { openai: { baseUrl: 'https://new.example/v1' } } }
    }) as any
    expect(patch.status).toBe(200)

    const after = handleRequest({ id: 'r', method: 'GET', path: '/providers/pvd_a' }) as any
    expect(after.data.name).toBe('新名字')
    expect(after.data.endpointConfigs.openai.baseUrl).toBe('https://new.example/v1')

    const missing = handleRequest({ id: 'r', method: 'GET', path: '/providers/missing' }) as any
    expect(missing.status).toBe(404)
    expect(missing.error.code).toBe('NOT_FOUND')
  })

  it('creates and deletes providers through the source routes', async () => {
    await initDatabase()
    const created = handleRequest({ id: 'r', method: 'POST', path: '/providers', body: { providerId: 'pvd_new', name: '新 Provider' } }) as any
    expect(created.status).toBe(201)
    expect(created.data).toMatchObject({ id: 'pvd_new', name: '新 Provider' })

    const duplicate = handleRequest({ id: 'r', method: 'POST', path: '/providers', body: { providerId: 'pvd_new', name: '重复' } }) as any
    expect(duplicate.status).toBe(409)

    const removed = handleRequest({ id: 'r', method: 'DELETE', path: '/providers/pvd_new' }) as any
    expect(removed.status).toBe(200)
    expect((handleRequest({ id: 'r', method: 'GET', path: '/providers/pvd_new' }) as any).status).toBe(404)
  })

  it('runs the provider deep-link import against real provider writes', async () => {
    await initDatabase()
    // The payload `useProviderDeepLinkImport` builds for a NEW provider.
    const created = handleRequest({
      id: 'r', method: 'POST', path: '/providers',
      body: {
        providerId: 'pvd_deeplink', name: 'Deep Link', defaultChatEndpoint: 'openai-response',
        endpointConfigs: { 'openai-response': { baseUrl: 'https://dl.invalid/v1' } }
      }
    }) as any
    expect(created.status).toBe(201)
    // The endpoint and protocol from the deep link are persisted, not dropped.
    expect(created.data.defaultChatEndpoint).toBe('openai-response')
    expect(created.data.endpointConfigs['openai-response'].baseUrl).toBe('https://dl.invalid/v1')

    // The key is added through the api-keys route and actually stored (encrypted).
    const withKey = handleRequest({
      id: 'r', method: 'POST', path: '/providers/pvd_deeplink/api-keys', body: { key: 'sk-deeplink' }
    }) as any
    expect(withKey.status).toBe(201)
    // Returns the parent Provider per the source contract, with the key masked.
    expect(withKey.data.id).toBe('pvd_deeplink')
    expect(withKey.data.apiKeys).toHaveLength(1)
    // The key reached the store through the same encrypt path the Grimoire save uses
    // (this mock has no OS keyring, so encryption falls back to plaintext — what matters
    // is that the write happened at all and the read back stays masked).
    const stored = getDatabase().exec('SELECT api_key FROM providers WHERE id=?', ['pvd_deeplink'])[0].values[0][0] as string
    expect(stored).toBe('sk-deeplink')
    const readBack = handleRequest({ id: 'r', method: 'GET', path: '/providers/pvd_deeplink' }) as any
    expect(JSON.stringify(readBack)).not.toContain('sk-deeplink')

    // A PATCH (the update branch of the same import) also returns the Provider.
    const patched = handleRequest({
      id: 'r', method: 'PATCH', path: '/providers/pvd_deeplink',
      body: { name: 'Deep Link 2', defaultChatEndpoint: 'openai' }
    }) as any
    expect(patched.data).toMatchObject({ name: 'Deep Link 2', defaultChatEndpoint: 'openai' })

    // A key-less POST is rejected rather than clearing the stored key.
    const empty = handleRequest({ id: 'r', method: 'POST', path: '/providers/pvd_deeplink/api-keys', body: { key: '  ' } }) as any
    expect(empty.status).toBe(400)
  })

  it('serves api-keys and auth-config reads without leaking the stored secret', async () => {
    await initDatabase()
    seedProvider('pvd_a', 'OpenAI', 'https://api.openai.com/v1', 'sk-secret')

    const keys = handleRequest({ id: 'r', method: 'GET', path: '/providers/pvd_a/api-keys' }) as any
    expect(keys.data.keys).toHaveLength(1)
    expect(JSON.stringify(keys)).not.toContain('sk-secret')

    const auth = handleRequest({ id: 'r', method: 'GET', path: '/providers/pvd_a/auth-config' }) as any
    expect(auth.status).toBe(200)
    expect(auth.data).toBeNull()

    const authLogin = handleRequest({ id: 'r', method: 'GET', path: '/providers/pvd_b/auth-config' }) as any
    expect(authLogin.status).toBe(404)
  })

  it('lists, creates, updates and reads MCP servers in the source shape', async () => {
    await initDatabase()
    const created = handleRequest({ id: 'r', method: 'POST', path: '/mcp-servers', body: { name: '本地工具', type: 'stdio', command: 'node', args: ['server.js'] } }) as any
    expect(created.status).toBe(201)
    expect(created.data).toMatchObject({ name: '本地工具', type: 'stdio', command: 'node', isActive: true })

    const list = handleRequest({ id: 'r', method: 'GET', path: '/mcp-servers' }) as any
    expect(list.data.items).toHaveLength(1)
    expect(list.data.total).toBe(1)

    const serverId = created.data.id as string
    const patched = handleRequest({ id: 'r', method: 'PATCH', path: '/mcp-servers/' + serverId, body: { name: '改名', isActive: false } }) as any
    expect(patched.data).toMatchObject({ name: '改名', isActive: false })

    const tools = handleRequest({ id: 'r', method: 'GET', path: '/mcp-servers/' + serverId + '/tools' }) as any
    expect(tools.data.tools).toEqual([])

    const missing = handleRequest({ id: 'r', method: 'GET', path: '/mcp-servers/missing' }) as any
    expect(missing.status).toBe(404)
  })

  it('projects the HTTP transport as the source streamableHttp type, not the Grimoire name', async () => {
    await initDatabase()
    const created = handleRequest({ id: 'r', method: 'POST', path: '/mcp-servers', body: { name: '远端', type: 'streamableHttp', baseUrl: 'https://m.invalid/mcp' } }) as any
    // The source detail form validates `serverType` against `stdio|sse|streamableHttp|inMemory`;
    // emitting the raw Grimoire 'http' made every save fail validation.
    expect(created.data.type).toBe('streamableHttp')
    expect(created.data.baseUrl).toBe('https://m.invalid/mcp')

    // A full-form PATCH (the shape the source detail page sends) round-trips.
    const patched = handleRequest({
      id: 'r', method: 'PATCH', path: '/mcp-servers/' + created.data.id,
      body: { name: '远端', type: 'streamableHttp', baseUrl: 'https://m2.invalid/mcp', command: '', args: [], env: {}, isActive: true }
    }) as any
    expect(patched.status).toBe(200)
    expect(patched.data).toMatchObject({ type: 'streamableHttp', baseUrl: 'https://m2.invalid/mcp' })
  })

  it('inverts the source disabledTools denylist against the Grimoire allowlist', async () => {
    await initDatabase()
    const created = handleRequest({ id: 'r', method: 'POST', path: '/mcp-servers', body: { name: '工具集', type: 'stdio', command: 'node' } }) as any
    const serverId = created.data.id as string
    // A connected server with two tools and an empty allowlist: both disabled.
    getDatabase().run('UPDATE mcp_servers SET status=?, tools_json=?, enabled_tools_json=? WHERE id=?', [
      'connected',
      JSON.stringify([{ name: 'alpha' }, { name: 'beta' }]),
      JSON.stringify([]),
      serverId
    ])
    const allDisabled = handleRequest({ id: 'r', method: 'GET', path: '/mcp-servers/' + serverId }) as any
    expect(allDisabled.data.disabledTools).toEqual(['alpha', 'beta'])

    const enabled = handleRequest({
      id: 'r', method: 'PATCH', path: '/mcp-servers/' + serverId, body: { disabledTools: ['beta'] }
    }) as any
    expect(enabled.data.disabledTools).toEqual(['beta'])
    // The inverted write persisted through the allowlist the registry reads.
    const stored = listMcpServers().find(server => server.id === serverId)!
    expect(stored.enabled_tools).toEqual(['alpha'])
  })

  it('persists the detail form description/headers/timeout and rejects a field with no column', async () => {
    await initDatabase()
    const created = handleRequest({ id: 'r', method: 'POST', path: '/mcp-servers', body: { name: '服务', type: 'streamableHttp', baseUrl: 'https://h.invalid/mcp' } }) as any
    const serverId = created.data.id as string

    const saved = handleRequest({
      id: 'r', method: 'PATCH', path: '/mcp-servers/' + serverId,
      body: { name: '服务', description: '本地工具服务', headers: { Authorization: 'Bearer x' }, timeout: 90 }
    }) as any
    expect(saved.status).toBe(200)
    expect(saved.data.description).toBe('本地工具服务')
    expect(saved.data.timeout).toBe(90)

    // Read with secrets: the renderer-facing list masks env/headers values.
    const stored = listMcpServers(true).find(server => server.id === serverId)!
    expect(stored.description).toBe('本地工具服务')
    expect(stored.headers).toEqual({ Authorization: 'Bearer x' })
    expect(stored.timeout_seconds).toBe(90)

    // The renderer-facing reads mask the header value while keeping the key visible.
    const masked = handleRequest({ id: 'r', method: 'GET', path: '/mcp-servers/' + serverId }) as any
    expect(Object.keys(masked.data.headers)).toEqual(['Authorization'])
    expect(masked.data.headers.Authorization).not.toContain('Bearer x')
    // A save that echoes the mask back restores the stored secret rather than persisting it.
    handleRequest({ id: 'r', method: 'PATCH', path: '/mcp-servers/' + serverId, body: { headers: { Authorization: masked.data.headers.Authorization } } })
    expect(listMcpServers(true).find(server => server.id === serverId)!.headers).toEqual({ Authorization: 'Bearer x' })

    // A field with no column AND no reason to be echoed is rejected when it carries a
    // real value rather than silently dropped. After v25 every server *config* field the
    // source schema declares is either stored or echoed-only, so the remaining
    // rejectable surface is the identity/timestamp group — which the renderer must not
    // be able to set. (`longRunning`/`registryUrl`/`tags` moved into the storable set
    // in v25; see the dedicated round-trip test below.)
    const rejected = handleRequest({
      id: 'r', method: 'PATCH', path: '/mcp-servers/' + serverId, body: { createdAt: '2000-01-01T00:00:00.000Z' }
    }) as any
    expect(rejected.status).toBe(500)
    expect(rejected.error.message).toContain('MCP_FIELD_UNSUPPORTED')
    expect(rejected.error.message).toContain('createdAt')
  })

  it('round-trips the v25 detail-form fields that drive real runtime behaviour', async () => {
    await initDatabase()
    const created = handleRequest({ id: 'r', method: 'POST', path: '/mcp-servers', body: { name: '长期服务', type: 'stdio', command: 'npx' } }) as any
    const serverId = created.data.id as string

    const saved = handleRequest({
      id: 'r', method: 'PATCH', path: '/mcp-servers/' + serverId,
      body: { longRunning: true, registryUrl: 'https://registry.npmmirror.com', tags: ['检索', '  ', '文档'] }
    }) as any
    expect(saved.status).toBe(200)
    // The projection returns them so the form round-trips without losing state.
    expect(saved.data.longRunning).toBe(true)
    expect(saved.data.registryUrl).toBe('https://registry.npmmirror.com')
    expect(saved.data.tags).toEqual(['检索', '文档'])

    const stored = listMcpServers(true).find(server => server.id === serverId)!
    expect(stored.long_running).toBe(true)
    expect(stored.registry_url).toBe('https://registry.npmmirror.com')
    // Blank tags are dropped, not stored as empty search noise.
    expect(stored.tags).toEqual(['检索', '文档'])

    // `longRunning: false` is a meaningful value (the switch is off), so it must be
    // emitted rather than omitted, and must persist as an explicit false.
    const cleared = handleRequest({
      id: 'r', method: 'PATCH', path: '/mcp-servers/' + serverId, body: { longRunning: false }
    }) as any
    expect(cleared.data.longRunning).toBe(false)
    expect(listMcpServers(true).find(server => server.id === serverId)!.long_running).toBe(false)
    // Untouched fields survive the partial save.
    expect(listMcpServers(true).find(server => server.id === serverId)!.registry_url).toBe('https://registry.npmmirror.com')
  })

  it('round-trips the tools tab auto-approve suppression', async () => {
    await initDatabase()
    const created = handleRequest({ id: 'r', method: 'POST', path: '/mcp-servers', body: { name: '工具服务', type: 'stdio', command: 'node' } }) as any
    const serverId = created.data.id as string

    const saved = handleRequest({
      id: 'r', method: 'PATCH', path: '/mcp-servers/' + serverId,
      body: { disabledAutoApproveTools: ['bash'] }
    }) as any
    expect(saved.status).toBe(200)
    expect(saved.data.disabledAutoApproveTools).toEqual(['bash'])
    // Persisted through the v24 column, so the setting survives a reload.
    expect(listMcpServers().find(server => server.id === serverId)!.disabled_auto_approve_tools).toEqual(['bash'])

    const listed = handleRequest({ id: 'r', method: 'GET', path: '/mcp-servers' }) as any
    expect(listed.data.items[0].disabledAutoApproveTools).toEqual(['bash'])
  })

  it('accepts the source detail page full-object save payload', async () => {
    await initDatabase()
    const created = handleRequest({ id: 'r', method: 'POST', path: '/mcp-servers', body: { name: '详情服务', type: 'streamableHttp', baseUrl: 'https://d.invalid/mcp' } }) as any
    // The source detail page sends `{...server, ...toMcpServerFields(values)}` — the
    // whole entity, including fields Grimoire has no column for, at their empty
    // defaults. A save that changed nothing must not be rejected.
    const response = handleRequest({
      id: 'r', method: 'PATCH', path: '/mcp-servers/' + created.data.id,
      body: {
        name: '详情服务', type: 'streamableHttp', baseUrl: 'https://d.invalid/mcp', command: '', args: [], env: {},
        isActive: true, disabledTools: [], sortOrder: 0,
        description: '', headers: {}, timeout: undefined, longRunning: false, registryUrl: '',
        provider: '', providerUrl: '', logoUrl: '', tags: [], installSource: 'manual'
      }
    }) as any
    expect(response.status).toBe(200)
    expect(response.data).toMatchObject({ name: '详情服务', type: 'streamableHttp', baseUrl: 'https://d.invalid/mcp' })
  })

  it('clears the endpoint when a server switches from HTTP to stdio', async () => {
    await initDatabase()
    const created = handleRequest({ id: 'r', method: 'POST', path: '/mcp-servers', body: { name: '切换', type: 'streamableHttp', baseUrl: 'https://s.invalid/mcp' } }) as any
    const switched = handleRequest({
      id: 'r', method: 'PATCH', path: '/mcp-servers/' + created.data.id,
      body: { name: '切换', type: 'stdio', baseUrl: '', command: 'node', args: ['server.js'], isActive: true }
    }) as any
    // The projection only exposes the fields of the active transport, so the stale
    // endpoint must not leak into the stdio view.
    expect(switched.data.type).toBe('stdio')
    expect(switched.data.command).toBe('node')
    expect(switched.data.baseUrl).toBeUndefined()
  })

  it('honors the source list query filters the detail hook reads through', async () => {
    await initDatabase()
    handleRequest({ id: 'r', method: 'POST', path: '/mcp-servers', body: { name: 'A', type: 'http', baseUrl: 'https://a.invalid/sse' } })
    const b = handleRequest({ id: 'r', method: 'POST', path: '/mcp-servers', body: { name: 'B', type: 'stdio', command: 'node', isActive: false } }) as any

    // `useMcpServer(id)` reads the detail via the list route with `params.id`;
    // ignoring the filter would surface a different server's detail.
    const byId = handleRequest({ id: 'r', method: 'GET', path: '/mcp-servers', params: { id: b.data.id } }) as any
    expect(byId.data.items).toHaveLength(1)
    expect(byId.data.items[0].name).toBe('B')

    const activeOnly = handleRequest({ id: 'r', method: 'GET', path: '/mcp-servers', params: { isActive: true } }) as any
    expect(activeOnly.data.items.map((item: any) => item.name)).toEqual(['A'])

    const stdioOnly = handleRequest({ id: 'r', method: 'GET', path: '/mcp-servers', params: { type: 'stdio' } }) as any
    expect(stdioOnly.data.items.map((item: any) => item.name)).toEqual(['B'])
  })

  it('rejects the unbacked MCP reorder route instead of a fake success', async () => {
    await initDatabase()
    const response = handleRequest({ id: 'r', method: 'PATCH', path: '/mcp-servers', body: { orderedIds: ['a', 'b'] } }) as any
    expect(response.status).toBe(400)
    expect(response.error.message).toContain('未桥接')
  })

  it('rejects MCP creation without a name', async () => {
    await initDatabase()
    const response = handleRequest({ id: 'r', method: 'POST', path: '/mcp-servers', body: {} }) as any
    expect(response.status).toBe(500)
    expect(response.error.message).toContain('MCP_NAME_REQUIRED')
  })
  it('serves the MCP ipcApi lifecycle routes in the source IpcResult envelope', async () => {
    await initDatabase()
    const created = handleRequest({ id: 'r', method: 'POST', path: '/mcp-servers', body: { name: '本地工具', type: 'stdio', command: 'node' } }) as any
    const serverId = created.data.id as string

    // stop / remove follow the source `z.void()` outputs → `null`, never undefined.
    const stopped = await handleIpcApiRoute('mcp.server.stop', { serverId })
    expect(stopped).toEqual({ ok: true, data: null })

    const missing = await handleIpcApiRoute('mcp.server.stop', { serverId: 'nope' })
    expect(missing).toMatchObject({ ok: false })
    expect((missing.error as any).code).toBe('NOT_FOUND')

    // list_prompts / list_resources / get_logs answer the raw protocol arrays the
    // source consumes untyped (`z.any()`), not an `{items}` wrapper.
    expect(await handleIpcApiRoute('mcp.server.list_prompts', { serverId })).toEqual({ ok: true, data: [] })
    expect(await handleIpcApiRoute('mcp.server.list_resources', { serverId })).toEqual({ ok: true, data: [] })
    expect(await handleIpcApiRoute('mcp.server.get_logs', { serverId })).toEqual({ ok: true, data: [] })
    // Grimoire has no server version; the source contract's "unknown" is null.
    expect(await handleIpcApiRoute('mcp.server.get_version', { serverId })).toEqual({ ok: true, data: null })

    const removed = await handleIpcApiRoute('mcp.server.remove', { serverId })
    expect(removed).toEqual({ ok: true, data: null })
    expect((handleRequest({ id: 'r', method: 'GET', path: '/mcp-servers/' + serverId }) as any).status).toBe(404)
  })

  it('rejects a failed MCP connect instead of resolving the refresh_tools route', async () => {
    await initDatabase()
    // http transport with no endpoint → connectMcpServer records `failed` without throwing.
    const created = handleRequest({ id: 'r', method: 'POST', path: '/mcp-servers', body: { name: '断链服务', type: 'http' } }) as any
    const serverId = created.data.id as string

    const refreshed = await handleIpcApiRoute('mcp.server.refresh_tools', { serverId })
    expect(refreshed.ok).toBe(false)
    expect((refreshed.error as any).code).toBe('MCP_CONNECT_FAILED')

    // check_connectivity reports the same failure as a real probe result, not an error.
    const connectivity = await handleIpcApiRoute('mcp.server.check_connectivity', { serverId })
    expect(connectivity).toEqual({ ok: true, data: false })

    const missing = await handleIpcApiRoute('mcp.server.refresh_tools', { serverId: 'nope' })
    expect((missing.error as any).code).toBe('NOT_FOUND')
  })

  it('gates the shell routes on the same validation as the Grimoire system IPC', async () => {
    await initDatabase()
    // A non-web scheme and a missing path are both rejected without touching the OS.
    expect(await handleIpcApiRoute('system.shell.open_website', 'file:///etc/passwd')).toMatchObject({
      ok: false, error: { code: 'INVALID_URL' }
    })
    expect(await handleIpcApiRoute('system.shell.open_path', path.join(testRoot, 'missing.txt'))).toMatchObject({
      ok: false, error: { code: 'NOT_FOUND' }
    })
    expect(await handleIpcApiRoute('system.shell.open_path', '')).toMatchObject({
      ok: false, error: { code: 'INVALID_PATH' }
    })
  })

  it('serves the appearance zoom route with the source bounds and reset semantics', async () => {
    await initDatabase()
    // A pure read (delta 0) returns the stored factor without changing windows.
    expect(await handleIpcApiRoute('app.adjust_zoom', { delta: 0 })).toEqual({ ok: true, data: 1 })
    // Reset writes 1.
    expect(await handleIpcApiRoute('app.adjust_zoom', { delta: 0, reset: true })).toEqual({ ok: true, data: 1 })
  })

  it('answers unimplemented ipcApi routes with NOT_IMPLEMENTED', async () => {
    await initDatabase()
    const response = await handleIpcApiRoute('mcp.package.upload_dxt', {})
    expect(response.ok).toBe(false)
    expect((response.error as any).code).toBe('NOT_IMPLEMENTED')
  })

  it('answers unimplemented routes with an explicit error envelope', () => {
    // `/topics` was the original example here, but it is implemented now — the assertion had
    // quietly become "asserts an implemented route 404s". A route the source has and this
    // adapter genuinely does not bridge is used instead, so the test keeps testing the thing
    // it is named for.
    const response = handleRequest({ id: 'r', method: 'GET', path: '/knowledges' }) as any
    expect(response.status).toBe(404)
    expect(response.error.message).toContain('未桥接')
  })

  it('creates assistants through the source route the import service writes to', async () => {
    await initDatabase()
    const created = handleRequest({
      id: 'r', method: 'POST', path: '/assistants',
      body: { name: '导入助手', prompt: '你是助手', emoji: '🤖', description: '来自导入' }
    }) as any
    expect(created.status).toBe(201)
    // The response uses the SOURCE field names, because the consumer is a source service.
    expect(created.data).toMatchObject({ name: '导入助手', prompt: '你是助手', emoji: '🤖', description: '来自导入' })
    expect(typeof created.data.id).toBe('string')
    // `name` is required by the source schema, so an empty one is a caller error.
    const rejected = handleRequest({ id: 'r', method: 'POST', path: '/assistants', body: { prompt: 'x' } }) as any
    expect(rejected.status).toBe(400)
    expect(rejected.error.code).toBe('INVALID_INPUT')
  })

  it('creates session-scoped topics and reports the missing session as a caller error', async () => {
    await initDatabase()
    const session = createAiSession({ kind: 'chat', runtime: 'openai-compatible', modelId: 'm', title: '会话' })
    const created = handleRequest({
      id: 'r', method: 'POST', path: '/topics',
      body: { sessionId: session.id, name: '导入主题' }
    }) as any
    expect(created.status).toBe(201)
    expect(created.data).toMatchObject({ id: expect.any(String), name: '导入主题' })
    // `orderKey` and the activity stamp come from real stored values, not placeholders.
    expect(typeof created.data.orderKey).toBe('string')
    expect(created.data.orderKey.length).toBeGreaterThan(0)
    expect(created.data.lastActivityAt).toBeTruthy()
    // A topic with no owning session is rejected rather than guessed.
    const rejected = handleRequest({ id: 'r', method: 'POST', path: '/topics', body: { name: 'x' } }) as any
    expect(rejected.status).toBe(400)
    expect(rejected.error.code).toBe('INVALID_INPUT')
  })

  it('projects the Grimoire Provider contract shape without secrets', () => {
    const projected = projectGrimoireProvider({
      id: 'pvd_x', name: 'X', access_mode: 'login', protocol: 'responses', base_url: 'https://x.example',
      has_api_key: true, has_auth_config: true, default_model: 'm', test_model: '', context_size: null,
      models: ['m'], is_active: false, created_at: '', updated_at: ''
    })
    expect(projected).toMatchObject({ authType: 'oauth', isEnabled: true, defaultChatEndpoint: 'openai-response' })
    expect(JSON.stringify(projected)).not.toContain('api_key')
  })

  it('maps a stored provider row deterministically', () => {
    const projected = sourceProviderFromRow(['pvd_r', 'Row', 'api', 'responses', 'https://r.example', 'cipher', 'm1', '', 4096, '["m1"]', '', '', 1, '', ''])
    expect(projected).toMatchObject({ id: 'pvd_r', defaultChatEndpoint: 'openai-response', isEnabled: true })
    expect((projected.settings as Record<string, unknown>).contextSize).toBe(4096)
  })
})

describe('prompt asset id mapping', () => {
  const { assetIdFromUnionAlias, assetIdCandidates, sourcePromptFromAsset } = __test

  // These cover the bug a live round trip caught and no amount of reading would have:
  // `UNIFIED_QUERY` aliases the column as `'asset:' || id`, while `createPromptAsset` stores
  // an id that ALREADY begins with `asset:`. The two id spaces collided, so a created prompt
  // came back as `asset:asset:<uuid>` — matching neither its own list entry nor the DELETE
  // lookup. Verified live as `foundInList: false` plus a 404 on delete.
  it('strips exactly one union prefix, leaving a stored id that already has one intact', () => {
    // Imported/built-in rows: stored id has no prefix.
    expect(assetIdFromUnionAlias('asset:builtin_abc')).toBe('builtin_abc')
    // User-created rows: stored id is `asset:<uuid>`, so the view id is doubled.
    expect(assetIdFromUnionAlias('asset:asset:8e1cf342-8615-49f1-ac2f-315ca4211850'))
      .toBe('asset:8e1cf342-8615-49f1-ac2f-315ca4211850')
    // A non-asset id is passed through rather than mangled.
    expect(assetIdFromUnionAlias('history:7')).toBe('history:7')
  })

  it('offers the stored-id forms most-likely-first, so a lookup can match either space', () => {
    expect(assetIdCandidates('asset:abc')).toEqual(['asset:abc', 'abc'])
    expect(assetIdCandidates('asset:asset:abc')).toEqual(['asset:asset:abc', 'asset:abc', 'abc'])
    expect(assetIdCandidates('abc')).toEqual(['abc'])
  })

  it('emits the stored id on both the list and create paths', () => {
    const base = { name: 'n', prompt: 'p', sourceRef: 's', source: 'asset', detail: '', createdAt: '2026-01-01', nsfw: false, variantCount: 0 }
    // List path passes the stored id recovered from the union alias.
    const fromList = sourcePromptFromAsset({ ...base, id: 'asset:builtin_x' } as never, 0, assetIdFromUnionAlias('asset:builtin_x'))
    expect(fromList.id).toBe('builtin_x')
    // Create path passes the service's return value unchanged.
    const fromCreate = sourcePromptFromAsset({ ...base, id: 'asset:uuid-1' } as never, 0, 'asset:uuid-1')
    expect(fromCreate.id).toBe('asset:uuid-1')
    // The source schema wants a non-empty orderKey; a synthesised position must be stable.
    expect(fromCreate.orderKey).toBe('00000000000000000000')
    expect(sourcePromptFromAsset({ ...base, id: 'x' } as never, 3, 'x').orderKey).toBe('00000000000000000003')
  })

  it('marks every projected prompt global, because Grimoire shares all assets', () => {
    const projected = sourcePromptFromAsset(
      { id: 'x', name: 'n', prompt: 'p', sourceRef: 's', source: 'asset', detail: '', createdAt: '2026-01-01', nsfw: false, variantCount: 0 } as never,
      0, 'x')
    expect(projected.visibility).toBe('global')
  })
})

describe('prompt visibility update adapter', () => {
  const request = (method: string, path: string, body?: unknown) =>
    handleRequest({ id: 'prompt-request', method, path, body }) as any

  async function seedAssistant(): Promise<void> {
    await initDatabase()
    getDatabase().run(
      'INSERT INTO ai_assistants (id,name,created_at,updated_at) VALUES (?,?,?,?)',
      ['assistant-1', 'Assistant', '2026-01-01', '2026-01-01']
    )
  }

  async function seedRestrictedPrompt() {
    await seedAssistant()
    const created = request('POST', '/prompts', {
      title: 'Restricted', content: 'Body', visibility: 'restricted',
      bindingTarget: { type: 'assistant', id: 'assistant-1' }
    })
    expect(created.status).toBe(201)
    const storedId = String(created.data.id)
    // The source list id is the union alias; the create response uses the stored id.
    return { storedId, listId: 'asset:' + storedId }
  }

  const patchPath = (id: string) => '/prompts/' + encodeURIComponent(id)
  const bindingCount = (promptId: string) =>
    Number(getDatabase().exec('SELECT count(*) FROM cherry_prompt_bindings WHERE prompt_id=?', [promptId])[0]?.values?.[0]?.[0] || 0)
  const storedVisibility = (id: string) =>
    String(getDatabase().exec('SELECT visibility FROM prompt_assets WHERE id=?', [id])[0]?.values?.[0]?.[0])

  it('does not leave an unbound restricted prompt when the assistant target is invalid', async () => {
    await initDatabase()
    const before = Number(getDatabase().exec('SELECT count(*) FROM prompt_assets')[0]?.values?.[0]?.[0] || 0)
    const response = request('POST', '/prompts', {
      title: 'Restricted', content: 'Body', visibility: 'restricted',
      bindingTarget: { type: 'assistant', id: 'missing-assistant' }
    })
    expect(response).toMatchObject({ status: 400, error: { code: 'INVALID_INPUT' } })
    expect(Number(getDatabase().exec('SELECT count(*) FROM prompt_assets')[0]?.values?.[0]?.[0] || 0)).toBe(before)
  })

  it('persists a global visibility transition and binding clear across database reopen', async () => {
    const { storedId, listId } = await seedRestrictedPrompt()
    const response = request('PATCH', patchPath(listId), {
      visibility: 'global',
      expectedBindings: [{ type: 'assistant', id: 'assistant-1' }]
    })
    expect(response.status).toBe(200)
    closeDatabase()
    await initDatabase()
    expect(storedVisibility(storedId)).toBe('global')
    expect(bindingCount(storedId)).toBe(0)
  })

  it('answers 409 and keeps the row restricted when expectedBindings is missing', async () => {
    const { storedId, listId } = await seedRestrictedPrompt()
    const response = request('PATCH', patchPath(listId), { visibility: 'global' })

    expect(response).toMatchObject({ status: 409, error: { code: 'CONCURRENT_MODIFICATION' } })
    expect(storedVisibility(storedId)).toBe('restricted')
    expect(bindingCount(storedId)).toBe(1)
  })

  it('answers 409 for a mismatched expectedBindings snapshot without changing either row', async () => {
    const { storedId, listId } = await seedRestrictedPrompt()

    const response = request('PATCH', patchPath(listId), {
      visibility: 'global',
      expectedBindings: [{ type: 'assistant', id: 'assistant-stale' }]
    })

    expect(response).toMatchObject({ status: 409, error: { code: 'CONCURRENT_MODIFICATION' } })
    expect(storedVisibility(storedId)).toBe('restricted')
    expect(bindingCount(storedId)).toBe(1)
  })

  it('makes the prompt global and clears bindings when the snapshot matches', async () => {
    const { storedId, listId } = await seedRestrictedPrompt()

    const response = request('PATCH', patchPath(listId), {
      visibility: 'global',
      expectedBindings: [{ type: 'assistant', id: 'assistant-1' }]
    })

    expect(response.status).toBe(200)
    expect(response.data).toMatchObject({ id: storedId, visibility: 'global' })
    expect(storedVisibility(storedId)).toBe('global')
    expect(bindingCount(storedId)).toBe(0)
  })

  it('keeps the selected binding when the prompt is updated to restricted', async () => {
    await seedAssistant()
    const created = request('POST', '/prompts', { title: 'Prompt', content: 'Body', visibility: 'global' })
    expect(created.status).toBe(201)
    const storedId = String(created.data.id)
    expect(request('PUT', '/prompts/' + encodeURIComponent(storedId) + '/bindings/assistant/assistant-1').status).toBe(200)

    const response = request('PATCH', patchPath('asset:' + storedId), {
      title: 'Prompt renamed', visibility: 'restricted'
    })

    expect(response.status).toBe(200)
    expect(response.data).toMatchObject({ id: storedId, title: 'Prompt renamed', visibility: 'restricted' })
    expect(storedVisibility(storedId)).toBe('restricted')
    expect(bindingCount(storedId)).toBe(1)
  })

  it('answers 400 for an unknown visibility value and leaves the row untouched', async () => {
    await initDatabase()
    const created = request('POST', '/prompts', { title: 'Prompt', content: 'Body', visibility: 'global' })
    const storedId = String(created.data.id)

    const response = request('PATCH', patchPath(storedId), { visibility: 'private' })

    expect(response).toMatchObject({ status: 400, error: { code: 'INVALID_VISIBILITY' } })
    expect(storedVisibility(storedId)).toBe('global')
  })

  it('rejects expectedBindings unless the update targets global', async () => {
    const { storedId, listId } = await seedRestrictedPrompt()

    const response = request('PATCH', patchPath(listId), {
      visibility: 'restricted',
      expectedBindings: [{ type: 'assistant', id: 'assistant-1' }]
    })

    expect(response).toMatchObject({ status: 400, error: { code: 'INVALID_EXPECTED_BINDINGS' } })
    expect(storedVisibility(storedId)).toBe('restricted')
  })

  it('answers 403 for built-in/imported rows', async () => {
    await initDatabase()
    getDatabase().run(
      'INSERT INTO prompt_assets (id,source_id,source,name,prompt,chapter,section,subsection,nsfw,variant_count,source_fingerprint,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ['builtin_abc', 'builtin:pack:x', 'asset', 'Built-in', 'Body', '', '', '', 0, 0, '', '2026-01-01', '2026-01-01', 'global']
    )

    const response = request('PATCH', patchPath('asset:builtin_abc'), { visibility: 'restricted' })

    expect(response).toMatchObject({ status: 403, error: { code: 'FORBIDDEN' } })
    expect(storedVisibility('builtin_abc')).toBe('global')
  })
})

describe('Cherry agent session prewarm transport', () => {
  it('resolves real mapped SQLite identity and refuses Pi without launching a runtime or leaking keys', async () => {
    await initDatabase()
    seedProvider('prewarm-provider', 'Mapped', 'https://example.invalid', 'prewarm-private-secret')
    const blueprint = blueprints.createAgentBlueprint({ type: 'pi', runtime: 'pi', name: 'Mapped', model: 'prewarm-provider::gpt-4o' })
    const { createAgentSessionReadModel } = await import('../services/agent-session-read-model.service')
    const mapped = createAgentSessionReadModel({ agentId: blueprint.id, name: '', workspace: { type: 'system' } })
    const launch = vi.spyOn(runtimeRegistry, 'createAgentRuntime')
    const response = await handleIpcApiRoute('ai.agent.session.prewarm', { sessionId: mapped.id }, { isDestroyed: () => false } as any)
    expect(response).toMatchObject({ ok: false, error: { code: 'AGENT_PREWARM_UNAVAILABLE', data: {
      code: 'RUNTIME_PREPARATION_UNAVAILABLE', sessionId: mapped.id, agentId: blueprint.id,
      providerId: 'prewarm-provider', model: 'gpt-4o', workspaceId: mapped.workspaceId, runtime: 'pi'
    } } })
    expect(launch).not.toHaveBeenCalled()
    expect(JSON.stringify(response)).not.toContain('prewarm-private-secret')
    expect(fs.existsSync(mapped.workspace.path)).toBe(false)
  })
  it('returns source-compatible success only after the main prewarm service resolves', async () => {
    const owner = { isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() }
    const prewarm = vi.spyOn(agentSessionPrewarmService, 'prewarm').mockResolvedValue(undefined)
    const response = await handleIpcApiRoute('ai.agent.session.prewarm', { sessionId: 'session-1' }, owner as any)
    expect(response).toEqual({ ok: true, data: null })
    expect(prewarm).toHaveBeenCalledWith('session-1', owner)
  })

  it('returns typed unavailable diagnostics and never ok:true when preparation is unavailable', async () => {
    const owner = { isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() }
    vi.spyOn(agentSessionPrewarmService, 'prewarm').mockRejectedValue(new AgentPrewarmUnavailableError('RUNTIME_PREPARATION_UNAVAILABLE', 'Pi has no turn-less preparation primitive', { runtime: 'pi' }))
    const response = await handleIpcApiRoute('ai.agent.session.prewarm', { sessionId: 'session-1' }, owner as any)
    expect(response).toMatchObject({ ok: false, error: { code: 'AGENT_PREWARM_UNAVAILABLE', data: { code: 'RUNTIME_PREPARATION_UNAVAILABLE', runtime: 'pi' } } })
  })

  it('releases the sender-owned lease through close_warm', async () => {
    const owner = { isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() }
    const release = vi.spyOn(agentSessionPrewarmService, 'release').mockResolvedValue(undefined)
    const response = await handleIpcApiRoute('ai.agent.session.close_warm', { sessionId: 'session-1' }, owner as any)
    expect(response).toEqual({ ok: true, data: null })
    expect(release).toHaveBeenCalledWith('session-1', owner)
  })
})
