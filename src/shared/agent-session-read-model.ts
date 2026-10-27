import type { AgentWorkspace } from './agent-workspace-types'

/** Cherry shared/data/api/schemas/agentSessions.ts + agentWorkspaces.ts.
 * Source-shaped persistence DTO only; runtime data/events/configuration are NOT
 * part of this projection. Transport and pin/background/fork parity are separate.
 */
export type AgentSessionWorkspaceSource = { type: 'user'; workspaceId: string } | { type: 'system' }
export interface CreateAgentSessionReadModel {
  agentId: string
  name: string
  description?: string
  workspace: AgentSessionWorkspaceSource
}
export interface AgentSessionReadModel {
  id: string
  agentId: string | null
  name: string
  isNameManuallyEdited: boolean
  description?: string
  workspaceId: string
  workspace: AgentWorkspace
  traceId?: string
  orderKey: string
  lastActivityAt: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}
export interface UpdateAgentSessionReadModel {
  name?: string
  isNameManuallyEdited?: boolean
  description?: string
  agentId?: string
}
export interface ListAgentSessionReadModels {
  ids?: string[]
  agentId?: string
  workspaceId?: string
  cursor?: string
  limit?: number
  inTrash?: boolean
}
export interface AgentSessionReadModelPage {
  items: AgentSessionReadModel[]
  nextCursor?: string
}
export interface ReuseOrCreateAgentSessionReadModel {
  agentId: string
  workspace: AgentSessionWorkspaceSource
  excludeSessionId?: string
}
export interface ReusableAgentSessionReadModelResult {
  session: AgentSessionReadModel
  created: boolean
  deletedDuplicateSessionIds: string[]
}
