import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from 'electron'
let root = ''
vi.mock('electron', () => ({ app: { getPath: (name: string) => name === 'exe' ? path.join(root, 'Grimoire.exe') : path.join(root, 'profile') } }))
import { closeDatabase, CURRENT_SCHEMA_VERSION, getDatabase, initDatabase } from '../database'
import { agentWorkspacePathKey, allocateSystemAgentWorkspace, deleteAgentWorkspace, findOrCreateAgentWorkspace, getAgentWorkspace, getAgentWorkspaceInternal, listAgentWorkspaces, listAgentWorkspacesInternal, prepareSystemAgentWorkspace, reorderAgentWorkspace, updateAgentWorkspace } from './agent-workspace.service'
const now = '2026-01-01T00:00:00.000Z'
const raw = (sql: string) => getDatabase().exec(sql)
const tables = ['agent_sessions', 'agent_session_events', 'ai_sessions', 'ai_messages', 'ai_events']
const snapshot = () => tables.map(table => raw(`SELECT * FROM ${table}`)[0]?.values ?? [])
function folder(name: string) { const target = path.join(root, name); fs.mkdirSync(target); return target }
function register(name: string) { return findOrCreateAgentWorkspace({ path: folder(name), name }).workspace }
function link(target: string, alias: string) { fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir') }
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-workspace-'))
  fs.mkdirSync(path.join(root, 'profile'))
  await initDatabase()
  const db = getDatabase()
  db.run('INSERT INTO agent_sessions (id,runtime,title,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?)', ['legacy', 'pi', 'keep', '{"cwd":"C:/legacy","agentSession":{"version":1,"workspace":{"type":"user","workspaceId":"not-inferred"}}}', now, now])
  db.run('INSERT INTO agent_session_events (id,session_id,sequence,type,data_json,created_at) VALUES (?,?,?,?,?,?)', ['event', 'legacy', 8, 'keep', '{"sequence":99}', now])
  db.run('INSERT INTO ai_sessions (id,kind,runtime,provider_id,model_id,title,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', ['ai', 'chat', 'openai-compatible', 'p', 'm', 'keep', 'idle', '{"cwd":"C:/old"}', now, now])
  db.run('INSERT INTO ai_messages (id,session_id,sequence,role,content_json,attachments_json,status,created_at) VALUES (?,?,?,?,?,?,?,?)', ['msg', 'ai', 7, 'assistant', '{"keep":true}', '[]', 'completed', now])
  db.run('INSERT INTO ai_events (id,session_id,sequence,event_type,payload_json,created_at) VALUES (?,?,?,?,?,?)', ['ai-event', 'ai', 6, 'status', '{"keep":true}', now])
})
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })
describe('P1/P4 main-only real Agent workspace repository', () => {
  it('fresh schema has exactly source columns, no inferred rows or managed directories', () => {
    expect(raw('PRAGMA table_info(agent_workspaces)')[0].values.map(row => row[1])).toEqual(['id', 'name', 'path', 'type', 'order_key', 'created_at', 'updated_at'])
    expect(listAgentWorkspacesInternal()).toEqual([])
    expect(fs.existsSync(path.join(root, 'profile', 'agent-workspaces'))).toBe(false)
  })
  it.each([31, 33])('upgrades fixture v%s, backup predates workspace DDL, preserves old rows/events, idempotent reopen', async version => {
    const before = snapshot(); closeDatabase()
    const file = path.join(root, 'profile', 'grimoire.db'), fixture = new DatabaseSync(file)
    try {
      // The fixture starts from the current schema, which can have later sidecar FKs.
      // Drop dependent structures first; never leave an invalid parent reference.
      const drop = (table: string) => {
        if (fixture.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) fixture.exec('DROP TABLE ' + table)
      }
      drop('agent_session_read_model')
      drop('agent_workspaces')
      if (version === 31) {
        for (const table of ['topic_tree_state', 'topic_tree_messages', 'agent_blueprints']) drop(table)
      }
      fixture.prepare("UPDATE schema_meta SET value=? WHERE key='schema_version'").run(String(version))
    } finally { fixture.close() }
    await initDatabase()
    expect(snapshot()).toEqual(before); expect(listAgentWorkspacesInternal()).toEqual([])
    expect(raw("SELECT value FROM schema_meta WHERE key='schema_version'")[0].values[0][0]).toBe(String(CURRENT_SCHEMA_VERSION))
    const backups = fs.readdirSync(path.dirname(file)).filter(n => n.includes('.pre-migration-') && n.endsWith('.bak'))
    expect(backups).toHaveLength(1)
    const backup = new DatabaseSync(path.join(path.dirname(file), backups[0]), { readOnly: true })
    expect(backup.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get()?.value).toBe(String(version))
    expect(backup.prepare("SELECT name FROM sqlite_master WHERE name='agent_workspaces'").get()).toBeUndefined()
    tables.forEach((table, i) => expect(backup.prepare(`SELECT * FROM ${table}`).all().map(Object.values)).toEqual(before[i])); backup.close()
    const user = register('survive'); closeDatabase(); await initDatabase()
    expect(getAgentWorkspace(user.id)).toEqual(user); expect(snapshot()).toEqual(before)
    expect(fs.readdirSync(path.dirname(file)).filter(n => n.includes('.pre-migration-') && n.endsWith('.bak'))).toEqual(backups)
  })
  it('existing accessible directory registration is canonical/idempotent, trims name but never renames or writes user directory', () => {
    const target = folder('existing'); fs.writeFileSync(path.join(target, 'keep'), 'unchanged')
    const before = snapshot(), stat = fs.statSync(target)
    const first = findOrCreateAgentWorkspace({ path: target + path.sep, name: '  Name  ' })
    expect(first.created).toBe(true); expect(first.workspace.name).toBe('Name')
    expect(first.workspace.path).toBe(agentWorkspacePathKey(fs.realpathSync.native(target)))
    const again = findOrCreateAgentWorkspace({ path: path.join(target, '..', 'existing'), name: 'Do not rename' })
    expect(again).toEqual({ workspace: first.workspace, created: false })
    expect(fs.readdirSync(target)).toEqual(['keep']); expect(fs.readFileSync(path.join(target, 'keep'), 'utf8')).toBe('unchanged')
    expect(fs.statSync(target).mtimeMs).toBe(stat.mtimeMs); expect(snapshot()).toEqual(before)
    expect(first.workspace.id).toMatch(/^[a-f0-9-]{36}$/)
    expect(Object.keys(first.workspace)).toEqual(['id', 'name', 'path', 'type', 'orderKey', 'createdAt', 'updatedAt'])
  })
  it('user symlink aliases resolve to one row; alias into managed subtree is refused', () => {
    const target = folder('actual'), alias = path.join(root, 'alias'); link(target, alias)
    const user = findOrCreateAgentWorkspace({ path: target }).workspace
    expect(findOrCreateAgentWorkspace({ path: alias })).toEqual({ workspace: user, created: false })
    const managedAlias = path.join(root, 'managed-alias'); link(path.join(root, 'profile'), managedAlias)
    expect(() => findOrCreateAgentWorkspace({ path: managedAlias })).toThrow('MANAGED_PATH')
  })
  it('Windows canonical identity normalizes case/separators/dots/trailing separator; actual host case aliases dedupe', () => {
    expect(agentWorkspacePathKey('C:/Work/Dir/../DIR///', 'win32')).toBe('c:\\work\\dir')
    expect(agentWorkspacePathKey('C:\\', 'win32')).toBe('c:\\')
    expect(agentWorkspacePathKey('\\\\Server\\Share\\Folder\\', 'win32')).toBe('\\\\server\\share\\folder')
    const target = folder('CaseDirectory'), user = findOrCreateAgentWorkspace({ path: target }).workspace
    if (process.platform === 'win32') expect(findOrCreateAgentWorkspace({ path: target.toUpperCase() })).toEqual({ workspace: user, created: false })
    else expect(agentWorkspacePathKey('/Case/Dir', 'linux')).not.toBe(agentWorkspacePathKey('/case/dir', 'linux'))
  })
  it('strict input rejects missing/relative/non-directory/inaccessible paths and empty/bad names without mkdir', () => {
    const missing = path.join(root, 'missing'), file = path.join(root, 'file'); fs.writeFileSync(file, 'keep')
    for (const input of [{ path: missing }, { path: file }, { path: 'relative' }, { path: '' }, { path: root, name: '' }, { path: root, name: '  ' }, { path: root, name: 42 }, { path: root, type: 'system' }, { path: 42 }]) expect(() => findOrCreateAgentWorkspace(input as never)).toThrow('AGENT_WORKSPACE_')
    if (process.platform === 'win32') for (const target of ['C:relative', '\\current-drive', '\\\\?\\C:\\temp', root + '\\x:ads', root + '\\NUL', root + '\\tail.']) expect(() => findOrCreateAgentWorkspace({ path: target })).toThrow('INVALID_PATH')
    const access = vi.spyOn(fs, 'accessSync').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) })
    try { expect(() => findOrCreateAgentWorkspace({ path: root })).toThrow('DIRECTORY_UNAVAILABLE') } finally { access.mockRestore() }
    expect(fs.existsSync(missing)).toBe(false); expect(listAgentWorkspacesInternal()).toEqual([])
  })
  it('managed userData and all subtrees forbidden; sibling with common prefix allowed', () => {
    const managed = path.join(root, 'profile'), child = path.join(managed, 'child'); fs.mkdirSync(child)
    for (const target of [managed, child]) expect(() => findOrCreateAgentWorkspace({ path: target })).toThrow('MANAGED_PATH')
    expect(register('profile-sibling').type).toBe('user')
  })
  it('system/user canonical collisions refuse, database type/path constraints backstop', () => {
    const target = folder('collision'), key = agentWorkspacePathKey(fs.realpathSync.native(target))
    getDatabase().run('INSERT INTO agent_workspaces VALUES (?,?,?,?,?,?,?)', ['system', 'system', key, 'system', 'n', now, now])
    expect(() => findOrCreateAgentWorkspace({ path: target })).toThrow('PATH_COLLISION')
    expect(() => getDatabase().run('INSERT INTO agent_workspaces VALUES (?,?,?,?,?,?,?)', ['duplicate', 'dup', key, 'user', 'n', now, now])).toThrow()
    expect(() => getDatabase().run('INSERT INTO agent_workspaces VALUES (?,?,?,?,?,?,?)', ['bad', 'bad', 'other', 'invalid', 'n', now, now])).toThrow()
  })
  it('main-derived UTC system allocation does not mkdir/attach; explicit prepare is idempotent, users cannot get/update/reorder/delete system rows', () => {
    const before = snapshot(), user = register('user'), system = allocateSystemAgentWorkspace({ sessionId: 'session-safe', createdAt: Date.parse('2026-10-12T23:30:00-05:00') })
    expect(system.path).toBe(agentWorkspacePathKey(path.join(root, 'profile', 'agent-workspaces', '2026-10-13', 'session-safe')))
    expect(fs.existsSync(system.path)).toBe(false); expect(getAgentWorkspaceInternal(system.id)).toEqual(system)
    expect(listAgentWorkspaces()).toEqual([user]); expect(listAgentWorkspacesInternal()).toHaveLength(2)
    for (const action of [() => getAgentWorkspace(system.id), () => updateAgentWorkspace(system.id, { name: 'bad' }), () => reorderAgentWorkspace(system.id, { position: 'last' }), () => reorderAgentWorkspace(user.id, { before: system.id }), () => deleteAgentWorkspace(system.id)]) expect(action).toThrow('NOT_FOUND')
    expect(prepareSystemAgentWorkspace(system.id)).toEqual(system); expect(fs.statSync(system.path).isDirectory()).toBe(true)
    fs.writeFileSync(path.join(system.path, 'keep'), 'keep'); prepareSystemAgentWorkspace(system.id)
    expect(fs.readFileSync(path.join(system.path, 'keep'), 'utf8')).toBe('keep')
    expect(() => findOrCreateAgentWorkspace({ path: system.path })).toThrow('MANAGED_PATH')
    expect(() => allocateSystemAgentWorkspace({ sessionId: 'session-safe', createdAt: Date.parse('2026-10-13') })).toThrow('PATH_COLLISION')
    expect(snapshot()).toEqual(before)
  })
  it('system allocation refuses unsafe identifiers, dates and renderer-supplied path fields', () => {
    for (const sessionId of ['', '.', '..', '../escape', 'x/y', 'x\\y', 'C:ads', 'NUL', 'x.']) expect(() => allocateSystemAgentWorkspace({ sessionId, createdAt: Date.now() })).toThrow('AGENT_WORKSPACE_')
    for (const createdAt of [NaN, Infinity, 1e20]) expect(() => allocateSystemAgentWorkspace({ sessionId: 'safe', createdAt })).toThrow('INVALID_DATE')
    expect(() => allocateSystemAgentWorkspace({ sessionId: 'safe', createdAt: Date.now(), path: root } as never)).toThrow('UNSUPPORTED_FIELD')
    expect(listAgentWorkspacesInternal()).toEqual([])
  })
  it('no symlink components for system allocation/preparation, including userData; no escape writes', () => {
    const outside = folder('outside'), managed = path.join(root, 'profile', 'agent-workspaces'); link(outside, managed)
    expect(() => allocateSystemAgentWorkspace({ sessionId: 'safe', createdAt: Date.parse('2026-10-12') })).toThrow('UNSAFE_SYSTEM_PATH')
    fs.unlinkSync(managed)
    const system = allocateSystemAgentWorkspace({ sessionId: 'safe', createdAt: Date.parse('2026-10-12') })
    fs.mkdirSync(managed); link(outside, path.join(managed, '2026-10-12'))
    expect(() => prepareSystemAgentWorkspace(system.id)).toThrow('UNSAFE_SYSTEM_PATH'); expect(fs.readdirSync(outside)).toEqual([])
    fs.unlinkSync(path.join(managed, '2026-10-12'))
    fs.writeFileSync(path.join(managed, '2026-10-12'), 'not dir')
    expect(() => prepareSystemAgentWorkspace(system.id)).toThrow('UNSAFE_SYSTEM_PATH')
  })
  it('prepare rejects user rows and forged system paths outside ownership', () => {
    const user = register('user')
    expect(() => prepareSystemAgentWorkspace(user.id)).toThrow('SYSTEM_REQUIRED')
    getDatabase().run('INSERT INTO agent_workspaces VALUES (?,?,?,?,?,?,?)', ['forged', 'bad', path.join(root, 'escape'), 'system', 'n', now, now])
    expect(() => prepareSystemAgentWorkspace('forged')).toThrow('UNSAFE_SYSTEM_PATH')
    expect(fs.existsSync(path.join(root, 'escape'))).toBe(false)
  })
  it('user rename only, scoped fractional ordering/anchors/rebalance; system keys untouched', () => {
    const a = register('a'), b = register('b'), c = register('c'), system = allocateSystemAgentWorkspace({ sessionId: 'safe', createdAt: Date.now() })
    expect(listAgentWorkspaces().map(w => w.id)).toEqual([c.id, b.id, a.id])
    expect(updateAgentWorkspace(a.id, { name: '  New  ' })).toMatchObject({ name: 'New', path: a.path, type: 'user', orderKey: a.orderKey })
    for (const request of [{ path: root, name: 'bad' }, { name: '' }, { name: 'ok', type: 'system' }]) expect(() => updateAgentWorkspace(a.id, request as never)).toThrow('AGENT_WORKSPACE_')
    reorderAgentWorkspace(a.id, { before: c.id }); expect(listAgentWorkspaces().map(w => w.id)).toEqual([a.id, c.id, b.id])
    expect(getAgentWorkspace(c.id).orderKey).toBe(c.orderKey)
    reorderAgentWorkspace(a.id, { after: b.id }); expect(listAgentWorkspaces().map(w => w.id)).toEqual([c.id, b.id, a.id])
    reorderAgentWorkspace(b.id, { position: 'first' }); reorderAgentWorkspace(c.id, { position: 'last' })
    expect(listAgentWorkspaces().map(w => w.id)).toEqual([b.id, a.id, c.id])
    const same = getAgentWorkspace(a.id); expect(reorderAgentWorkspace(a.id, { before: a.id })).toEqual(same)
    for (const request of [{ before: 'missing' }, { position: 'bad' }, {}, { before: b.id, after: c.id }]) expect(() => reorderAgentWorkspace(a.id, request as never)).toThrow('AGENT_WORKSPACE_')
    getDatabase().run('UPDATE agent_workspaces SET order_key=? WHERE id=?', ['n', b.id])
    getDatabase().run('UPDATE agent_workspaces SET order_key=? WHERE id=?', ['n0', c.id])
    reorderAgentWorkspace(a.id, { before: c.id }); expect(listAgentWorkspaces().map(w => w.id)).toEqual([b.id, a.id, c.id])
    expect(getAgentWorkspaceInternal(system.id).orderKey).toBe(system.orderKey)
  })
  it('repeated insert-first rebalance maintains source ordering; failed writes roll back', () => {
    const created = Array.from({ length: 20 }, (_, i) => register('many-' + i))
    expect(listAgentWorkspaces().map(w => w.id)).toEqual(created.reverse().map(w => w.id))
    const before = listAgentWorkspacesInternal()
    getDatabase().exec("CREATE TRIGGER reject_workspace BEFORE INSERT ON agent_workspaces BEGIN SELECT RAISE(ABORT,'fixture failure'); END;")
    expect(() => register('rollback')).toThrow('fixture failure')
    expect(listAgentWorkspacesInternal()).toEqual(before)
  })
  it('symlinked userData and dangling system components fail closed; reverse user/system collision refuses', () => {
    const managed = path.join(root, 'profile', 'agent-workspaces'), target = folder('external-root')
    // The live fixture DB is in profile: do not move it. Inject only the path provider.
    const alias = path.join(root, 'profile-link'); link(path.join(root, 'profile'), alias)
    const getPath = vi.spyOn(app, 'getPath').mockReturnValue(alias)
    try { expect(() => allocateSystemAgentWorkspace({ sessionId: 'safe', createdAt: Date.parse('2026-10-12') })).toThrow('UNSAFE_SYSTEM_PATH') } finally { getPath.mockRestore() }
    fs.mkdirSync(managed)
    const dangling = path.join(managed, '2026-10-12'); link(target, dangling); fs.rmdirSync(target)
    expect(() => allocateSystemAgentWorkspace({ sessionId: 'safe', createdAt: Date.parse('2026-10-12') })).toThrow('UNSAFE_SYSTEM_PATH')
    fs.unlinkSync(dangling)
    const system = allocateSystemAgentWorkspace({ sessionId: 'safe', createdAt: Date.parse('2026-10-12') })
    getDatabase().run("UPDATE agent_workspaces SET type='user' WHERE id=?", [system.id])
    expect(() => allocateSystemAgentWorkspace({ sessionId: 'safe', createdAt: Date.parse('2026-10-12') })).toThrow('PATH_COLLISION')
  })
  it('foreign-key reference blocks row deletion without removing either reference or user directory', () => {
    const user = register('referenced')
    getDatabase().exec('CREATE TABLE fixture_workspace_refs (workspace_id TEXT REFERENCES agent_workspaces(id) ON DELETE RESTRICT);')
    getDatabase().run('INSERT INTO fixture_workspace_refs VALUES (?)', [user.id])
    expect(() => deleteAgentWorkspace(user.id)).toThrow()
    expect(getAgentWorkspace(user.id)).toEqual(user); expect(fs.existsSync(user.path)).toBe(true)
    expect(raw('SELECT * FROM fixture_workspace_refs')[0].values).toEqual([[user.id]])
  })
  it('row deletion never deletes user directory; owned references (even archived sessions) block and malformed data fails closed', () => {
    const user = register('keep-dir'); fs.writeFileSync(path.join(user.path, 'keep'), 'keep')
    getDatabase().run('UPDATE agent_sessions SET data_json=? WHERE id=?', [JSON.stringify({ agentSession: { version: 1, workspace: { type: 'user', workspaceId: user.id } } }), 'legacy'])
    expect(() => deleteAgentWorkspace(user.id)).toThrow('REFERENCED'); expect(getAgentWorkspace(user.id)).toEqual(user)
    getDatabase().run("UPDATE agent_sessions SET data_json='invalid' WHERE id='legacy'")
    expect(() => deleteAgentWorkspace(user.id)).toThrow('REFERENCES_UNREADABLE')
    getDatabase().run("UPDATE agent_sessions SET data_json='{}' WHERE id='legacy'")
    const before = snapshot(); deleteAgentWorkspace(user.id)
    expect(() => getAgentWorkspace(user.id)).toThrow('NOT_FOUND'); expect(fs.readFileSync(path.join(user.path, 'keep'), 'utf8')).toBe('keep')
    expect(snapshot()).toEqual(before)
  })
})
