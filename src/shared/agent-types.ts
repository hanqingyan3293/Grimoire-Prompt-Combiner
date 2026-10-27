export type AgentRuntimeKind = 'openai-compatible' | 'anthropic' | 'google' | 'codex' | 'opencode' | 'pi'
export type AgentSessionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'interrupted'
export type AgentSessionEventType = 'message' | 'tool-call' | 'tool-result' | 'permission' | 'status' | 'error'

/**
 * Grimoire-owned session metadata kept under data_json.agentSession.
 * This is an additive adapter namespace; it is not Cherry's MessageSnapshot.
 */
export type AgentSessionAttachmentStatus = 'available' | 'missing'
export type AgentSessionAttachment = {
  id: string
  sourceType: string
  originalName: string
  mimeType: string
  size: number
  sha256: string
  status: AgentSessionAttachmentStatus
  /** Main-process-only source path. Safe projections omit this field. */
  filePath?: string
}
export type AgentSessionWorkspace =
  | { type: 'user'; workspaceId: string }
  | { type: 'system'; path?: string; workspaceId?: string }
export type AgentSessionSnapshot = {
  version: 1
  capturedAt: string
  agentId?: string | null
  runtime: AgentRuntimeKind
  providerId: string
  model: string
  config?: Record<string, unknown>
}
export type AgentSessionData = {
  version: 1
  /** Main-owned native runtime reference; never accepted from generic renderer data writes. */
  runtimeSessionId?: string
  agentId?: string | null
  workspace?: AgentSessionWorkspace
  snapshot?: AgentSessionSnapshot
  attachments?: AgentSessionAttachment[]
}

export type AgentSessionRecord = {
  id: string
  runtime: AgentRuntimeKind
  provider_id: string
  model: string
  title: string
  status: AgentSessionStatus
  parent_id: string | null
  data: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type AgentSessionEventRecord = {
  id: string
  session_id: string
  sequence: number
  type: AgentSessionEventType
  data: Record<string, unknown>
  created_at: string
}

export type McpTransport = 'http' | 'stdio'
export type McpServerStatus = 'disconnected' | 'connecting' | 'connected' | 'failed'

export type McpServerRecord = {
  id: string
  name: string
  transport: McpTransport
  endpoint: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
  status: McpServerStatus
  error_message: string | null
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>
  enabled_tools: string[]
  /** Free-form server note (source detail form `description`); never sent to the server. */
  description: string
  /** Custom HTTP request headers (source detail form `headers`). */
  headers: Record<string, string>
  /** Per-request timeout in seconds; null falls back to the connector default. */
  timeout_seconds: number | null
  /**
   * Tools the user forced to prompt even though the server/global policy would
   * auto-approve them (source `disabledAutoApproveTools`). Persisted so the setting
   * round-trips; the permission policy does not consume it yet.
   */
  disabled_auto_approve_tools: string[]
  /**
   * Source "Long Running Mode": a progress notification resets the tool-call timeout,
   * up to a 10-minute ceiling. Consumed by `callMcpTool`'s timeout policy.
   */
  long_running: boolean
  /**
   * Package-registry URL for stdio servers launched through a package runner
   * (source `registryUrl`). Maps onto the runner's own env var — `NPM_CONFIG_REGISTRY`
   * for npx/bun, `UV_DEFAULT_INDEX`+`PIP_INDEX_URL` for uv/uvx. Empty means "use the
   * runner's own default".
   */
  registry_url: string
  /** Free-form labels (source `tags`); folded into the MCP list search text. */
  tags: string[]
  created_at: string
  updated_at: string
}
