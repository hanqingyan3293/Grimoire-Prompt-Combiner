import { getDatabase } from '../database'
import { getAgentBlueprint } from './agent-blueprint.service'
import { getAgentSessionReadModel } from './agent-session-read-model.service'
import { validateUserAgentWorkspaceInternal, getAgentWorkspaceInternal } from './agent-workspace.service'
import type { AgentBlueprint } from '../../shared/agent-blueprint-types'
import type { AgentSessionReadModel } from '../../shared/agent-session-read-model'

export type AgentPrewarmUnavailableCode =
  | 'OWNER_UNAVAILABLE' | 'SESSION_NOT_FOUND' | 'SESSION_MAPPING_UNAVAILABLE'
  | 'BLUEPRINT_NOT_FOUND' | 'BLUEPRINT_MODEL_UNAVAILABLE' | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_ENDPOINT_UNAVAILABLE' | 'WORKSPACE_UNAVAILABLE' | 'RUNTIME_PREPARATION_UNAVAILABLE'

export class AgentPrewarmUnavailableError extends Error {
  constructor(readonly code: AgentPrewarmUnavailableCode, message: string, readonly diagnostic: Record<string, unknown> = {}) {
    super(message)
    this.name = 'AgentPrewarmUnavailableError'
  }
}

export type PrewarmOwner = { isDestroyed(): boolean }
export type AgentPrewarmDependencies = {
  getSession(id: string): AgentSessionReadModel | null
  getBlueprint(id: string): AgentBlueprint | null
  getProvider(id: string): { id: string; baseUrl: string } | null
  validateWorkspace(session: AgentSessionReadModel): void
}
const defaults: AgentPrewarmDependencies = {
  getSession: getAgentSessionReadModel,
  getBlueprint: getAgentBlueprint,
  getProvider(id) {
    // Read only routing identity. No key decryption, active-provider fallback or runtime launch.
    const row = getDatabase().exec('SELECT id,base_url FROM providers WHERE id=?', [id])[0]?.values[0]
    return row ? { id: String(row[0]), baseUrl: String(row[1] || '') } : null
  },
  validateWorkspace(session) {
    const workspace = session.workspace.type === 'user'
      ? validateUserAgentWorkspaceInternal(session.workspaceId)
      : getAgentWorkspaceInternal(session.workspaceId)
    if (workspace.id !== session.workspaceId || workspace.type !== session.workspace.type || workspace.path !== session.workspace.path) {
      throw new Error('WORKSPACE_MAPPING_CHANGED')
    }
    // A system allocation is not a prepared directory. Do not mkdir for a blocked launch.
  }
}

/** Cherry ai.ts/acquireWarmLease boundary adapter. The source primes a live connection,
 * shared by (session x sender), not a binary availability probe or a JS session object.
 * Fail closed until the native adapters supply a consumable owner-scoped connection lease:
 * Pi currently launches from inherited machine configuration and lacks main provider/cwd/
 * policy injection; OpenCode's global managed process replaces differently configured
 * processes, has no per-session release authority, and adapter.close does not release it.
 * Neither preparation may be reported successful or launched speculatively here.
 */
export class AgentSessionPrewarmService {
  constructor(private readonly dependencies: AgentPrewarmDependencies = defaults) {}

  async prewarm(sessionId: string, owner: PrewarmOwner): Promise<void> {
    this.requireOwner(owner)
    const session = this.dependencies.getSession(sessionId)
    if (!session || session.deletedAt) throw new AgentPrewarmUnavailableError('SESSION_NOT_FOUND', 'Active mapped Agent session not found', { sessionId })
    if (!session.agentId) throw new AgentPrewarmUnavailableError('SESSION_MAPPING_UNAVAILABLE', 'Session has no mapped Agent blueprint', { sessionId })
    const blueprint = this.dependencies.getBlueprint(session.agentId)
    if (!blueprint) throw new AgentPrewarmUnavailableError('BLUEPRINT_NOT_FOUND', 'Active Agent blueprint not found', { sessionId, agentId: session.agentId })
    const separator = typeof blueprint.model === 'string' ? blueprint.model.indexOf('::') : -1
    if (!blueprint.model || separator <= 0 || separator + 2 >= blueprint.model.length) {
      throw new AgentPrewarmUnavailableError('BLUEPRINT_MODEL_UNAVAILABLE', 'Mapped blueprint model is unavailable', { sessionId, agentId: blueprint.id })
    }
    const providerId = blueprint.model.slice(0, separator), model = blueprint.model.slice(separator + 2)
    const provider = this.dependencies.getProvider(providerId)
    if (!provider) throw new AgentPrewarmUnavailableError('PROVIDER_NOT_FOUND', 'Mapped provider not found', { sessionId, providerId })
    if (!provider.baseUrl.trim()) throw new AgentPrewarmUnavailableError('PROVIDER_ENDPOINT_UNAVAILABLE', 'Mapped provider endpoint is unavailable', { sessionId, providerId })
    try { this.dependencies.validateWorkspace(session) }
    catch { throw new AgentPrewarmUnavailableError('WORKSPACE_UNAVAILABLE', 'Mapped workspace is unavailable', { sessionId, workspaceId: session.workspaceId }) }
    throw new AgentPrewarmUnavailableError('RUNTIME_PREPARATION_UNAVAILABLE', 'Runtime cannot acquire a prepared, consumable main-owned session lease', {
      sessionId, agentId: blueprint.id, providerId, model, workspaceId: session.workspaceId, runtime: blueprint.runtime,
      blockers: blueprint.runtime === 'pi'
        ? ['mapped_provider_model_and_workspace_injection', 'native_tool_permission_policy', 'turnless_preparation_and_session_lease']
        : blueprint.runtime === 'opencode'
          ? ['owner_scoped_managed_process_lease', 'native_tool_permission_policy', 'prepared_connection_turn_handoff_and_release']
          : ['turnless_preparation_and_session_lease']
    })
  }

  async release(_sessionId: string, owner: PrewarmOwner): Promise<void> {
    this.requireOwner(owner)
    // Source-compatible idempotent close of an absent warm lease. No prewarm can acquire
    // a resource yet, therefore there is nothing to retain across window destruction.
  }
  private requireOwner(owner: PrewarmOwner): void {
    if (!owner || owner.isDestroyed()) throw new AgentPrewarmUnavailableError('OWNER_UNAVAILABLE', 'Owner window is unavailable')
  }
}
export const agentSessionPrewarmService = new AgentSessionPrewarmService()
