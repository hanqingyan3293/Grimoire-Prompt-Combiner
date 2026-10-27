import crypto from 'crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import readline from 'readline'
import type { McpServerRecord, McpServerStatus, McpTransport } from '../../shared/agent-types'
import { getDatabase, saveDatabase } from '../database'
import { ToolRegistry } from '../ai/runtime/tools'

function parse(value: unknown, fallback: unknown) { try { return JSON.parse(String(value || '')) ?? fallback } catch { return fallback } }

/**
 * Observers for MCP table mutations. The shared-cache bridge subscribes so the
 * mounted source MCP pages see status/tool changes; kept as a plain listener list
 * (no Electron import here) so the service stays unit-testable.
 */
const changeListeners = new Set<() => void>()
export function onMcpServersChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}
function notifyServersChanged(): void {
  for (const listener of changeListeners) {
    try { listener() } catch {}
  }
}

/**
 * MCP tool-call progress, shaped exactly like the source `McpProgressEvent`
 * (`{ callId, progress }`, progress normalized to 0–1 — see the source
 * `McpRuntimeService` `onprogress` handler). The service owns no window; the IPC layer
 * subscribes and broadcasts, mirroring `onMcpServersChanged`.
 */
export type McpToolProgressEvent = { callId: string; progress: number }
const progressListeners = new Set<(event: McpToolProgressEvent) => void>()
export function onMcpToolProgress(listener: (event: McpToolProgressEvent) => void): () => void {
  progressListeners.add(listener)
  return () => progressListeners.delete(listener)
}
function notifyToolProgress(event: McpToolProgressEvent): void {
  for (const listener of progressListeners) {
    try { listener(event) } catch {}
  }
}
const MCP_COLUMNS = 'id,name,transport,endpoint,command,args_json,env_json,enabled,status,error_message,tools_json,enabled_tools_json,description,headers_json,timeout_seconds,disabled_auto_approve_tools_json,long_running,registry_url,tags_json,created_at,updated_at'
function rowToServer(row: unknown[], includeSecrets = false): McpServerRecord {
  return { id: String(row[0]), name: String(row[1]), transport: String(row[2]) as McpTransport, endpoint: String(row[3] || ''), command: String(row[4] || ''), args: parse(row[5], []) as string[], env: includeSecrets ? parse(row[6], {}) as Record<string, string> : {}, enabled: Number(row[7]) === 1, status: String(row[8] || 'disconnected') as McpServerStatus, error_message: row[9] == null ? null : String(row[9]), tools: parse(row[10], []) as McpServerRecord['tools'], enabled_tools: parse(row[11], []) as string[], description: String(row[12] || ''), headers: includeSecrets ? parse(row[13], {}) as Record<string, string> : {}, timeout_seconds: row[14] == null ? null : Number(row[14]), disabled_auto_approve_tools: parse(row[15], []) as string[], long_running: Number(row[16]) === 1, registry_url: String(row[17] || ''), tags: parse(row[18], []) as string[], created_at: String(row[19]), updated_at: String(row[20]) }
}
/**
 * `includeSecrets` controls the `env`/`headers` maps, which can carry credentials:
 * the default renderer-facing read returns them empty, and only main-process callers
 * that must know which keys exist (the compat transport, which masks the values
 * before projecting) pass `true`.
 */
export function listMcpServers(includeSecrets = false): McpServerRecord[] { const rows = getDatabase().exec('SELECT ' + MCP_COLUMNS + ' FROM mcp_servers ORDER BY updated_at DESC')[0]?.values || []; return rows.map(row => rowToServer(row, includeSecrets)) }
function getMcpServer(id: string, includeSecrets = false): McpServerRecord | null {
  const row = getDatabase().exec('SELECT ' + MCP_COLUMNS + ' FROM mcp_servers WHERE id=?', [id])[0]?.values?.[0]
  return row ? rowToServer(row, includeSecrets) : null
}
export function saveMcpServer(input: Partial<McpServerRecord>): McpServerRecord {
  const now = new Date().toISOString()
  const id = input.id || 'mcp_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20)
  const current = getMcpServer(id, true)
  const endpoint = input.endpoint !== undefined ? input.endpoint : (current?.endpoint || '')
  const command = input.command !== undefined ? input.command : (current?.command || '')
  const args = input.args !== undefined ? input.args : (current?.args || [])
  const env = input.env !== undefined ? input.env : (current?.env || {})
  const errorMessage = input.error_message !== undefined ? input.error_message : (current?.error_message || null)
  const tools = input.tools !== undefined ? input.tools : (current?.tools || [])
  const enabledTools = input.enabled_tools !== undefined ? input.enabled_tools : (current?.enabled_tools || [])
  const enabled = input.enabled === undefined ? (current ? (current.enabled ? 1 : 0) : 1) : (input.enabled ? 1 : 0)
  const description = input.description !== undefined ? input.description : (current?.description || '')
  const headers = input.headers !== undefined ? input.headers : (current?.headers || {})
  const timeoutSeconds = input.timeout_seconds !== undefined ? input.timeout_seconds : (current?.timeout_seconds ?? null)
  const disabledAutoApproveTools = input.disabled_auto_approve_tools !== undefined ? input.disabled_auto_approve_tools : (current?.disabled_auto_approve_tools || [])
  const longRunning = input.long_running !== undefined ? input.long_running : (current?.long_running || false)
  const registryUrl = input.registry_url !== undefined ? input.registry_url : (current?.registry_url || '')
  const tags = input.tags !== undefined ? input.tags : (current?.tags || [])
  const values = [id, input.name?.trim() || current?.name || '未命名 MCP', input.transport || current?.transport || 'http', endpoint, command, JSON.stringify(args), JSON.stringify(env), enabled, input.status || current?.status || 'disconnected', errorMessage, JSON.stringify(tools), JSON.stringify(enabledTools), description, JSON.stringify(headers), timeoutSeconds, JSON.stringify(disabledAutoApproveTools), longRunning ? 1 : 0, registryUrl, JSON.stringify(tags), now]
  if (current) getDatabase().run('UPDATE mcp_servers SET name=?,transport=?,endpoint=?,command=?,args_json=?,env_json=?,enabled=?,status=?,error_message=?,tools_json=?,enabled_tools_json=?,description=?,headers_json=?,timeout_seconds=?,disabled_auto_approve_tools_json=?,long_running=?,registry_url=?,tags_json=?,updated_at=? WHERE id=?', [...values.slice(1), id])
  else getDatabase().run('INSERT INTO mcp_servers (id,name,transport,endpoint,command,args_json,env_json,enabled,status,error_message,tools_json,enabled_tools_json,description,headers_json,timeout_seconds,disabled_auto_approve_tools_json,long_running,registry_url,tags_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [...values, now])
  saveDatabase(); notifyServersChanged(); return listMcpServers().find(server => server.id === id)!
}
export function deleteMcpServer(id: string) {
  const processState = processes.get(id)
  if (processState) { processState.reader.close(); processState.child.kill(); processes.delete(id) }
  httpConnections.delete(id)
  const result = getDatabase().run('DELETE FROM mcp_servers WHERE id=?', [id])
  saveDatabase()
  if (Number(result.changes || 0) > 0) notifyServersChanged()
  return Number(result.changes || 0) > 0
}
export function updateMcpServerStatus(id: string, status: McpServerStatus, errorMessage: string | null, tools: McpServerRecord['tools'] = []) { getDatabase().run('UPDATE mcp_servers SET status=?,error_message=?,tools_json=?,updated_at=? WHERE id=?', [status, errorMessage, JSON.stringify(tools), new Date().toISOString(), id]); saveDatabase(); notifyServersChanged(); return listMcpServers().find(server => server.id === id)! }

type McpPending = {
  resolve: (value: any) => void
  reject: (error: Error) => void
  /** Timer that rejects the call once the policy's budget is exhausted. */
  timer?: ReturnType<typeof setTimeout>
  /** Absolute deadline; progress notifications push it forward up to the ceiling. */
  deadline?: number
  /** Per-request budget, reapplied on each progress reset. */
  timeoutMs?: number
  /** When the call started — the Long Running Mode ceiling is measured from here. */
  startedAt?: number
  /**
   * Tool-call id this request belongs to, when it is a `tools/call`. Progress
   * notifications carry only the JSON-RPC request id, so the renderer-facing id is
   * recorded here to attribute each notification to the right tool block.
   */
  callId?: string
}
type McpProcess = { child: ChildProcessWithoutNullStreams; reader: readline.Interface; nextId: number; pending: Map<number, McpPending> }
type McpHttpConnection = { sessionId?: string }
const processes = new Map<string, McpProcess>()
const httpConnections = new Map<string, McpHttpConnection>()
/**
 * Per-server ceiling for in-flight Long Running calls, read by the stdio read loop when
 * a progress notification arrives. A notification carries only a `requestId`, not the
 * policy it belongs to, so the ceiling is recorded here when the call starts.
 * `null` means "this server has no Long Running call in flight" — progress resets nothing.
 */
const activeLongRunningCeiling = new Map<string, number | null>()

/**
 * Timeout policy for a tool call, mirroring the source `resolveMcpRequestOptions`
 * (`source/src/main/ai/mcp/mcpRequestOptions.ts`):
 *
 *  - `timeout`            per-request budget; the source defaults to 60s, and this
 *                         transport keeps its own 30s default when the column is unset.
 *  - `resetTimeoutOnProgress`  the user's Long Running Mode flag.
 *  - `maxTotalTimeout`    hard ceiling while Long Running Mode is on (10 minutes), so
 *                         a server cannot stream progress forever.
 *
 * Ordinary calls get a single deadline. Under Long Running Mode the deadline is pushed
 * forward on every progress notification until the ceiling is reached — which is the
 * whole point of the flag: a long job that keeps reporting progress is not a hang.
 */
function resolveCallTimeout(server: McpServerRecord): { timeoutMs: number; longRunning: boolean; maxTotalMs: number | null } {
  const timeoutMs = server.timeout_seconds && server.timeout_seconds > 0 ? server.timeout_seconds * 1000 : 30_000
  return { timeoutMs, longRunning: server.long_running, maxTotalMs: server.long_running ? 10 * 60 * 1000 : null }
}

/** Rejects a pending request once its deadline passes; cleared when the request settles. */
function armPendingDeadline(pending: McpPending, processState: McpProcess, id: number): void {
  if (pending.deadline === undefined) return
  const remaining = pending.deadline - Date.now()
  pending.timer = setTimeout(() => {
    const live = processState.pending.get(id)
    if (!live) return
    processState.pending.delete(id)
    live.reject(new Error('MCP 请求超时（' + Math.round(remaining) + 'ms）'))
  }, Math.max(1, remaining))
  // A pending MCP call must not hold the event loop open on its own.
  if (typeof pending.timer === 'object' && pending.timer && 'unref' in pending.timer) pending.timer.unref()
}

function sendRequest(processState: McpProcess, method: string, params: unknown, policy?: { timeoutMs?: number; maxTotalMs?: number | null }, callId?: string): Promise<any> {
  const id = processState.nextId++
  return new Promise((resolve, reject) => {
    const pending: McpPending = { resolve, reject, callId }
    if (policy?.timeoutMs) {
      const startedAt = Date.now()
      pending.startedAt = startedAt
      pending.timeoutMs = policy.timeoutMs
      // The ceiling applies from the start, so an unbounded Long Running call still
      // ends after 10 minutes even if it reports progress the whole way.
      pending.deadline = Math.min(startedAt + policy.timeoutMs, startedAt + (policy.maxTotalMs ?? policy.timeoutMs))
      armPendingDeadline(pending, processState, id)
    }
    processState.pending.set(id, pending)
    processState.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + String.fromCharCode(10))
  })
}

/**
 * Applies a progress notification to a pending call. Only a Long Running Mode call
 * extends; the ceiling is absolute, so progress past 10 minutes no longer helps.
 */
function resetDeadlineOnProgress(processState: McpProcess, id: number, maxTotalMs: number | null): void {
  const pending = processState.pending.get(id)
  if (!pending || pending.deadline === undefined || maxTotalMs === null) return
  const startedAt = pending.startedAt ?? Date.now()
  const ceiling = startedAt + maxTotalMs
  if (pending.deadline >= ceiling) return
  if (pending.timer) clearTimeout(pending.timer)
  pending.deadline = Math.min(Date.now() + (pending.timeoutMs ?? 0), ceiling)
  armPendingDeadline(pending, processState, id)
}

/**
 * Registry env a stdio server's package runner reads, mirroring the source `RUNNERS`
 * table (`source/src/main/ai/mcp/mcpLaunch.ts`). Keyed by the leading token of the
 * command so `npx`/`uvx`/`uv` pick up the user's private registry; any other command
 * gets nothing, exactly as upstream.
 */
const MCP_RUNNER_REGISTRY_ENV: Record<string, (url: string) => Record<string, string>> = {
  npx: url => ({ NPM_CONFIG_REGISTRY: url }),
  bunx: url => ({ NPM_CONFIG_REGISTRY: url }),
  uvx: url => ({ UV_DEFAULT_INDEX: url, PIP_INDEX_URL: url }),
  uv: url => ({ UV_DEFAULT_INDEX: url, PIP_INDEX_URL: url })
}

/**
 * The env a configured `registryUrl` contributes at launch. Exported for direct testing
 * because the spawn env also inherits the parent process environment — a registry
 * variable may already be set on the machine — so a child-reported value cannot
 * distinguish "injected here" from "inherited".
 */
export function resolveRunnerRegistryEnv(command: string, registryUrl: string): Record<string, string> {
  if (!registryUrl) return {}
  return MCP_RUNNER_REGISTRY_ENV[command.trim()]?.(registryUrl) ?? {}
}

async function connectStdio(server: McpServerRecord): Promise<McpServerRecord> {
  if (!server.command) throw new Error('stdio MCP 缺少启动命令')
  // Registry env sits UNDER the user's explicit `env` map, so a hand-set variable in
  // the detail form always wins over the derived one.
  const registryEnv = resolveRunnerRegistryEnv(server.command, server.registry_url)
  const child = spawn(server.command, server.args, { shell: false, windowsHide: true, stdio: 'pipe', env: { ...process.env, ...registryEnv, ...server.env } })
  const reader = readline.createInterface({ input: child.stdout })
  const processState: McpProcess = { child, reader, nextId: 1, pending: new Map() }
  processes.set(server.id, processState)
  reader.on('line', line => {
    try {
      const value = JSON.parse(line) as {
        id?: number
        method?: string
        params?: { requestId?: number; progressToken?: number | string; progress?: number; total?: number }
        result?: unknown
        error?: { message?: string }
      }
      // Progress notification: a server-streamed keep-alive, not a response. Under Long
      // Running Mode it extends the call's deadline (source `resetTimeoutOnProgress`);
      // independently, it is forwarded to the renderer so the tool block can show the
      // progress ring the source `MessageMcpTool` renders.
      if (typeof value.id !== 'number' && value.method === 'notifications/progress') {
        const requestId = value.params?.requestId
        if (typeof requestId === 'number') {
          resetDeadlineOnProgress(processState, requestId, activeLongRunningCeiling.get(server.id) ?? null)
          const pending = processState.pending.get(requestId)
          if (pending?.callId) {
            // Source ratio: `progress / (total || 1)`, so a server that reports only
            // `progress` still yields a usable 0–1 value.
            const rawProgress = Number(value.params?.progress ?? 0)
            const total = Number(value.params?.total ?? 0)
            const ratio = Number.isFinite(rawProgress) ? rawProgress / (total || 1) : 0
            notifyToolProgress({ callId: pending.callId, progress: Math.max(0, Math.min(1, ratio)) })
          }
        }
        return
      }
      if (typeof value.id !== 'number') return
      const pending = processState.pending.get(value.id)
      if (!pending) return
      processState.pending.delete(value.id)
      if (pending.timer) clearTimeout(pending.timer)
      if (value.error) pending.reject(new Error(value.error.message || 'MCP 请求失败'))
      else pending.resolve(value.result)
    } catch {}
  })
  child.once('exit', () => {
    for (const pending of processState.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(new Error('MCP stdio 进程已退出'))
    }
    processState.pending.clear()
    activeLongRunningCeiling.delete(server.id)
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

async function httpJsonRpc(server: McpServerRecord, method: string, params: unknown, id?: number, timeoutOverrideMs?: number) {
  // Custom headers from the source detail form's `headers` field are sent before the
  // protocol-controlled ones so a user header can never override the session/type
  // headers the transport depends on.
  const headers: Record<string, string> = { ...(server.headers || {}), accept: 'application/json, text/event-stream', 'content-type': 'application/json' }
  const connection = httpConnections.get(server.id) || {}
  if (connection.sessionId) headers['Mcp-Session-Id'] = connection.sessionId
  const payload: Record<string, unknown> = { jsonrpc: '2.0', method, params }
  if (id !== undefined) payload.id = id
  const timeoutMs = timeoutOverrideMs ?? (server.timeout_seconds && server.timeout_seconds > 0 ? server.timeout_seconds * 1000 : 30_000)
  const response = await fetch(server.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
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

function mapMcpTools(result: unknown): McpServerRecord['tools'] {
  const tools = (result as { tools?: unknown })?.tools
  return Array.isArray(tools)
    ? tools.map((tool: any) => ({ name: String(tool?.name || ''), description: typeof tool?.description === 'string' ? tool.description : undefined, inputSchema: tool?.inputSchema }))
    : []
}

export async function connectMcpServer(id: string): Promise<McpServerRecord> {
  const server = getMcpServer(id, true)
  if (!server) throw new Error('MCP Server 不存在')
  // Idempotent for stdio: a live process must be re-listed, never respawned — the
  // MCP settings page's tools tab calls refresh on activation for an already
  // connected server, and a second spawn would leak the first child process.
  const live = processes.get(id)
  if (live) {
    try {
      const result = await sendRequest(live, 'tools/list', {})
      return updateMcpServerStatus(id, 'connected', null, mapMcpTools(result))
    } catch (error) {
      live.reader.close()
      live.child.kill()
      processes.delete(id)
      return updateMcpServerStatus(id, 'failed', error instanceof Error ? error.message : String(error))
    }
  }
  updateMcpServerStatus(id, 'connecting', null)
  try {
    if (server.transport === 'stdio') return await connectStdio(server)
    if (!server.endpoint) throw new Error('HTTP MCP 缺少 endpoint')
    await httpJsonRpc(server, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Grimoire', version: '7.2.0' }, }, 1)
    await httpJsonRpc(server, 'notifications/initialized', {})
    const result = await httpJsonRpc(server, 'tools/list', {}, 2)
    return updateMcpServerStatus(id, 'connected', null, mapMcpTools(result))
  } catch (error) {
    httpConnections.delete(id)
    return updateMcpServerStatus(id, 'failed', error instanceof Error ? error.message : String(error))
  }
}

export function disconnectMcpServer(id: string): McpServerRecord {
  const processState = processes.get(id)
  if (processState) { processState.reader.close(); processState.child.kill(); processes.delete(id) }
  httpConnections.delete(id)
  activeLongRunningCeiling.delete(id)
  return updateMcpServerStatus(id, 'disconnected', null, [])
}

/** ASCII camelCase slug, mirroring the source `toCamelCase` (see the cache bridge). */
function toWireSlug(value: string): string {
  let result = value.trim().toLowerCase().replace(/[^a-z0-9]+(.)/g, (_m, char: string) => char.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '')
  if (result && !/^[a-zA-Z_]/.test(result)) result = '_' + result
  return result
}

function matchesMcpToolRule(value: string, serverName: string, toolName: string): boolean {
  return value === toolName || value === ('mcp__' + toWireSlug(serverName) + '__' + toWireSlug(toolName)) || value === ('mcp__' + toWireSlug(serverName) + '__*')
}

/**
 * Source `isMcpToolForcePromptBySource` semantics: a tool listed in the server's
 * `disabledAutoApproveTools` must always prompt, even when the session policy would
 * auto-allow its permission class. This can only force a prompt — it never grants.
 *
 * `registeredName` is the registry key (`mcp:<serverId>:<toolName>`) the permission
 * callback receives; a non-MCP tool name returns false.
 */
export function isMcpToolForcePrompt(registeredName: string): boolean {
  if (!registeredName.startsWith('mcp:')) return false
  const rest = registeredName.slice(4)
  const separator = rest.indexOf(':')
  if (separator === -1) return false
  const server = listMcpServers(true).find(item => item.id === rest.slice(0, separator))
  if (!server) return false
  const toolName = rest.slice(separator + 1)
  return server.disabled_auto_approve_tools.some(value => matchesMcpToolRule(value, server.name, toolName))
}

export async function callMcpTool(input: { serverId: string; name: string; arguments?: Record<string, unknown>; callId?: string }) {
  const server = getMcpServer(input.serverId)
  if (!server) throw new Error('MCP Server 不存在')
  if (server.status !== 'connected') throw new Error('MCP Server 未连接')
  const policy = resolveCallTimeout(server)
  if (server.transport === 'stdio') {
    const processState = processes.get(server.id)
    if (!processState) throw new Error('MCP stdio 进程不存在')
    // Record the ceiling for the read loop, which sees only a `requestId` on the
    // progress notifications it must use to extend this call.
    activeLongRunningCeiling.set(server.id, policy.maxTotalMs)
    try {
      return await sendRequest(processState, 'tools/call', { name: input.name, arguments: input.arguments || {} }, policy, input.callId)
    } finally {
      activeLongRunningCeiling.delete(server.id)
    }
  }
  // HTTP: the fetch timeout is the per-request budget, bounded by the Long Running
  // ceiling when the flag is on. Streamed progress is not consumed by this connector,
  // so a Long Running HTTP call gets the ceiling as its budget rather than a reset.
  const timeoutMs = policy.maxTotalMs ?? policy.timeoutMs
  return httpJsonRpc(server, 'tools/call', { name: input.name, arguments: input.arguments || {} }, Date.now(), timeoutMs)
}

export function registerMcpTools(registry: ToolRegistry): void {
  for (const server of listMcpServers().filter(item => item.status === 'connected' && item.enabled)) {
    const allowedTools = new Set(server.enabled_tools)
    for (const tool of server.tools.filter(item => allowedTools.has(item.name))) {
      const name = `mcp:${server.id}:${tool.name}`
      registry.register({
        name,
        description: tool.description || `${server.name} 的 MCP 工具 ${tool.name}`,
        permission: server.transport === 'stdio' ? 'execute' : 'network',
        inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema as Record<string, unknown> : { type: 'object', properties: {} },
        execute: (input, context) => callMcpTool({
          serverId: server.id,
          name: tool.name,
          arguments: input && typeof input === 'object' ? input as Record<string, unknown> : {},
          // The renderer subscribes to progress by the model's tool-call id.
          callId: context?.toolCallId
        }),
      })
    }
  }
}

export function createMcpToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registerMcpTools(registry)
  return registry
}
