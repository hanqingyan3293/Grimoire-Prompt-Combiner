import { agentRuntimeSessionDirectory, resolveAgentRuntimeCommand, startOpenCodeRuntime } from './agent-runtime-manager'
import { runtimeWorkingDirectory } from './agent-runtime-safety.service'
import { resolveRuntimeExecutionReference, runtimeConfigFingerprint, type RuntimeExecutionIdentity, type RuntimeReferenceStore } from './agent-runtime-reference.service'
import { getAgentWorkspaceInternal, validateUserAgentWorkspaceInternal, listAgentWorkspacesInternal, agentWorkspacePathKey } from './agent-workspace.service'
import { readRuntimeFeatureFlags } from '../ai/runtime/features'
import { listModelCatalog } from '../ai/provider-catalog'
import { buildPiProviderInjection } from '../../integrations/pi/modelInjection'
import type { PiSdkHostTool, PiSdkRuntimeConfig } from '../ai/runtime/pi-sdk.runtime'
import type { PiSdkSessionReference } from '../../integrations/pi/sdk-session'
import type { RuntimeMessage, RuntimeSession } from '../ai/runtime/types'

export type NativeRuntimeProvider = { id: string; name?: string; base_url: string; api_key?: string; protocol?: string; access_mode?: string; context_size?: number | null }
export type PreparedNativeRuntime = {
  config: Record<string, unknown>
  identity: RuntimeExecutionIdentity
  restoreSession?: RuntimeSession
  ownsToolDefinitions?: boolean
  release(): Promise<void>
}

function workspace(owner: string, metadata: Record<string, unknown>): string {
  const namespace = metadata.agentSession && typeof metadata.agentSession === 'object' ? metadata.agentSession as Record<string, unknown> : undefined
  const reference = namespace?.workspace && typeof namespace.workspace === 'object' ? namespace.workspace as Record<string, unknown> : undefined
  if (typeof reference?.workspaceId === 'string') {
    const entry = reference.type === 'user' ? validateUserAgentWorkspaceInternal(reference.workspaceId) : getAgentWorkspaceInternal(reference.workspaceId)
    // A source system allocation must already be prepared; this boundary never provisions it.
    return runtimeWorkingDirectory(owner, entry.path)
  }
  if (metadata.directory !== undefined) {
    if (typeof metadata.directory !== 'string') throw new Error('RUNTIME_WORKSPACE_INVALID')
    const directory = runtimeWorkingDirectory(owner, metadata.directory)
    const registered = listAgentWorkspacesInternal().find(entry => agentWorkspacePathKey(entry.path) === agentWorkspacePathKey(directory))
    if (!registered || registered.type !== 'user') throw new Error('RUNTIME_WORKSPACE_UNAUTHORIZED')
    return runtimeWorkingDirectory(owner, validateUserAgentWorkspaceInternal(registered.id).path)
  }
  return runtimeWorkingDirectory(owner)
}

/** Resolves main-owned commands/provider config and validates execution provenance. */
export async function prepareNativeRuntime(input: {
  store: RuntimeReferenceStore
  sessionId: string
  kind: 'pi' | 'opencode'
  provider: NativeRuntimeProvider | null
  model: string
  metadata: Record<string, unknown>
  history?: RuntimeMessage[]
  systemPrompt?: string
  hostTools?: PiSdkHostTool[]
  signal?: AbortSignal
}): Promise<PreparedNativeRuntime> {
  const owner = input.store + ':' + input.sessionId
  const provider = input.provider
  input.signal?.throwIfAborted()
  if (!provider?.base_url) throw new Error('RUNTIME_PROVIDER_REQUIRED')
  if (provider.access_mode === 'login') throw new Error('RUNTIME_OAUTH_ROUTE_UNSUPPORTED')
  if (input.metadata.command !== undefined || input.metadata.args !== undefined || input.metadata.endpoint !== undefined) throw new Error('RUNTIME_UNMANAGED_OVERRIDE_BLOCKED')
  const directory = workspace(owner, input.metadata)
  const flags = readRuntimeFeatureFlags()
  const sdkSelected = input.kind === 'pi' && flags.piSdk
  const wireModel = input.model.startsWith(provider.id + '::') ? input.model.slice(provider.id.length + 2) : input.model
  const fingerprint = runtimeConfigFingerprint({ providerId: provider.id, baseUrl: provider.base_url, model: wireModel, protocol: provider.protocol || 'chat_completions', credential: provider.api_key || '', directory,
    ...(sdkSelected ? { systemPrompt: input.systemPrompt || '', tools: (input.hostTools || []).map(({ name, description, parameters }) => ({ name, description, parameters })) } : {}) })
  const baseIdentity = { runtime: input.kind, owner, directory, configFingerprint: fingerprint } as const
  if (input.kind === 'opencode') {
    const managed = await startOpenCodeRuntime({ owner, baseUrl: provider.base_url, apiKey: provider.api_key, model: wireModel, directory, signal: input.signal })
    try {
      const identity: RuntimeExecutionIdentity = { ...baseIdentity, driver: 'opencode-legacy', binaryVersion: managed.binaryVersion }
      const remoteSessionId = resolveRuntimeExecutionReference(input.store, input.sessionId, identity)
      return { config: { endpoint: managed.endpoint, directory, model: managed.defaultModel, remoteSessionId, nativeToolPolicy: 'ask', enableNativeSessionOperations: flags.nativeSessionOperations, hostPermissionBroker: true, managed: true }, identity, release: managed.release }
    } catch (error) { await managed.release(); throw error }
  }
  if (sdkSelected) {
    const identity: RuntimeExecutionIdentity = { ...baseIdentity, driver: 'pi-sdk', binaryVersion: '1.0.1' }
    const nativeId = resolveRuntimeExecutionReference(input.store, input.sessionId, identity)
    const reference: PiSdkSessionReference | undefined = nativeId ? JSON.parse(nativeId) as PiSdkSessionReference : undefined
    const facts = listModelCatalog({ query: wireModel, limit: 5000 }).find(entry => entry.id === wireModel)
    const injection = buildPiProviderInjection({ id: provider.id, name: provider.name || provider.id, baseUrl: provider.base_url,
      api: provider.protocol === 'responses' ? 'openai-responses' : 'openai-completions', route: 'direct-api-key', authOptional: !provider.api_key }, {
      id: provider.id + '::' + wireModel, providerId: provider.id, apiModelId: wireModel, name: facts?.name || wireModel,
      capabilities: facts?.capabilities || [], inputModalities: facts?.inputModalities,
      contextWindow: facts?.contextWindow || provider.context_size || undefined, maxOutputTokens: facts?.maxOutputTokens,
    }, provider.api_key || '')
    const sdk: PiSdkRuntimeConfig = { enabled: true, ownerId: owner, cwd: directory, model: input.model, injection,
      systemPrompt: input.systemPrompt || '', customTools: input.hostTools || [], toolAllowlist: (input.hostTools || []).map(tool => tool.name),
      executionStateDir: agentRuntimeSessionDirectory('pi'), enableFork: flags.nativeSessionOperations, enableCompaction: flags.nativeSessionOperations,
      ...(reference ? { sessionReferences: { [reference.localSessionId]: reference } } : {}),
    }
    const restoreSession: RuntimeSession | undefined = reference ? { id: reference.localSessionId, runtime: 'pi', model: input.model, messages: input.history || [], createdAt: new Date().toISOString() } : undefined
    return { config: { driver: 'pi-sdk', sdk }, identity, restoreSession, ownsToolDefinitions: true, release: async () => {} }
  }
  const resolved = resolveAgentRuntimeCommand('pi')
  if (resolved.status.version !== '1.0.1') throw new Error('PI_RUNTIME_PROTOCOL_VERSION_UNSUPPORTED')
  const identity: RuntimeExecutionIdentity = { ...baseIdentity, driver: 'pi-rpc', binaryVersion: resolved.status.version }
  const nativeId = resolveRuntimeExecutionReference(input.store, input.sessionId, identity)
  return { config: { command: resolved.command, args: resolved.args, provider: provider.id, model: wireModel, directory,
    apiKey: provider.api_key || '', baseUrl: provider.base_url, api: provider.protocol === 'responses' ? 'openai-responses' : 'openai-completions',
    sessionId: nativeId || input.sessionId, sessionDir: agentRuntimeSessionDirectory('pi') }, identity, release: async () => {} }
}
