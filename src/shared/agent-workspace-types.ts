// Cherry source shared/data/api/schemas/agentWorkspaces.ts entity/DTO adaptation.
// Storage contracts only: no path grants, runtime lifecycle or renderer transport.
export type AgentWorkspaceType = 'user' | 'system'
export interface AgentWorkspace {
  id: string
  name: string
  path: string
  type: AgentWorkspaceType
  orderKey: string
  createdAt: string
  updatedAt: string
}
export interface CreateAgentWorkspace { path: string; name?: string }
export interface UpdateAgentWorkspace { name: string }
export type AgentWorkspaceOrder = { before: string } | { after: string } | { position: 'first' | 'last' }
export interface FindOrCreateAgentWorkspaceResult { workspace: AgentWorkspace; created: boolean }
