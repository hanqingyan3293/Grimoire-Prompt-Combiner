import crypto from 'crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import readline from 'readline'
import type { McpServerRecord, McpServerStatus, McpTransport } from '../../shared/agent-types'
import { getDatabase, saveDatabase } from '../database'

function parse(value: unknown, fallback: unknown) { try { return JSON.parse(String(value || '')) ?? fallback } catch { return fallback } }
function rowToServer(row: unknown[], includeSecrets = false): McpServerRecord {
  return { id: String(row[0]), name: String(row[1]), transport: String(row[2]) as McpTransport, endpoint: String(row[3] || ''), command: String(row[4] || ''), args: parse(row[5], []) as string[], env: includeSecrets ? parse(row[6], {}) as Record<string, string> : {}, enabled: Number(row[7]) === 1, status: String(row[8] || 'disconnected') as McpServerStatus, error_message: row[9] == null ? null : String(row[9]), tools: parse(row[10], []) as McpServerRecord['tools'], created_at: String(row[11]), updated_at: String(row[12]) }
}
export function listMcpServers(): McpServerRecord[] { const rows = getDatabase().exec('SELECT id,name,transport,endpoint,command,args_json,env_json,enabled,status,error_message,tools_json,created_at,updated_at FROM mcp_servers ORDER BY updated_at DESC')[0]?.values || []; return rows.map(row => rowToServer(row)) }
export function saveMcpServer(input: Partial<McpServerRecord>): McpServerRecord {
  const now = new Date().toISOString(); const id = input.id || 'mcp_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20); const existing = getDatabase().exec('SELECT id FROM mcp_servers WHERE id=?', [id])[0]?.values?.length
  const values = [id, input.name?.trim() || '未命名 MCP', input.transport || 'http', input.endpoint || '', input.command || '', JSON.stringify(input.args || []), JSON.stringify(input.env || {}), input.enabled === false ? 0 : 1, input.status || 'disconnected', input.error_message || null, JSON.stringify(input.tools || []), now]
  if (existing) getDatabase().run('UPDATE mcp_servers SET name=?,transport=?,endpoint=?,command=?,args_json=?,env_json=?,enabled=?,status=?,error_message=?,tools_json=?,updated_at=? WHERE id=?', [...values.slice(1), id])
  else getDatabase().run('INSERT INTO mcp_servers (id,name,transport,endpoint,command,args_json,env_json,enabled,status,error_message,tools_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [...values, now])
  saveDatabase(); return listMcpServers().find(server => server.id === id)!
}
export function deleteMcpServer(id: string) { const result = getDatabase().run('DELETE FROM mcp_servers WHERE id=?', [id]); saveDatabase(); return Number(result.changes || 0) > 0 }
export function updateMcpServerStatus(id: string, status: McpServerStatus, errorMessage: string | null, tools: McpServerRecord['tools'] = []) { getDatabase().run('UPDATE mcp_servers SET status=?,error_message=?,tools_json=?,updated_at=? WHERE id=?', [status, errorMessage, JSON.stringify(tools), new Date().toISOString(), id]); saveDatabase(); return listMcpServers().find(server => server.id === id)! }

type McpProcess = { child: ChildProcessWithoutNullStreams; reader: readline.Interface; nextId: number; pending: Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }> }
const processes = new Map<string, McpProcess>()

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

export async function connectMcpServer(id: string): Promise<McpServerRecord> {
  const server = listMcpServers().find(item => item.id === id)
  if (!server) throw new Error('MCP Server 不存在')
  updateMcpServerStatus(id, 'connecting', null)
  try {
    if (server.transport === 'stdio') return await connectStdio(server)
    if (!server.endpoint) throw new Error('HTTP MCP 缺少 endpoint')
    const response = await fetch(server.endpoint, { method: 'GET', signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error('HTTP ' + response.status)
    return updateMcpServerStatus(id, 'connected', null)
  } catch (error) {
    return updateMcpServerStatus(id, 'failed', error instanceof Error ? error.message : String(error))
  }
}

export function disconnectMcpServer(id: string): McpServerRecord {
  const processState = processes.get(id)
  if (processState) { processState.reader.close(); processState.child.kill(); processes.delete(id) }
  return updateMcpServerStatus(id, 'disconnected', null, [])
}

export async function callMcpTool(input: { serverId: string; name: string; arguments?: Record<string, unknown> }) {
  const server = listMcpServers().find(item => item.id === input.serverId)
  if (!server) throw new Error('MCP Server 不存在')
  if (server.status !== 'connected') throw new Error('MCP Server 未连接')
  if (server.transport === 'stdio') {
    const processState = processes.get(server.id)
    if (!processState) throw new Error('MCP stdio 进程不存在')
    return sendRequest(processState, 'tools/call', { name: input.name, arguments: input.arguments || {} })
  }
  const response = await fetch(server.endpoint, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: input.name, arguments: input.arguments || {} } }), signal: AbortSignal.timeout(30000) })
  const data = await response.json().catch(() => ({})) as { result?: unknown; error?: { message?: string } }
  if (!response.ok || data.error) throw new Error(data.error?.message || 'MCP 工具调用失败')
  return data.result
}
