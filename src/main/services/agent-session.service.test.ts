import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({ app: { getPath: () => testRoot } }))
import { closeDatabase, initDatabase } from '../database'
import { appendAgentSessionEvent, branchAgentSession, createAgentSession, deleteAgentSession, getAgentSession } from './agent-session.service'
import { deleteMcpServer, listMcpServers, saveMcpServer, updateMcpServerStatus } from './mcp.service'

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
})

describe('MCP server persistence', () => {
  it('saves, updates status, lists and deletes without exposing env secrets', async () => {
    await initDatabase()
    const server = saveMcpServer({ name: 'test', transport: 'http', endpoint: 'http://127.0.0.1:1', env: { SECRET: 'hidden' } })
    expect(listMcpServers()[0]).toMatchObject({ id: server.id, name: 'test', status: 'disconnected', env: {} })
    expect(updateMcpServerStatus(server.id, 'failed', 'unreachable')).toMatchObject({ status: 'failed', error_message: 'unreachable' })
    expect(deleteMcpServer(server.id)).toBe(true)
  })
})
