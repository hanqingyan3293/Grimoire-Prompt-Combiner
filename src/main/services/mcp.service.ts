import crypto from 'crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import readline from 'readline'
import type { McpServerRecord, McpServerStatus, McpTransport } from '../../shared/agent-types'
import { getDatabase, saveDatabase } from '../database'
import { ToolRegistry } from '../ai/runtime/tools'

function parse(value: unknown, fallback: unknown) { try { return JSON.parse(String(value || '')) ?? fallback } catch { return fallback } }
function rowToServer(row: unknown[], includeSecrets = false): McpServerRecord {
  return { id: String(row[0]), name: String(row[1]), transport: String(row[2]) as McpTransport, endpoint: String(row[3] || ''), command: String(row[4] || ''), args: parse(row[5], []) as string[], env: includeSecrets ? parse(row[6], {}) as Record<string, string> : {}, enabled: Number(row[7]) === 1, status: String(row[8] || 'disconnected') as McpServerStatus, error_message: row[9] == null ? null : String(row[9]), tools: parse(row[10], []) as McpServerRecord['tools'], created_at: String(row[11]), updated_at: String(row[12]) }
}
export function listMcpServers(): McpServerRecord[] { const rows = getDatabase().exec('SELECT id,name,transport,endpoint,command,args_json,env_json,enabled,status,error_message,tools_json,created_at,updated_at FROM mcp_servers ORDER BY updated_at DESC')[0]?.values || []; return rows.map(row => rowToServer(row)) }
function getMcpServer(id: string, includeSecrets = false): McpServerRecord | null {
  const row = getDatabase().exec('SELECT id,name,transport,endpoint,command,args_json,env_json,enabled,status,error_message,tools_json,created_at,updated_at FROM mcp_servers WHERE id=?', [id])[0]?.values?.[0]
  return row ? rowToServer(row, includeSecrets) : null
}
export function saveMcpServer(input: Partial<McpServerRecord>): McpServerRecord {
  const now = new Date().toISOString(); const id = input.id || 'mcp_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20); const existing = getDatabase().exec('SELECT id FROM mcp_servers WHERE id=?', [id])[0]?.values?.length
  const values = [id, input.name?.trim() || '未命名 MCP', input.transport || 'http', input.endpoint || '', input.command || '', JSON.stringify(input.args || []), JSON.stringify(input.env || {}), input.enabled === false ? 0 : 1, input.status || 'disconnected', input.error_message || null, JSON.stringify(input.tools || []), now]
  if (existing) getDatabase().run('UPDATE mcp_servers SET name=?,transport=?,endpoint=?,command=?,args_json=?,env_json=?,enabled=?,status=?,error_message=?,tools_json=?,updated_at=? WHERE id=?', [...values.slice(1), id])
  else getDatabase().run('INSERT INTO mcp_servers (id,name,transport,endpoint,command,args_json,env_json,enabled,status,error_message,tools_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [...values, now])
  saveDatabase(); return listMcpServers().find(server => server.id === id)!
}
export function deleteMcpServer(id: string) {
  const processState = processes.get(id)
  if (processState) { processState.reader.close(); processState.child.kill(); processes.delete(id) }
  httpConnections.delete(id)
  const result = getDatabase().run('DELETE FROM mcp_servers WHERE id=?', [id])
  saveDatabase()
  return Number(result.changes || 0) > 0
}
export function updateMcpServerStatus(id: string, status: McpServerStatus, errorMessage: string | null, tools: McpServerRecord['tools'] = []) { getDatabase().run('UPDATE mcp_servers SET status=?,error_message=?,tools_json=?,updated_at=? WHERE id=?', [status, errorMessage, JSON.stringify(tools), new Date().toISOString(), id]); saveDatabase(); return listMcpServers().find(server => server.id === id)! }

type McpProcess = { child: ChildProcessWithoutNullStreams; reader: readline.Interface; nextId: number; pending: Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }> }
type McpHttpConnection = { sessionId?: string }
const processes = new Map<string, McpProcess>()
const httpConnections = new Map<string, McpHttpConnection>()

function sendRequest(processState: McpProcess, method: string, params: unknown): Promise<any> {
  const id = processState.nextId++
  return new Promise((resolve, reject) => {
    processState.pending.set(id, { resolve, reject })
    processState.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + String.fromCharCode(10))
  })
}

async function connectStdio(server: McpServerRecord): Promise<McpServerRecord> {
  if (!server.command) throw new Error('stdio MCP 缺少启动命令')
  const child = spawn(server.command, server.args, { shell: false, windowsHide: true, stdio: 'pipe', env: { ...process.env, ...server.env } })
  const reader = readline.createInterface({ input: child.stdout })
  const processState: McpProcess = { child, reader, nextId: 1, pending: new Map() }
  processes.set(server.id, processState)
  reader.on('line', line => {
    try {
      const value = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } }
      if (typeof value.id !== 'number') return
      const pending = processState.pending.get(value.id)
      if (!pending) return
      processState.pending.delete(value.id)
      if (value.error) pending.reject(new Error(value.error.message || 'MCP 请求失败'))
      else pending.resolve(value.result)
    } catch {}
  })
  child.once('exit', () => {
    for (const pending of processState.pending.values()) pending.reject(new Error('MCP stdio 进程已退出'))
    processState.pending.clear()
    if (processes.get(server.id) === processState) processes.delete(server.id)
  })
  try {
    await sendRequest(processState, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Grimoire', version: '7.2.0' } })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + String.fromCharCode(10))
    const result = await sendRequest(processState, 'tools/list', {})
    const tools = Array.isArray(result?.tools) ? result.tools.map((tool: any) => ({ name: String(tool.name || ''), description: typeof tool.description === 'string' ? tool.description : undefined, inputSchema: tool.inputSchema })) : []
    return updateMcpServerStatus(server.id, 'connected', null, tools)
  } catch (error) {
    child.kill()
    processes.delete(server.id)
    throw error
  }
}

async function httpJsonRpc(server: McpServerRecord, method: string, params: unknown, id?: number) {
  const headers: Record<string, string> = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' }
  const connection = httpConnections.get(server.id) || {}
  if (connection.sessionId) headers['Mcp-Session-Id'] = connection.sessionId
  const payload: Record<string, unknown> = { jsonrpc: '2.0', method, params }
  if (id !== undefined) payload.id = id
  const response = await fetch(server.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  })
  const sessionId = response.headers.get('mcp-session-id')
  if (sessionId) { connection.sessionId = sessionId; httpConnections.set(server.id, connection) }
  const text = await response.text()
  let data: any = {}
  try { data = JSON.parse(text) } catch {
    const line = text.split(/\r?\n/).find(item => item.startsWith('data:'))
    if (line) data = JSON.parse(line.slice(5).trim())
  }
  if (!response.ok || data.error) throw new Error(data.error?.message || 'MCP HTTP 请求失败：HTTP ' + response.status)
  return data.result
}

export async function connectMcpServer(id: string): Promise<McpServerRecord> {
  const server = getMcpServer(id, true)
  if (!server) throw new Error('MCP Server 不存在')
  updateMcpServerStatus(id, 'connecting', null)
  try {
    if (server.transport === 'stdio') return await connectStdio(server)
    if (!server.endpoint) throw new Error('HTTP MCP 缺少 endpoint')
    await httpJsonRpc(server, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Grimoire', version: '7.2.0' }, }, 1)
    await httpJsonRpc(server, 'notifications/initialized', {})
    const result = await httpJsonRpc(server, 'tools/list', {}, 2)
    const tools = Array.isArray(result?.tools) ? result.tools.map((tool: any) => ({ name: String(tool.name || ''), description: typeof tool.description === 'string' ? tool.description : undefined, inputSchema: tool.inputSchema })) : []
    return updateMcpServerStatus(id, 'connected', null, tools)
  } catch (error) {
    httpConnections.delete(id)
    return updateMcpServerStatus(id, 'failed', error instanceof Error ? error.message : String(error))
  }
}

export function disconnectMcpServer(id: string): McpServerRecord {
  const processState = processes.get(id)
  if (processState) { processState.reader.close(); processState.child.kill(); processes.delete(id) }
  httpConnections.delete(id)
  return updateMcpServerStatus(id, 'disconnected', null, [])
}

export async function callMcpTool(input: { serverId: string; name: string; arguments?: Record<string, unknown> }) {
  const server = getMcpServer(input.serverId)
  if (!server) throw new Error('MCP Server 不存在')
  if (server.status !== 'connected') throw new Error('MCP Server 未连接')
  if (server.transport === 'stdio') {
    const processState = processes.get(server.id)
    if (!processState) throw new Error('MCP stdio 进程不存在')
    return sendRequest(processState, 'tools/call', { name: input.name, arguments: input.arguments || {} })
  }
  return httpJsonRpc(server, 'tools/call', { name: input.name, arguments: input.arguments || {} }, Date.now())
}

export function registerMcpTools(registry: ToolRegistry): void {
  for (const server of listMcpServers().filter(item => item.status === 'connected' && item.enabled)) {
    for (const tool of server.tools) {
      const name = `mcp:${server.id}:${tool.name}`
      registry.register({
        name,
        description: tool.description || `${server.name} 的 MCP 工具 ${tool.name}`,
        permission: server.transport === 'stdio' ? 'execute' : 'network',
        inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema as Record<string, unknown> : { type: 'object', properties: {} },
        execute: (input) => callMcpTool({ serverId: server.id, name: tool.name, arguments: input && typeof input === 'object' ? input as Record<string, unknown> : {} }),
      })
    }
  }
}

export function createMcpToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registerMcpTools(registry)
  return registry
}
