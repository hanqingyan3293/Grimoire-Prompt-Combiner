import { describe, expect, it, vi } from 'vitest'
import type { AgentBlueprint } from '../../shared/agent-blueprint-types'
import type { AgentSessionReadModel } from '../../shared/agent-session-read-model'
import { AgentSessionPrewarmService, type AgentPrewarmDependencies } from './agent-session-prewarm.service'

const owner = { isDestroyed: () => false }
const session = { id: 's1', agentId: 'a1', workspaceId: 'w1', workspace: { type: 'system', path: 'private-path' } } as AgentSessionReadModel
const blueprint: AgentBlueprint = { id: 'a1', type: 'pi', name: 'Mapped agent', runtime: 'pi', model: 'p1::vendor/model::variant', orderKey: 'm', createdAt: '', updatedAt: '' }
function fixture(overrides: Partial<AgentPrewarmDependencies> = {}) {
  const dependencies: AgentPrewarmDependencies = {
    getSession: vi.fn(() => session), getBlueprint: vi.fn(() => blueprint),
    getProvider: vi.fn(() => ({ id: 'p1', baseUrl: 'https://example.invalid' })),
    validateWorkspace: vi.fn(), ...overrides
  }
  return { dependencies, service: new AgentSessionPrewarmService(dependencies) }
}

describe('Agent prewarm unavailable boundary', () => {
  it.each(['pi', 'opencode'] as const)('never launches or claims prepared success for %s', async runtime => {
    const { service, dependencies } = fixture({ getBlueprint: () => ({ ...blueprint, runtime }) })
    await expect(service.prewarm('s1', owner)).rejects.toMatchObject({ code: 'RUNTIME_PREPARATION_UNAVAILABLE', diagnostic: {
      sessionId: 's1', agentId: 'a1', providerId: 'p1', model: 'vendor/model::variant', workspaceId: 'w1', runtime
    } })
    expect(dependencies.getProvider).toHaveBeenCalledWith('p1')
    expect(dependencies.validateWorkspace).toHaveBeenCalledWith(session)
  })
  it.each([
    ['SESSION_NOT_FOUND', { getSession: () => null }],
    ['SESSION_MAPPING_UNAVAILABLE', { getSession: () => ({ ...session, agentId: null }) }],
    ['BLUEPRINT_NOT_FOUND', { getBlueprint: () => null }],
    ['BLUEPRINT_MODEL_UNAVAILABLE', { getBlueprint: () => ({ ...blueprint, model: null }) }],
    ['BLUEPRINT_MODEL_UNAVAILABLE', { getBlueprint: () => ({ ...blueprint, model: 'p1::' }) }],
    ['PROVIDER_NOT_FOUND', { getProvider: () => null }],
    ['PROVIDER_ENDPOINT_UNAVAILABLE', { getProvider: () => ({ id: 'p1', baseUrl: '' }) }],
    ['WORKSPACE_UNAVAILABLE', { validateWorkspace: () => { throw new Error('private-secret-path') } }]
  ] as [string, Partial<AgentPrewarmDependencies>][])('reports exact prerequisite %s', async (code, overrides) => {
    const { service } = fixture(overrides)
    await expect(service.prewarm('s1', owner)).rejects.toMatchObject({ code })
    try { await service.prewarm('s1', owner) } catch (error) { expect(JSON.stringify(error)).not.toContain('private-secret-path') }
  })
  it('rejects destroyed owners before reading session state', async () => {
    const { service, dependencies } = fixture()
    await expect(service.prewarm('s1', { isDestroyed: () => true })).rejects.toMatchObject({ code: 'OWNER_UNAVAILABLE' })
    expect(dependencies.getSession).not.toHaveBeenCalled()
  })
  it('close_warm is idempotent for an absent lease and cannot launch anything', async () => {
    const { service, dependencies } = fixture()
    await expect(service.release('s1', owner)).resolves.toBeUndefined()
    await expect(service.release('s1', owner)).resolves.toBeUndefined()
    expect(dependencies.getSession).not.toHaveBeenCalled()
  })
})
