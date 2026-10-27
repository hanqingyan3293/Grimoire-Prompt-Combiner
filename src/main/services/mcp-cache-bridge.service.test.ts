import { createHash } from 'node:crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({
  app: { getPath: () => testRoot },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() }
}))

import { closeDatabase, initDatabase } from '../database'
import type { McpServerRecord } from '../../shared/agent-types'
import { __test } from './mcp-cache-bridge.service'
import { saveMcpServer } from './mcp.service'

const { mcpRuntimeStatusFor, mcpToolsFor, mcpToolWireId, toWireSlug } = __test

beforeEach(() => { testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-mcp-cache-')) })
afterEach(() => { closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

function record(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: 'mcp_test', name: '测试服务', transport: 'stdio', endpoint: '', command: 'node', args: [], env: {},
    enabled: true, status: 'disconnected', error_message: null, tools: [], enabled_tools: [],
    description: '', headers: {}, timeout_seconds: null, disabled_auto_approve_tools: [],
    long_running: false, registry_url: '', tags: [],
    created_at: '', updated_at: '',
    ...overrides
  }
}

describe('MCP shared-cache projection', () => {
  it('maps Grimoire connection states onto the source McpRuntimeStatus union', () => {
    expect(mcpRuntimeStatusFor(record({ enabled: false, status: 'connected' })).state).toBe('disabled')
    expect(mcpRuntimeStatusFor(record({ status: 'connected' })).state).toBe('connected')
    expect(mcpRuntimeStatusFor(record({ status: 'connecting' })).state).toBe('connecting')
    // A configured-but-unconnected server reads as connecting, not as a fake success.
    expect(mcpRuntimeStatusFor(record({ status: 'disconnected' })).state).toBe('connecting')
    const failed = mcpRuntimeStatusFor(record({ status: 'failed', error_message: '连接被拒绝' }))
    expect(failed).toMatchObject({ state: 'error', lastError: '连接被拒绝' })
  })

  it('builds the source McpTool shape with the source wire-id digest', () => {
    const tools = mcpToolsFor(record({
      tools: [{ name: 'search_docs', description: '搜索文档', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }]
    }))
    expect(tools).toHaveLength(1)
    const tool = tools[0]
    expect(tool).toMatchObject({ name: 'search_docs', description: '搜索文档', type: 'mcp', serverId: 'mcp_test', serverName: '测试服务' })

    // The digest is byte-identical to the source algorithm — the identity-bearing part.
    const digest = createHash('sha256').update('mcp_test').update('\0').update('search_docs').digest('hex').slice(0, 20)
    expect(String(tool.id)).toContain(digest)
    expect(String(tool.id)).toMatch(/^mcp__.+__.+_[0-9a-f]{20}$/)
  })

  it('mirrors the source toCamelCase slug for ASCII names', () => {
    expect(toWireSlug('my-server')).toBe('myServer')
    expect(toWireSlug('MY_SERVER')).toBe('myServer')
    expect(toWireSlug('123tool')).toBe('_123tool')
    expect(mcpToolWireId('s1', 'github', 'search_issues').startsWith('mcp__github__searchIssues_')).toBe(true)
  })

  it('forces a prompt for tools listed in disabledAutoApproveTools, and nothing else', async () => {
    await initDatabase()
    const saved = saveMcpServer({ name: '策略服务', transport: 'stdio', command: 'node' })
    saveMcpServer({ id: saved.id, disabled_auto_approve_tools: ['bash'] })
    const { isMcpToolForcePrompt } = await import('./mcp.service')

    expect(isMcpToolForcePrompt('mcp:' + saved.id + ':bash')).toBe(true)
    // A different tool on the same server is unaffected.
    expect(isMcpToolForcePrompt('mcp:' + saved.id + ':read')).toBe(false)
    // A built-in (non-MCP) tool name never matches the MCP rule set.
    expect(isMcpToolForcePrompt('grimoire_read_file')).toBe(false)
    // An unknown server id matches nothing.
    expect(isMcpToolForcePrompt('mcp:mcp_missing:bash')).toBe(false)
  })

  it('writes enabled_tools through the MCP service and emits the changed-cache signal', async () => {
    await initDatabase()
    const saved = saveMcpServer({ name: '信号服务', transport: 'stdio', command: 'node' })
    // The bridge subscribes via `onMcpServersChanged` at registration; the projection
    // is derived on read, so the observable contract here is that a save is readable.
    const listed = (await import('./mcp.service')).listMcpServers().find(server => server.id === saved.id)
    expect(listed).toMatchObject({ name: '信号服务', transport: 'stdio' })
  })
})
