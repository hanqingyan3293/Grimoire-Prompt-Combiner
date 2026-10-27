import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateAgentBlueprint, UpdateAgentBlueprint } from '../../shared/agent-blueprint-types'
let root = ''
vi.mock('electron', () => ({ app: { getPath: (name: string) => name === 'exe' ? path.join(root, 'Grimoire.exe') : root } }))
import { closeDatabase, CURRENT_SCHEMA_VERSION, getDatabase, initDatabase } from '../database'
import { archiveAgentBlueprint, createAgentBlueprint, getAgentBlueprint, listAgentBlueprints, restoreAgentBlueprint, updateAgentBlueprint } from './agent-blueprint.service'
const base: CreateAgentBlueprint = { name: 'Reusable', model: 'provider::model', type: null, runtime: 'opencode' }
beforeEach(async () => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-blueprints-')); await initDatabase() })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })
const createUnsafe = (data: unknown) => createAgentBlueprint(data as CreateAgentBlueprint)
const updateUnsafe = (id: string, data: unknown) => updateAgentBlueprint(id, data as UpdateAgentBlueprint)
const tables = ['agent_sessions', 'agent_session_events', 'ai_sessions', 'ai_messages', 'ai_events', 'ai_attachments', 'ai_topics', 'cherry_resource_state']
function snapshot() { return Object.fromEntries(tables.map(table => [table, getDatabase().exec(`SELECT * FROM ${table} ORDER BY id`.replace('ORDER BY id', table === 'cherry_resource_state' ? 'ORDER BY entity_type,entity_id' : 'ORDER BY id'))])) }

describe('P1 source-shaped blueprint persistence (not execution)', () => {
  it('upgrades real v31 fixture with backup, preserves both session stores and infers NO blueprints', async () => {
    const db = getDatabase(), now = '2026-01-01T00:00:00.000Z'
    db.run('INSERT INTO agent_sessions (id,runtime,provider_id,model,title,status,parent_id,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', ['legacy', 'opencode', 'p', 'm', 'Same name', 'failed', null, '{"nested":{"keep":true}}', now, now])
    db.run('INSERT INTO agent_session_events (id,session_id,sequence,type,data_json,created_at) VALUES (?,?,?,?,?,?)', ['le', 'legacy', 0, 'error', '{"message":"keep"}', now])
    db.run('INSERT INTO ai_sessions (id,kind,runtime,provider_id,model_id,title,status,parent_id,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', ['unified', 'agent', 'pi', 'p', 'm', 'Same name', 'completed', null, '{"legacyId":"legacy","snapshot":"keep"}', now, now])
    db.run('INSERT INTO ai_messages (id,session_id,sequence,role,content_json,attachments_json,status,created_at) VALUES (?,?,?,?,?,?,?,?)', ['msg', 'unified', 0, 'assistant', '{"text":"keep"}', '[]', 'completed', now])
    db.run('INSERT INTO ai_events (id,session_id,sequence,event_type,payload_json,created_at) VALUES (?,?,?,?,?,?)', ['ev', 'unified', 0, 'status', '{"keep":true}', now])
    db.run('INSERT INTO ai_attachments (id,session_id,file_path,created_at,updated_at) VALUES (?,?,?,?,?)', ['file', 'unified', 'C:/keep', now, now])
    const before = snapshot()
    const file = path.join(root, 'grimoire.db')
    closeDatabase()
    const fixture = new DatabaseSync(file)
    fixture.exec('DROP TABLE agent_blueprints')
    fixture.prepare("DELETE FROM schema_meta WHERE key='agent_blueprints_migrated'").run()
    fixture.prepare("UPDATE schema_meta SET value='31' WHERE key='schema_version'").run()
    fixture.close()
    await initDatabase()
    expect(snapshot()).toEqual(before)
    expect(listAgentBlueprints().total).toBe(0)
    expect(getDatabase().exec("SELECT value FROM schema_meta WHERE key='schema_version'")[0].values[0][0]).toBe(String(CURRENT_SCHEMA_VERSION))
    const backups = fs.readdirSync(root).filter(name => name.includes('.pre-migration-') && !name.endsWith('-shm') && !name.endsWith('-wal'))
    expect(backups).toHaveLength(1)
    const backup = new DatabaseSync(path.join(root, backups[0]), { readOnly: true })
    expect(backup.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get()?.value).toBe('31')
    expect(backup.prepare("SELECT name FROM sqlite_master WHERE name='agent_blueprints'").get()).toBeUndefined()
    backup.close()
    const agent = createAgentBlueprint(base), marker = getDatabase().exec("SELECT value FROM schema_meta WHERE key='agent_blueprints_migrated'")
    closeDatabase(); await initDatabase()
    expect(getAgentBlueprint(agent.id)).toEqual(agent)
    expect(getDatabase().exec("SELECT value FROM schema_meta WHERE key='agent_blueprints_migrated'")).toEqual(marker)
    expect(snapshot()).toEqual(before)
    expect(fs.readdirSync(root).filter(name => name.includes('.pre-migration-') && !name.endsWith('-shm') && !name.endsWith('-wal'))).toEqual(backups)
  })
  it('stores every real source field; runtime does not masquerade as source type', async () => {
    const agent = createAgentBlueprint({ ...base, description: 'desc', instructions: 'exact', planModel: 'p::plan', smallModel: 'p::small', mcps: ['mcp', 'mcp'], knowledgeBaseIds: ['kb', 'kb'], disabledTools: ['read', 'read'], configuration: { avatar: 'a', permission_mode: 'plan', reasoning_effort: 'ultra', service_tier: 'flex', slash_commands: ['/a'], language: ' English ', future: { nested: [1, true] } } })
    expect(agent).toMatchObject({ type: null, runtime: 'opencode', model: 'provider::model', planModel: 'p::plan', smallModel: 'p::small', description: 'desc', instructions: 'exact', mcps: ['mcp'], knowledgeBaseIds: ['kb'], disabledTools: ['read'], configuration: { language: 'English', future: { nested: [1, true] } } })
    closeDatabase(); await initDatabase(); expect(getAgentBlueprint(agent.id)).toEqual(agent)
    expect(createAgentBlueprint({ ...base, type: 'pi', runtime: 'pi' }).type).toBe('pi')
    expect(() => createUnsafe({ ...base, type: 'opencode' })).toThrow('type')
    expect(() => createUnsafe({ ...base, runtime: 'claude-code' })).toThrow('runtime')
    expect(() => updateUnsafe(agent.id, { type: 'claude-code' })).toThrow('UNSUPPORTED_FIELD')
  })
  it('shallow merges latest configuration, removes explicit undefined and replaces nested values', () => {
    const agent = createAgentBlueprint({ ...base, configuration: { avatar: 'a', future: { a: 1, b: 2 }, slash_commands: ['/old'], heartbeat_interval: 5 } })
    updateAgentBlueprint(agent.id, { configuration: { scheduler_enabled: false } })
    const updated = updateAgentBlueprint(agent.id, { configuration: { future: { b: 3 }, avatar: undefined, slash_commands: [], heartbeat_interval: 0 } })!
    expect(updated.configuration).toEqual({ future: { b: 3 }, slash_commands: [], heartbeat_interval: 0, scheduler_enabled: false })
    expect(updateAgentBlueprint(agent.id, { planModel: 'p::plan', smallModel: 'p::small' })?.model).toBe(base.model)
    expect(updateAgentBlueprint(agent.id, { model: null, planModel: null, smallModel: null })).toMatchObject({ model: null })
    expect(getAgentBlueprint(agent.id)?.planModel).toBeUndefined()
    expect(getAgentBlueprint(agent.id)?.smallModel).toBeUndefined()
  })
  it.each(['model', '::m', 'p::', 'p::m?x', 'p::m#x', 42])('validates composite model %s without catalog guessing', value => {
    expect(() => createUnsafe({ ...base, model: value })).toThrow('INVALID_MODEL')
    const agent = createAgentBlueprint(base)
    for (const field of ['model', 'planModel', 'smallModel']) expect(() => updateUnsafe(agent.id, { [field]: value })).toThrow('INVALID_MODEL')
    expect(getAgentBlueprint(agent.id)).toEqual(agent)
  })
  it('permits further separators and source provider route-char semantics', () => {
    expect(createAgentBlueprint({ ...base, model: 'provider?x::namespace::model' }).model).toBe('provider?x::namespace::model')
    expect(() => createUnsafe({ ...base, model: null })).toThrow('INVALID_MODEL')
  })
  it('rejects reserved identity, secrets, non-JSON and invalid known configuration without writes', () => {
    const agent = createAgentBlueprint(base)
    for (const configuration of [{ builtin_role: 'assistant' }, { builtin_role: undefined }, { env_vars: { KEY: 'secret-canary' } }, { future: { env_vars: { KEY: 'secret-canary' } } }, { heartbeat_interval: '5' }, { permission_mode: 'anything' }, { language: 'en\nUS' }, { future: Infinity }, { future: { value: undefined } }]) {
      expect(() => createUnsafe({ ...base, configuration })).toThrow()
      expect(() => updateUnsafe(agent.id, { configuration })).toThrow()
    }
    expect(getAgentBlueprint(agent.id)).toEqual(agent)
    expect(listAgentBlueprints().total).toBe(1)
    expect(JSON.stringify(getDatabase().exec('SELECT * FROM agent_blueprints'))).not.toContain('secret-canary')
  })
  it('never returns stored env secrets in read/create-update responses or paginated DTOs', () => {
    const agent = createAgentBlueprint(base)
    getDatabase().run('UPDATE agent_blueprints SET configuration_json=? WHERE id=?', [JSON.stringify({ env_vars: { KEY: 'secret-canary' }, future: { env_vars: { KEY: 'secret-canary' }, keep: 1 }, avatar: 'keep' }), agent.id])
    expect(getAgentBlueprint(agent.id)?.configuration).toEqual({ future: { keep: 1 }, avatar: 'keep' })
    expect(JSON.stringify(listAgentBlueprints())).not.toContain('secret-canary')
    expect(JSON.stringify(updateAgentBlueprint(agent.id, { name: 'Renamed' }))).not.toContain('secret-canary')
    // Projection is not a destructive migration; raw main-owned data survives.
    expect(String(getDatabase().exec('SELECT configuration_json FROM agent_blueprints')[0].values[0][0])).toContain('secret-canary')
  })
  it('does not project an imported configuration array as an Agent configuration object', () => {
    const agent = createAgentBlueprint(base)
    const stored = JSON.stringify([{ env_vars: { KEY: 'secret-canary' } }, { keep: true }])
    getDatabase().run('UPDATE agent_blueprints SET configuration_json=? WHERE id=?', [stored, agent.id])
    expect(getAgentBlueprint(agent.id)?.configuration).toEqual({})
    expect(listAgentBlueprints().agents[0].configuration).toEqual({})
    expect(String(getDatabase().exec('SELECT configuration_json FROM agent_blueprints WHERE id=?', [agent.id])[0].values[0][0])).toBe(stored)
  })

  it('archives/restores without changing fields, order, references or execution history', () => {
    const agent = createAgentBlueprint({ ...base, configuration: { future: { keep: true } }, mcps: ['m'], knowledgeBaseIds: ['kb'], disabledTools: ['write'] }), before = snapshot()
    expect(archiveAgentBlueprint(agent.id)).toBe(true)
    expect(archiveAgentBlueprint(agent.id)).toBe(false)
    expect(getAgentBlueprint(agent.id)).toBeNull()
    expect(updateAgentBlueprint(agent.id, { name: 'should not write' })).toBeNull()
    expect(listAgentBlueprints().total).toBe(0)
    expect(listAgentBlueprints({ inTrash: true }).agents[0]).toMatchObject({ ...agent, deletedAt: expect.any(String) })
    expect(restoreAgentBlueprint(agent.id)).toEqual(agent)
    expect(restoreAgentBlueprint(agent.id)).toBeNull()
    expect(snapshot()).toEqual(before)
    expect(archiveAgentBlueprint('missing')).toBe(false)
  })
  it('paginates source defaults and escaped search with authoritative total and stable order', () => {
    const first = createAgentBlueprint({ ...base, name: 'literal_%' })
    const second = createAgentBlueprint({ ...base, name: 'second', description: 'needle' })
    const third = createAgentBlueprint({ ...base, name: 'third' })
    expect(listAgentBlueprints({ limit: 1 })).toMatchObject({ total: 3, page: 1, limit: 1, agents: [third] })
    expect(listAgentBlueprints({ page: 2, limit: 1 }).agents).toEqual([second])
    expect(listAgentBlueprints({ search: '_%' }).agents).toEqual([first])
    expect(listAgentBlueprints({ search: 'NEEDLE' }).agents).toEqual([second])
    expect(listAgentBlueprints({ ids: [first.id, third.id] }).total).toBe(2)
    expect(listAgentBlueprints({ page: 99 }).agents).toEqual([])
    for (const request of [{ limit: 501 }, { page: 0 }, { limit: 1.2 }, { ids: [] }, { search: ' ' }]) expect(() => listAgentBlueprints(request)).toThrow()
  })
  it('does not accept skills, workspace provisioning, read-only fields or permissions by storage', () => {
    for (const data of [{ skillIds: ['skill'] }, { skillUpdates: [] }, { workspace: 'C:/project' }, { orderKey: 'fake' }, { deletedAt: 'fake' }, { id: 'fake' }]) expect(() => createUnsafe({ ...base, ...data })).toThrow('UNSUPPORTED_FIELD')
  })
})
