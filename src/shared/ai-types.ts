export type AiSessionKind = "chat" | "agent" | "vision" | "drawing" | "canvas"
export type AiSessionStatus = "idle" | "running" | "completed" | "failed" | "interrupted"
export type AiMessageRole = "system" | "user" | "assistant" | "tool"
export type AiMessageStatus = "pending" | "streaming" | "completed" | "failed" | "cancelled"

export type AiRuntimeKind = "openai-compatible" | "anthropic" | "google" | "codex" | "opencode" | "pi"

export type AiEventType =
  | "session-started"
  | "message-started"
  | "text-delta"
  | "reasoning-delta"
  | "tool-started"
  | "tool-progress"
  | "tool-finished"
  | "agent-status"
  | "mcp-event"
  | "permission-requested"
  | "permission-resolved"
  | "compaction-started"
  | "compaction-finished"
  | "completed"
  | "failed"
  | "interrupted"
  | "recovery-started"
  | "recovery-finished"

export type AiSessionRecord = {
  id: string
  kind: AiSessionKind
  runtime: AiRuntimeKind
  provider_id: string
  model_id: string
  title: string
  status: AiSessionStatus
  parent_id: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  /** Cherry resource projection fields; legacy sessions default to inactive values. */
  archived?: boolean
  pinned?: boolean
  order_key?: string
  group_id?: string | null
  last_activity_at?: string
}

export type AiMessageRecord = {
  id: string
  session_id: string
  sequence: number
  role: AiMessageRole
  content: unknown
  attachments: unknown[]
  status: AiMessageStatus
  created_at: string
}

export type AiAttachmentRecord = {
  id: string
  session_id: string
  message_id: string | null
  source_type: 'image' | 'file' | 'pdf' | 'canvas' | 'asset'
  file_path: string
  original_name: string
  mime_type: string
  size: number
  sha256: string
  status: 'available' | 'missing' | 'deleted'
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type AiEventRecord = {
  id: string
  session_id: string
  sequence: number
  event_type: AiEventType | string
  payload: Record<string, unknown>
  created_at: string
}

export type AiPermissionRecord = {
  id: string
  session_id: string
  request_id: string
  permission: "read" | "write" | "execute" | "network"
  detail: unknown
  decision: "pending" | "allowOnce" | "allowForSession" | "deny" | "cancel"
  created_at: string
  resolved_at: string | null
}

export type AiAssistantRecord = {
  id: string
  name: string
  description: string
  system_prompt: string
  provider_id: string
  model_id: string
  avatar: string
  settings: Record<string, unknown>
  sort_order: number
  created_at: string
  updated_at: string
  /** Cherry resource projection fields; legacy assistants default to inactive values. */
  archived?: boolean
  pinned?: boolean
  order_key?: string
  group_id?: string | null
  last_activity_at?: string
}

export type AiTopicRecord = {
  id: string
  session_id: string
  parent_id: string | null
  title: string
  pinned: boolean
  archived: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  /** Cherry resource projection fields; legacy topics default to inactive values. */
  owner_id?: string | null
  order_key?: string
  last_activity_at?: string
}

export type AiResourceRecord = AiSessionRecord | AiAssistantRecord | AiTopicRecord

/**
 * Cherry `ResourceListOrderAnchor`: reorder input is always relative ('before'/'after'
 * a row, or append 'last'), never an array index, matching the source drag payload
 * contract (`buildResourceListItemDropAnchor`).
 */
export type AiResourceOrderAnchor = { before: string } | { after: string } | { position: 'last' }

