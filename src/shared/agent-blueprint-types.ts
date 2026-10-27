import type { AgentRuntimeKind } from './agent-types'

/** Source AgentType is not a runtime selector. null means no source type applies (e.g. OpenCode). */
export type AgentBlueprintSourceType = 'claude-code' | 'pi' | 'dsh'
export type AgentBlueprintModelId = `${string}::${string}`
export type AgentBlueprintConfiguration = {
  avatar?: string
  slash_commands?: string[]
  permission_mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'auto'
  reasoning_effort?: 'default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | 'auto'
  service_tier?: 'standard' | 'auto' | 'fast' | 'flex'
  bootstrap_completed?: boolean
  scheduler_enabled?: boolean
  scheduler_type?: 'cron' | 'interval' | 'one-time'
  scheduler_cron?: string
  scheduler_interval?: number
  scheduler_one_time_delay?: number
  scheduler_last_run?: string
  heartbeat_enabled?: boolean
  heartbeat_interval?: number
  language?: string | null
  /** Main-owned identity and secret writes are deliberately unavailable in this slice. */
  builtin_role?: never
  env_vars?: never
  [key: string]: unknown
}
export type AgentBlueprintFields = {
  name: string
  description?: string
  instructions?: string
  model: AgentBlueprintModelId | null
  planModel?: AgentBlueprintModelId
  smallModel?: AgentBlueprintModelId
  configuration?: AgentBlueprintConfiguration
  disabledTools?: string[]
  mcps?: string[]
  knowledgeBaseIds?: string[]
}
export type CreateAgentBlueprint = Omit<AgentBlueprintFields, 'model'> & {
  model: AgentBlueprintModelId
  type: AgentBlueprintSourceType | null
  runtime: AgentRuntimeKind
}
export type UpdateAgentBlueprint = Partial<Omit<AgentBlueprintFields, 'planModel' | 'smallModel'>> & {
  planModel?: AgentBlueprintModelId | null
  smallModel?: AgentBlueprintModelId | null
  runtime?: AgentRuntimeKind
}
export type AgentBlueprint = AgentBlueprintFields & {
  id: string
  type: AgentBlueprintSourceType | null
  runtime: AgentRuntimeKind
  orderKey: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}
export type ListAgentBlueprints = { ids?: string[]; inTrash?: boolean; search?: string; page?: number; limit?: number }
export type AgentBlueprintPage = { agents: AgentBlueprint[]; total: number; page: number; limit: number }
