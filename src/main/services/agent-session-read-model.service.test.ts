import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: (name: string) => name === 'exe' ? path.join(root, 'Grimoire.exe') : path.join(root, 'profile') } }))
import { closeDatabase, CURRENT_SCHEMA_VERSION, getDatabase, initDatabase } from '../database'
import { createAgentBlueprint } from './agent-blueprint.service'
import { findOrCreateAgentWorkspace } from './agent-workspace.service'
import { DatabaseSync } from 'node:sqlite'
import { appendAgentSessionEvent, attachAgentSession, getAgentSession, snapshotAgentSession, updateAgentSession } from './agent-session.service'
import { archiveAgentBlueprint } from './agent-blueprint.service'
import { createAgentSessionReadModel, getAgentSessionReadModel, getLatestAgentSessionReadModel, listAgentSessionReadModels, reuseOrCreateAgentSessionReadModel, setAgentSessionReadModelWorkspace, updateAgentSessionReadModel } from './agent-session-read-model.service'

beforeEach(async () => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-read-model-')); fs.mkdirSync(path.join(root, 'profile')); await initDatabase() })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

function agent(model = 'provider::model::suffix' as `${string}::${string}`) { return createAgentBlueprint({ name: 'Agent', type: null, runtime: 'pi', model }) }
function create(name = '') { return createAgentSessionReadModel({ agentId: agent().id, name, workspace: { type: 'system' } }) }
function rawData(id: string) { return JSON.parse(String(getDatabase().exec('SELECT data_json FROM agent_sessions WHERE id=?', [id])[0].values[0][0])) }
function count(table: string) { return getDatabase().exec(`SELECT count(*) FROM ${table}`)[0].values[0][0] }

describe('main-owned Agent session read model', () => {
  it('adds v35 sidecar without adopting legacy sessions or history', () => {
    // The table must exist and start empty — that is the contract. Pinning the exact schema
    // number made every later migration fail this test for no behavioural reason.
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(35)
    expect(getDatabase().exec('SELECT count(*) FROM agent_session_read_model')[0].values[0][0]).toBe(0)
    getDatabase().run('INSERT INTO agent_sessions (id,runtime,title,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?)', ['legacy', 'pi', 'old', '{"agentSession":{"version":1}}', '2020', '2020'])
    expect(listAgentSessionReadModels().items).toEqual([])
  })
  it('creates one runtime row, sidecar and system workspace atomically without mkdir', async () => {
    const agent = createAgentBlueprint({ name: 'Agent', type: null, runtime: 'pi', model: 'provider::model' })
    const row = createAgentSessionReadModel({ agentId: agent.id, name: '', description: 'safe', workspace: { type: 'system' } })
    expect(row.agentId).toBe(agent.id); expect(row.name).toBe(''); expect(row.workspace.type).toBe('system')
    expect(fs.existsSync(row.workspace.path)).toBe(false)
    expect(getDatabase().exec('SELECT count(*) FROM agent_sessions')[0].values[0][0]).toBe(1)
    expect(getDatabase().exec('SELECT count(*) FROM agent_session_read_model')[0].values[0][0]).toBe(1)
    closeDatabase(); await initDatabase()
    expect(getAgentSessionReadModel(row.id)).toEqual(row)
  })
  it('validates a user directory, rejects missing model, and rolls back all rows', () => {
    const agent = createAgentBlueprint({ name: 'No model', type: null, runtime: 'pi', model: 'provider::model' })
    const userPath = path.join(root, 'user'); fs.mkdirSync(userPath)
    const workspace = findOrCreateAgentWorkspace({ path: userPath }).workspace
    const row = createAgentSessionReadModel({ agentId: agent.id, name: 'User', workspace: { type: 'user', workspaceId: workspace.id } })
    expect(row.workspaceId).toBe(workspace.id)
    expect(() => createAgentSessionReadModel({ agentId: 'missing', name: 'x', workspace: { type: 'system' } })).toThrow('AGENT_NOT_FOUND')
    expect(() => createAgentSessionReadModel({ agentId: agent.id, name: 'x', workspace: { type: 'user', workspaceId: 'missing' } })).toThrow()
  })
  it('projects no runtime secrets, keeps name updates off activity, and advances only real message roles', () => {
    const agent = createAgentBlueprint({ name: 'Agent', type: null, runtime: 'pi', model: 'provider::model' })
    getDatabase().run('UPDATE agent_blueprints SET configuration_json=? WHERE id=?', ['{"env_vars":{"TOKEN":"blueprint-secret"},"visible":true}', agent.id])
    const session = createAgentSessionReadModel({ agentId: agent.id, name: 'Name', workspace: { type: 'system' } })
    expect(JSON.stringify(session)).not.toContain('secret')
    const before = session.lastActivityAt
    updateAgentSessionReadModel(session.id, { name: 'Renamed', description: 'D' })
    expect(getAgentSessionReadModel(session.id)!.lastActivityAt).toBe(before)
    appendAgentSessionEvent({ sessionId: session.id, type: 'tool-result', data: { role: 'assistant' } })
    expect(getAgentSessionReadModel(session.id)!.lastActivityAt).toBe(before)
    appendAgentSessionEvent({ sessionId: session.id, type: 'message', data: { role: 'user', content: 'hello' } })
    expect(getAgentSessionReadModel(session.id)!.lastActivityAt >= before).toBe(true)
    expect(getLatestAgentSessionReadModel(agent.id)!.id).toBe(session.id)
  })
  it('v34 upgrade is additive, pre-DDL backup preserves old rows, empty sidecar and idempotent reopen', async () => {
    const db = getDatabase(), date = '2020-01-01T00:00:00.000Z'
    db.run('INSERT INTO agent_sessions (id,runtime,title,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?)', ['legacy', 'pi', 'keep', '{"secret":"keep","agentSession":{"version":1,"agentId":"not-adopted"}}', date, date])
    db.run('INSERT INTO agent_session_events VALUES (?,?,?,?,?,?)', ['legacy-event', 'legacy', 91, 'message', '{"role":"user","secret":"keep"}', date])
    db.run('INSERT INTO ai_sessions (id,kind,runtime,provider_id,model_id,title,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', ['ai-old', 'chat', 'pi', 'p', 'm', 'keep', 'idle', '{"secret":"old"}', date, date])
    db.run('INSERT INTO ai_messages (id,session_id,sequence,role,content_json,attachments_json,status,created_at) VALUES (?,?,?,?,?,?,?,?)', ['ai-message', 'ai-old', 7, 'assistant', '{"old":true}', '[]', 'completed', date])
    db.run('INSERT INTO ai_events (id,session_id,sequence,event_type,payload_json,created_at) VALUES (?,?,?,?,?,?)', ['ai-event', 'ai-old', 8, 'message', '{"old":true}', date])
    const tables = ['agent_sessions', 'agent_session_events', 'ai_sessions', 'ai_messages', 'ai_events']
    const beforeAll = tables.map(table => db.exec(`SELECT * FROM ${table}`)[0].values)
    const before = beforeAll[0], events = beforeAll[1]
    closeDatabase()
    const file = path.join(root, 'profile', 'grimoire.db'), fixture = new DatabaseSync(file)
    try { fixture.exec('DROP TABLE agent_session_read_model'); fixture.prepare("UPDATE schema_meta SET value='34' WHERE key='schema_version'").run() } finally { fixture.close() }
    await initDatabase()
    expect(count('agent_session_read_model')).toBe(0)
    expect(getDatabase().exec('SELECT * FROM agent_sessions')[0].values).toEqual(before)
    expect(getDatabase().exec('SELECT * FROM agent_session_events')[0].values).toEqual(events)
    expect(tables.map(table => getDatabase().exec(`SELECT * FROM ${table}`)[0].values)).toEqual(beforeAll)
    const backups = fs.readdirSync(path.dirname(file)).filter(n => n.includes('.pre-migration-') && n.endsWith('.bak'))
    expect(backups).toHaveLength(1)
    const backup = new DatabaseSync(path.join(path.dirname(file), backups[0]), { readOnly: true })
    try {
      expect(backup.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get()?.value).toBe('34')
      expect(backup.prepare("SELECT name FROM sqlite_master WHERE name='agent_session_read_model'").get()).toBeUndefined()
      expect(backup.prepare('SELECT * FROM agent_sessions').all().map(Object.values)).toEqual(before)
    } finally { backup.close() }
    closeDatabase(); await initDatabase()
    expect(count('agent_session_read_model')).toBe(0)
    expect(getDatabase().exec('SELECT * FROM agent_sessions')[0].values).toEqual(before)
    expect(fs.readdirSync(path.dirname(file)).filter(n => n.includes('.pre-migration-') && n.endsWith('.bak'))).toEqual(backups)
  })
  it('reserved runtime identity/model split and namespace are shared, no snapshot, null trace', () => {
    const row = create('')
    const runtime = getAgentSession(row.id)!.session
    expect(runtime.id).toBe(row.id); expect(runtime.runtime).toBe('pi'); expect(runtime.provider_id).toBe('provider'); expect(runtime.model).toBe('model::suffix'); expect(runtime.title).toBe('')
    expect(row.workspace.id).toBe(row.workspaceId)
    expect(rawData(row.id)).toEqual({ agentSession: { version: 1, agentId: row.agentId, workspace: { type: 'system', workspaceId: row.workspaceId } } })
    expect(runtime.data.agentSession).toEqual(rawData(row.id).agentSession)
    expect(row).not.toHaveProperty('traceId')
    expect(getDatabase().exec('SELECT trace_id FROM agent_session_read_model WHERE id=?', [row.id])[0].values[0][0]).toBeNull()
  })
  it('strict source create contract refuses runtime/model/type/path/trace injection, absent/inactive blueprint model and invalid directory', () => {
    const a = agent(), base = { agentId: a.id, name: '', workspace: { type: 'system' as const } }
    for (const patch of [{ runtime: 'codex' }, { model: 'fake' }, { type: 'background' }, { traceId: 'a'.repeat(32) }, { workspace: { type: 'system', path: root } }, { name: 'x'.repeat(256) }, { agentId: null }]) expect(() => createAgentSessionReadModel({ ...base, ...patch } as never)).toThrow()
    getDatabase().run('UPDATE agent_blueprints SET model=NULL WHERE id=?', [a.id])
    expect(() => createAgentSessionReadModel(base)).toThrow('MODEL_REQUIRED')
    archiveAgentBlueprint(a.id); expect(() => createAgentSessionReadModel(base)).toThrow('AGENT_NOT_FOUND')
    const directory = path.join(root, 'user'); fs.mkdirSync(directory)
    const ws = findOrCreateAgentWorkspace({ path: directory }).workspace; fs.rmdirSync(directory)
    expect(() => createAgentSessionReadModel({ agentId: agent().id, name: '', workspace: { type: 'user', workspaceId: ws.id } })).toThrow('DIRECTORY_UNAVAILABLE')
    expect(count('agent_sessions')).toBe(0); expect(count('agent_session_read_model')).toBe(0)
  })
  it('sidecar failure rolls back execution and system workspace rows without files or nested commits', async () => {
    const a = agent(); getDatabase().exec("CREATE TRIGGER fail_sidecar BEFORE INSERT ON agent_session_read_model BEGIN SELECT RAISE(ABORT,'injected'); END;")
    expect(() => createAgentSessionReadModel({ agentId: a.id, name: '', workspace: { type: 'system' } })).toThrow('injected')
    expect(count('agent_sessions')).toBe(0); expect(count('agent_workspaces')).toBe(0); expect(count('agent_session_read_model')).toBe(0)
    expect(fs.existsSync(path.join(root, 'profile', 'agent-workspaces'))).toBe(false)
    closeDatabase(); await initDatabase()
    expect(count('agent_sessions')).toBe(0); expect(count('agent_workspaces')).toBe(0); expect(count('agent_session_read_model')).toBe(0)
  })
  it('owner/workspace authority rejects generic attach/title and atomically preserves runtime secrets and old snapshots', () => {
    const row = create('old'), next = agent('other::model')
    const snapshot = { version: 1 as const, capturedAt: row.createdAt, runtime: 'pi' as const, providerId: 'provider', model: 'model::suffix', agentId: row.agentId, config: { keep: true } }
    snapshotAgentSession({ id: row.id, snapshot })
    updateAgentSession({ id: row.id, data: { token: 'must stay main', unknown: { retained: true } } })
    for (const fn of [() => attachAgentSession({ id: row.id, agentId: next.id }), () => attachAgentSession({ id: row.id, workspace: { type: 'system' } }), () => updateAgentSession({ id: row.id, title: 'bypass' })]) expect(fn).toThrow('READ_MODEL_OWNED')
    const before = row.lastActivityAt
    const renamed = updateAgentSessionReadModel(row.id, { name: '', description: 'x'.repeat(1000), agentId: next.id })
    expect(renamed.isNameManuallyEdited).toBe(true); expect(renamed.lastActivityAt).toBe(before)
    expect(getAgentSession(row.id)!.session.title).toBe('')
    expect(getAgentSession(row.id)!.session.model).toBe('model::suffix')
    expect(rawData(row.id)).toMatchObject({ token: 'must stay main', unknown: { retained: true }, agentSession: { agentId: next.id, snapshot } })
    expect(JSON.stringify(getAgentSessionReadModel(row.id))).not.toContain('must stay main')
    const user = path.join(root, 'user'); fs.mkdirSync(user)
    const ws = findOrCreateAgentWorkspace({ path: user }).workspace
    setAgentSessionReadModelWorkspace(row.id, { type: 'user', workspaceId: ws.id })
    expect(rawData(row.id).agentSession.workspace).toEqual({ type: 'user', workspaceId: ws.id })
    expect(rawData(row.id).agentSession.snapshot).toEqual(snapshot)
    expect(getAgentSessionReadModel(row.id)!.lastActivityAt).toBe(before)
    appendAgentSessionEvent({ sessionId: row.id, type: 'message', data: { role: 'user' } })
    expect(() => setAgentSessionReadModelWorkspace(row.id, { type: 'system' })).toThrow('WORKSPACE_LOCKED')
  })
  it('database FK/checks prevent detached sidecars, invalid type/manual/name, workspace deletion and keep SET NULL namespace aligned', () => {
    const row = create('A'), db = getDatabase()
    expect(() => db.run('DELETE FROM agent_workspaces WHERE id=?', [row.workspaceId])).toThrow()
    for (const [column, value] of [['type', 'invalid'], ['is_name_manually_edited', 2], ['name', 'x'.repeat(256)], ['workspace_id', 'missing'], ['id', 'detached']] as const) expect(() => db.run(`UPDATE agent_session_read_model SET ${column}=? WHERE id=?`, [value, row.id])).toThrow()
    db.run('DELETE FROM agent_blueprints WHERE id=?', [row.agentId])
    expect(getAgentSessionReadModel(row.id)!.agentId).toBeNull(); expect(rawData(row.id).agentSession.agentId).toBeNull()
    expect(getLatestAgentSessionReadModel('unlinked')!.id).toBe(row.id)
    db.run('DELETE FROM agent_sessions WHERE id=?', [row.id]); expect(count('agent_session_read_model')).toBe(0)
    expect(count('agent_workspaces')).toBe(1)
  })
  it('list tuple cursor survives ties, filters conversation/trash/workspace/active owner, latest is activity not order or rename', () => {
    const a = agent(), source = { agentId: a.id, name: '', workspace: { type: 'system' as const } }
    const rows = Array.from({ length: 4 }, () => createAgentSessionReadModel(source)), db = getDatabase()
    rows.forEach(row => db.run('UPDATE agent_session_read_model SET order_key=? WHERE id=?', ['n', row.id]))
    const sorted = rows.map(row => row.id).sort()
    const page = listAgentSessionReadModels({ limit: 2 })
    expect(page.items.map(row => row.id)).toEqual(sorted.slice(0, 2)); expect(page.nextCursor).toBe(`entity:n:${sorted[1]}`)
    expect(listAgentSessionReadModels({ limit: 2, cursor: page.nextCursor }).items.map(row => row.id)).toEqual(sorted.slice(2))
    db.run("UPDATE agent_session_read_model SET type='background' WHERE id=?", [rows[0].id])
    db.run('UPDATE agent_session_read_model SET deleted_at=? WHERE id=?', [rows[1].createdAt, rows[1].id])
    expect(listAgentSessionReadModels().items).toHaveLength(2)
    expect(listAgentSessionReadModels({ inTrash: true }).items.map(row => row.id)).toEqual([rows[1].id])
    expect(listAgentSessionReadModels({ workspaceId: rows[2].workspaceId }).items.map(row => row.id)).toEqual([rows[2].id])
    db.run('UPDATE agent_session_read_model SET last_activity_at=? WHERE id=?', ['2099-01-01T00:00:00.000Z', rows[2].id])
    updateAgentSessionReadModel(rows[3].id, { name: 'latest metadata not activity' })
    expect(getLatestAgentSessionReadModel()!.id).toBe(rows[2].id)
    archiveAgentBlueprint(a.id)
    expect(listAgentSessionReadModels({ agentId: a.id }).items).toEqual([])
    expect(getLatestAgentSessionReadModel(a.id)).toBeNull(); expect(getLatestAgentSessionReadModel('unlinked')!.id).toBe(rows[2].id)
  })
  it('relation failure rolls back namespace and system allocation; prepared old files are never purged', () => {
    const row = create(), db = getDatabase(), directory = path.join(root, 'user'); fs.mkdirSync(directory)
    const ws = findOrCreateAgentWorkspace({ path: directory }).workspace
    fs.mkdirSync(row.workspace.path, { recursive: true }); fs.writeFileSync(path.join(row.workspace.path, 'keep'), 'keep')
    setAgentSessionReadModelWorkspace(row.id, { type: 'user', workspaceId: ws.id })
    expect(fs.readFileSync(path.join(row.workspace.path, 'keep'), 'utf8')).toBe('keep')
    const before = rawData(row.id), workspaceCount = count('agent_workspaces'), owner = agent()
    db.exec("CREATE TRIGGER fail_relation BEFORE UPDATE OF workspace_id,agent_id ON agent_session_read_model BEGIN SELECT RAISE(ABORT,'relation injected'); END;")
    expect(() => setAgentSessionReadModelWorkspace(row.id, { type: 'system' })).toThrow('relation injected')
    expect(count('agent_workspaces')).toBe(workspaceCount); expect(rawData(row.id)).toEqual(before)
    expect(() => updateAgentSessionReadModel(row.id, { agentId: owner.id })).toThrow('relation injected')
    expect(rawData(row.id)).toEqual(before); expect(getAgentSessionReadModel(row.id)!.agentId).toBe(row.agentId)
  })
  it('creation inserts first, exhausted keys rebalance, updates preserve activity and explicit automatic-name opt-out', () => {
    const first = create('first'), second = create('second'), db = getDatabase()
    expect(listAgentSessionReadModels().items.map(row => row.id)).toEqual([second.id, first.id])
    db.run("UPDATE agent_session_read_model SET order_key='0' WHERE id=?", [second.id])
    const third = create('third')
    expect(listAgentSessionReadModels().items.map(row => row.id)).toEqual([third.id, second.id, first.id])
    const automatic = updateAgentSessionReadModel(third.id, { name: 'automatic', isNameManuallyEdited: false })
    expect(automatic.isNameManuallyEdited).toBe(false); expect(automatic.lastActivityAt).toBe(third.lastActivityAt)
    for (const patch of [{ isNameManuallyEdited: 1 }, { workspaceId: first.workspaceId }, { type: 'background' }, { traceId: 'f'.repeat(32) }, { agentId: null }]) expect(() => updateAgentSessionReadModel(first.id, patch as never)).toThrow()
    for (const query of [{ limit: 0 }, { limit: NaN }, { limit: 201 }, { inTrash: 1 }, { ids: [] }, { workspaceId: '' }]) expect(() => listAgentSessionReadModels(query as never)).toThrow()
  })
  it('reuse-or-create creates once then reuses same real identity across synchronous competing calls', async () => {
    const a = agent(), input = { agentId: a.id, workspace: { type: 'system' as const } }
    const results = await Promise.all(Array.from({ length: 8 }, () => Promise.resolve().then(() => reuseOrCreateAgentSessionReadModel(input))))
    expect(results.filter(result => result.created)).toHaveLength(1)
    expect(new Set(results.map(result => result.session.id)).size).toBe(1)
    expect(results.every(result => result.deletedDuplicateSessionIds.length === 0)).toBe(true)
    expect(count('agent_sessions')).toBe(1); expect(count('agent_session_read_model')).toBe(1); expect(count('agent_workspaces')).toBe(1)
    expect(results[0].session.name).toBe(''); expect(results[0].session.isNameManuallyEdited).toBe(false)
    expect(getAgentSession(results[0].session.id)!.events).toEqual([])
    expect(fs.existsSync(results[0].session.workspace.path)).toBe(false)
  })
  it('reuse picks exact owner/user workspace, keeps duplicates and excluded candidate, touches activity monotonically with updatedAt/id tie', () => {
    const a = agent(), other = agent(), directory = path.join(root, 'user'); fs.mkdirSync(directory)
    const workspace = findOrCreateAgentWorkspace({ path: directory }).workspace
    fs.writeFileSync(path.join(directory, 'user-owned'), 'keep')
    const input = { agentId: a.id, workspace: { type: 'user' as const, workspaceId: workspace.id } }
    const first = createAgentSessionReadModel({ ...input, name: '' }), second = createAgentSessionReadModel({ ...input, name: '   ' })
    const otherOwner = createAgentSessionReadModel({ ...input, agentId: other.id, name: '' })
    const wrongWorkspace = createAgentSessionReadModel({ agentId: a.id, name: '', workspace: { type: 'system' } })
    const future = '2099-01-01T00:00:00.000Z', db = getDatabase()
    for (const row of [first, second]) db.run('UPDATE agent_session_read_model SET updated_at=?,last_activity_at=? WHERE id=?', [future, future, row.id])
    const sorted = [first.id, second.id].sort(), chosen = reuseOrCreateAgentSessionReadModel(input)
    expect(chosen).toMatchObject({ created: false, deletedDuplicateSessionIds: [], session: { id: sorted[0], updatedAt: future, lastActivityAt: future } })
    expect(reuseOrCreateAgentSessionReadModel({ ...input, excludeSessionId: sorted[0] }).session.id).toBe(sorted[1])
    expect([first.id, second.id, otherOwner.id, wrongWorkspace.id].every(id => getAgentSession(id))).toBe(true)
    db.run('UPDATE agent_session_read_model SET updated_at=? WHERE id=?', ['2100-01-01T00:00:00.000Z', sorted[1]])
    expect(reuseOrCreateAgentSessionReadModel(input).session.id).toBe(sorted[1])
    expect(fs.readFileSync(path.join(directory, 'user-owned'), 'utf8')).toBe('keep')
    expect(count('agent_sessions')).toBe(4)
    db.run('UPDATE agent_session_read_model SET updated_at=?,last_activity_at=? WHERE id=?', ['2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z', sorted[1]])
    const touched = reuseOrCreateAgentSessionReadModel({ ...input, excludeSessionId: sorted[0] })
    expect(touched.session.updatedAt > '2000-01-01T00:00:00.000Z').toBe(true)
    expect(touched.session.lastActivityAt).toBe(touched.session.updatedAt)
  })
  it('reuse eligibility rejects any message/manual blank/nonblank/background/trash/nonidle, without adopting legacy rows', () => {
    const a = agent(), input = { agentId: a.id, workspace: { type: 'system' as const } }, db = getDatabase()
    const message = createAgentSessionReadModel({ ...input, name: '' })
    appendAgentSessionEvent({ sessionId: message.id, type: 'message', data: { role: 'tool', content: '' } })
    const manual = createAgentSessionReadModel({ ...input, name: '' }); updateAgentSessionReadModel(manual.id, { isNameManuallyEdited: true })
    const named = createAgentSessionReadModel({ ...input, name: 'not blank' })
    const background = createAgentSessionReadModel({ ...input, name: '' }); db.run("UPDATE agent_session_read_model SET type='background' WHERE id=?", [background.id])
    const trash = createAgentSessionReadModel({ ...input, name: '' }); db.run('UPDATE agent_session_read_model SET deleted_at=? WHERE id=?', [trash.createdAt, trash.id])
    const busy = ['running', 'interrupted', 'completed', 'failed'].map(status => { const row = createAgentSessionReadModel({ ...input, name: '' }); db.run('UPDATE agent_sessions SET status=? WHERE id=?', [status, row.id]); return row })
    db.run('INSERT INTO agent_sessions (id,runtime,title,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?)', ['legacy-empty', 'pi', '', '{"secret":"keep"}', named.createdAt, named.createdAt])
    const result = reuseOrCreateAgentSessionReadModel(input)
    expect(result.created).toBe(true); expect(result.deletedDuplicateSessionIds).toEqual([])
    for (const id of [message.id, manual.id, named.id, background.id, trash.id, ...busy.map(row => row.id), 'legacy-empty']) expect(getAgentSession(id)).not.toBeNull()
    expect(rawData('legacy-empty')).toEqual({ secret: 'keep' })
  })
  it('system reuse cleans only eligible duplicate runtime/sidecar/workspace and actual pin rows, never files, exclusions retained', () => {
    const a = agent(), input = { agentId: a.id, workspace: { type: 'system' as const } }, db = getDatabase()
    const selected = createAgentSessionReadModel({ ...input, name: '' }), duplicate = createAgentSessionReadModel({ ...input, name: ' ' }), excluded = createAgentSessionReadModel({ ...input, name: '' })
    db.run('UPDATE agent_session_read_model SET updated_at=? WHERE id=?', ['2099-01-01T00:00:00.000Z', selected.id])
    for (const row of [selected, duplicate, excluded]) db.run('INSERT INTO cherry_resource_state (entity_type,entity_id,pinned,created_at,updated_at) VALUES (?,?,?,?,?)', ['session', row.id, 1, row.createdAt, row.updatedAt])
    fs.mkdirSync(duplicate.workspace.path, { recursive: true }); fs.writeFileSync(path.join(duplicate.workspace.path, 'keep'), 'untouched')
    const result = reuseOrCreateAgentSessionReadModel({ ...input, excludeSessionId: excluded.id })
    expect(result).toMatchObject({ created: false, session: { id: selected.id }, deletedDuplicateSessionIds: [duplicate.id] })
    expect(getAgentSession(duplicate.id)).toBeNull(); expect(db.exec('SELECT 1 FROM agent_session_read_model WHERE id=?', [duplicate.id])[0].values).toEqual([])
    expect(db.exec('SELECT 1 FROM agent_workspaces WHERE id=?', [duplicate.workspaceId])[0].values).toEqual([])
    expect(db.exec("SELECT entity_id FROM cherry_resource_state WHERE entity_type='session' ORDER BY entity_id")[0].values.map(row => row[0])).toEqual([selected.id, excluded.id].sort())
    expect(fs.readFileSync(path.join(duplicate.workspace.path, 'keep'), 'utf8')).toBe('untouched'); expect(getAgentSession(excluded.id)).not.toBeNull()
  })
  it('reuse without candidate respects exclusion and creates blank session via DB-only createTx, with model required even on reuse', () => {
    const a = agent(), input = { agentId: a.id, workspace: { type: 'system' as const } }
    const first = reuseOrCreateAgentSessionReadModel(input)
    const second = reuseOrCreateAgentSessionReadModel({ ...input, excludeSessionId: first.session.id })
    expect(second.created).toBe(true); expect(second.session.id).not.toBe(first.session.id); expect(getAgentSession(first.session.id)).not.toBeNull()
    getDatabase().run('UPDATE agent_blueprints SET model=NULL WHERE id=?', [a.id])
    expect(() => reuseOrCreateAgentSessionReadModel(input)).toThrow('MODEL_REQUIRED')
    expect(count('agent_sessions')).toBe(2)
    for (const patch of [{ name: '' }, { type: 'background' }, { workspace: { type: 'system', path: root } }, { excludeSessionId: '' }, { agentId: null }]) expect(() => reuseOrCreateAgentSessionReadModel({ ...input, ...patch } as never)).toThrow()
  })
  it('unsafe duplicate history or workspace references refuses whole reuse cleanup without state loss', () => {
    const a = agent(), input = { agentId: a.id, workspace: { type: 'system' as const } }, db = getDatabase()
    const selected = createAgentSessionReadModel({ ...input, name: '' }), duplicate = createAgentSessionReadModel({ ...input, name: '' })
    db.run('UPDATE agent_session_read_model SET updated_at=? WHERE id=?', ['2099-01-01T00:00:00.000Z', selected.id])
    appendAgentSessionEvent({ sessionId: duplicate.id, type: 'status', data: { status: 'used' } })
    expect(() => reuseOrCreateAgentSessionReadModel(input)).toThrow('UNSAFE_PLACEHOLDER_PURGE')
    expect(count('agent_sessions')).toBe(2); expect(count('agent_workspaces')).toBe(2)
    expect(getAgentSessionReadModel(selected.id)).toEqual({ ...selected, updatedAt: '2099-01-01T00:00:00.000Z' })
    db.run('DELETE FROM agent_session_events WHERE session_id=?', [duplicate.id])
    db.run('INSERT INTO agent_sessions (id,runtime,title,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?)', ['legacy-ref', 'pi', 'keep', JSON.stringify({ agentSession: { version: 1, workspace: { type: 'system', workspaceId: duplicate.workspaceId } } }), selected.createdAt, selected.createdAt])
    expect(() => reuseOrCreateAgentSessionReadModel(input)).toThrow('UNSAFE_PLACEHOLDER_PURGE')
    expect(getAgentSession(duplicate.id)).not.toBeNull(); expect(count('agent_workspaces')).toBe(2)
  })
  it('reuse touch failure restores deleted duplicates/pins and create failure rolls back workspace/runtime allocations', () => {
    const a = agent(), input = { agentId: a.id, workspace: { type: 'system' as const } }, db = getDatabase()
    const selected = createAgentSessionReadModel({ ...input, name: '' }), duplicate = createAgentSessionReadModel({ ...input, name: '' })
    db.run('UPDATE agent_session_read_model SET updated_at=? WHERE id=?', ['2099-01-01T00:00:00.000Z', selected.id])
    db.run('INSERT INTO cherry_resource_state (entity_type,entity_id,pinned,created_at,updated_at) VALUES (?,?,?,?,?)', ['session', duplicate.id, 1, duplicate.createdAt, duplicate.updatedAt])
    db.exec("CREATE TRIGGER fail_touch BEFORE UPDATE OF last_activity_at ON agent_session_read_model BEGIN SELECT RAISE(ABORT,'reuse injected'); END;")
    expect(() => reuseOrCreateAgentSessionReadModel(input)).toThrow('reuse injected')
    expect(getAgentSession(duplicate.id)).not.toBeNull(); expect(getAgentSessionReadModel(duplicate.id)).toEqual(duplicate); expect(count('agent_workspaces')).toBe(2)
    expect(db.exec("SELECT pinned FROM cherry_resource_state WHERE entity_id=?", [duplicate.id])[0].values[0][0]).toBe(1)
    db.exec("DROP TRIGGER fail_touch; CREATE TRIGGER fail_reuse_create BEFORE INSERT ON agent_session_read_model BEGIN SELECT RAISE(ABORT,'create injected'); END;")
    expect(() => reuseOrCreateAgentSessionReadModel({ ...input, agentId: agent().id })).toThrow('create injected')
    expect(count('agent_sessions')).toBe(2); expect(count('agent_workspaces')).toBe(2)
  })
  it('activity is monotonic for assistant/user only and event/activity failure rolls back together', () => {
    const row = create(), db = getDatabase(), future = '2099-01-01T00:00:00.000Z'
    db.run('UPDATE agent_session_read_model SET last_activity_at=? WHERE id=?', [future, row.id])
    for (const role of ['system', 'tool', 'root', undefined]) appendAgentSessionEvent({ sessionId: row.id, type: 'message', data: { role } })
    appendAgentSessionEvent({ sessionId: row.id, type: 'message', data: { role: 'assistant' } })
    expect(getAgentSessionReadModel(row.id)!.lastActivityAt).toBe(future)
    const n = count('agent_session_events')
    db.exec("CREATE TRIGGER fail_activity BEFORE UPDATE OF last_activity_at ON agent_session_read_model BEGIN SELECT RAISE(ABORT,'activity injected'); END;")
    expect(() => appendAgentSessionEvent({ sessionId: row.id, type: 'message', data: { role: 'user' } })).toThrow('activity injected')
    expect(count('agent_session_events')).toBe(n)
  })
})
