export type AgentRuntimeKind = 'openai-compatible' | 'codex' | 'opencode' | 'pi'
export type AgentSessionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'interrupted'
export type AgentSessionEventType = 'message' | 'tool-call' | 'tool-result' | 'permission' | 'status' | 'error'

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
  created_at: string
  updated_at: string
}
