import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord, AgentSessionSnapshot, McpServerRecord } from '../../shared/agent-types'
import { IPC_CHANNELS } from '../../shared/types'
const mocked = vi.hoisted(() => ({ root: '', handlers: new Map<string, (event: unknown, value?: unknown) => Promise<unknown>>() }))
vi.mock('electron', () => ({ app: { getPath: () => mocked.root }, ipcMain: { handle: (channel: string, handler: (event: unknown, value?: unknown) => Promise<unknown>) => mocked.handlers.set(channel, handler) } }))
import { registerAgentIPC, toMcpSaveInput } from './agent.ipc'
import { closeDatabase, getDatabase, initDatabase } from '../database'
import { createAgentBlueprint } from '../services/agent-blueprint.service'
import { createAgentSession, getAgentSession, listAgentSessions, normalizeAgentSessionData } from '../services/agent-session.service'

describe('registered session metadata IPC', () => {
  beforeEach(async () => {
    mocked.root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-agent-ipc-'))
    await initDatabase()
    mocked.handlers.clear()
    registerAgentIPC()
  })
  afterEach(() => { closeDatabase(); fs.rmSync(mocked.root, { recursive: true, force: true }) })
  function invoke(channel: string, value: unknown) {
    const handler = mocked.handlers.get(channel)
    if (!handler) throw new Error(`Missing handler ${channel}`)
    return handler({}, value)
  }

  it('fails closed on every stream command without reserving messages or launching runtime work', async () => {
    const blueprint = createAgentBlueprint({ name: 'Unsafe default native policy', type: 'pi', runtime: 'pi', model: 'missing-provider::model', configuration: { permission_mode: 'default' } })
    const session = createAgentSession({ runtime: 'pi', providerId: 'missing-provider', model: 'model', agentId: blueprint.id })
    const before = getDatabase().exec('SELECT count(*) FROM agent_session_events')[0].values[0][0]
    for (const channel of [IPC_CHANNELS.CHERRY_AGENT_STREAM_OPEN, IPC_CHANNELS.CHERRY_AGENT_STREAM_ATTACH, IPC_CHANNELS.CHERRY_AGENT_STREAM_ABORT, IPC_CHANNELS.CHERRY_AGENT_STREAM_CLOSE]) {
      expect(await invoke(channel, { sessionId: session.id, content: 'must not execute' })).toMatchObject({ status: 'unavailable', code: 'AGENT_RUNTIME_UNAVAILABLE' })
    }
    expect(getDatabase().exec('SELECT count(*) FROM agent_session_events')[0].values[0][0]).toBe(before)
    expect(getAgentSession(session.id)?.session.status).toBe('idle')
  })

  it.each([123, {}, [], true])('rejects explicitly invalid agentId %j before create or attach', async agentId => {
    await expect(invoke(IPC_CHANNELS.AGENT_SESSION_CREATE, { runtime: 'pi', agentId })).rejects.toThrow('AGENT_SESSION_INVALID_AGENT_ID')
    expect(listAgentSessions()).toHaveLength(0)
    const session = createAgentSession({ runtime: 'pi' })
    await expect(invoke(IPC_CHANNELS.AGENT_SESSION_ATTACH, { id: session.id, agentId })).rejects.toThrow('AGENT_SESSION_INVALID_AGENT_ID')
    expect(getAgentSession(session.id)?.session.data).toEqual({})
  })

  it('creates a real association, preserves it on generic update and checks replacement snapshots', async () => {
    const agent = createAgentBlueprint({ name: 'IPC agent', type: null, runtime: 'pi', model: 'p::m' })
    const snapshot: AgentSessionSnapshot = { version: 1, capturedAt: new Date().toISOString(), runtime: 'pi', providerId: 'p', model: 'm', agentId: agent.id }
    const session = await invoke(IPC_CHANNELS.AGENT_SESSION_CREATE, { runtime: 'pi', providerId: 'p', model: 'm', agentId: agent.id, snapshot }) as AgentSessionRecord
    await invoke(IPC_CHANNELS.AGENT_SESSION_UPDATE, { id: session.id, data: { command: 'pi', token: 'legacy' } })
    expect(normalizeAgentSessionData(getAgentSession(session.id)?.session.data.agentSession)?.snapshot).toEqual(snapshot)
    await expect(invoke(IPC_CHANNELS.AGENT_SESSION_UPDATE, { id: session.id, data: { agentSession: { version: 1 } } })).rejects.toThrow('AGENT_SESSION_NAMESPACE_OWNED')
    await expect(invoke(IPC_CHANNELS.AGENT_SESSION_SNAPSHOT, { id: session.id, snapshot: { ...snapshot, config: [] } })).rejects.toThrow('AGENT_SESSION_INVALID_CONFIG')
    await expect(invoke(IPC_CHANNELS.AGENT_SESSION_SNAPSHOT, { id: session.id, snapshot: { ...snapshot, runtime: 'codex' } })).rejects.toThrow('AGENT_SESSION_SNAPSHOT_MISMATCH')
    await invoke(IPC_CHANNELS.AGENT_SESSION_SNAPSHOT, { id: session.id, snapshot: { ...snapshot, config: { temperature: 0.3 } } })
    expect(normalizeAgentSessionData(getAgentSession(session.id)?.session.data.agentSession)?.snapshot?.config).toEqual({ temperature: 0.3 })
    await invoke(IPC_CHANNELS.AGENT_SESSION_ATTACH, { id: session.id, agentId: null })
    expect(normalizeAgentSessionData(getAgentSession(session.id)?.session.data.agentSession)?.agentId).toBeNull()
    expect(normalizeAgentSessionData(getAgentSession(session.id)?.session.data.agentSession)?.snapshot?.agentId).toBe(agent.id)
  })

  it('rejects missing associations and unsafe paths without creating sessions', async () => {
    for (const agentId of ['missing', '/private/agent']) await expect(invoke(IPC_CHANNELS.AGENT_SESSION_CREATE, { runtime: 'pi', agentId })).rejects.toThrow()
    await expect(invoke(IPC_CHANNELS.AGENT_SESSION_CREATE, { runtime: 'pi', workspace: { type: 'user', workspaceId: 'C:/private/workspace' } })).rejects.toThrow('AGENT_SESSION_INVALID_WORKSPACE')
    expect(listAgentSessions()).toHaveLength(0)
  })
})

const MASK = '••••••••'

function storedServer(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: 'mcp_a', name: '服务', transport: 'http', endpoint: 'https://x.invalid/sse', command: '', args: [],
    env: {}, enabled: true, status: 'disconnected', error_message: null, tools: [], enabled_tools: [],
    description: '', headers: { Authorization: 'Bearer secret' }, timeout_seconds: null,
    disabled_auto_approve_tools: ['search'], long_running: false, registry_url: '', tags: [],
    created_at: '', updated_at: '',
    ...overrides
  }
}

describe('MCP save payload mapping', () => {
  it('forwards every v24/v25 column the MCP UI writes', () => {
    // Regression: this mapping previously forwarded description/headers/timeout but
    // dropped disabled_auto_approve_tools and the v25 fields, so the "always allow"
    // action and the detail form's switches persisted NOTHING while reporting success.
    const mapped = toMcpSaveInput({
      id: 'mcp_a',
      disabled_auto_approve_tools: ['search', 'write'],
      long_running: true,
      registry_url: 'https://registry.invalid',
      tags: ['检索', '  ', 'docs']
    }, storedServer())

    expect(mapped.disabled_auto_approve_tools).toEqual(['search', 'write'])
    expect(mapped.long_running).toBe(true)
    expect(mapped.registry_url).toBe('https://registry.invalid')
    // Blank tags are dropped, matching the DataApi transport's own filtering.
    expect(mapped.tags).toEqual(['检索', 'docs'])
  })

  it('distinguishes "field absent" from "field set to a falsy value"', () => {
    // An absent field must stay absent so `saveMcpServer` keeps the stored value; a
    // present `false`/empty value is a real edit and must be written through.
    const untouched = toMcpSaveInput({ id: 'mcp_a' }, storedServer({ long_running: true }))
    expect(untouched).not.toHaveProperty('long_running')
    expect(untouched).not.toHaveProperty('disabled_auto_approve_tools')

    const cleared = toMcpSaveInput({ id: 'mcp_a', long_running: false, disabled_auto_approve_tools: [], tags: [], registry_url: '' }, storedServer())
    expect(cleared.long_running).toBe(false)
    expect(cleared.disabled_auto_approve_tools).toEqual([])
    expect(cleared.tags).toEqual([])
    expect(cleared.registry_url).toBe('')
  })

  it('restores a masked secret echoed back instead of persisting the mask', () => {
    const mapped = toMcpSaveInput(
      { id: 'mcp_a', headers: { Authorization: MASK, 'X-New': 'plain' } },
      storedServer()
    )
    // The echoed placeholder keeps the stored secret; a genuinely new value is written.
    expect(mapped.headers).toEqual({ Authorization: 'Bearer secret', 'X-New': 'plain' })
  })

  it('ignores wrong-typed values rather than coercing them', () => {
    const mapped = toMcpSaveInput({
      id: 'mcp_a',
      long_running: 'yes',      // not a boolean
      registry_url: 42,         // not a string
      tags: 'not-an-array',
      disabled_auto_approve_tools: null
    }, storedServer())
    expect(mapped).not.toHaveProperty('long_running')
    expect(mapped).not.toHaveProperty('registry_url')
    expect(mapped).not.toHaveProperty('tags')
    expect(mapped).not.toHaveProperty('disabled_auto_approve_tools')
  })
})
