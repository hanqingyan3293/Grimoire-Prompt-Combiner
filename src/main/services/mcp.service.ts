import crypto from 'crypto'
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
