import type { AgentRuntime, AgentRuntimeKind, RuntimeCapabilities, RuntimeFactory } from "./types"
import type { NativeRuntimeCapabilityContext, RuntimeCapabilityReport, RuntimeDriver } from './capabilities'
import { nativeRuntimeCapabilities, piSdkStaticCapabilities, unavailableRuntimeCapabilities, withRuntimeCapabilityProvenance } from './capabilities'
export { inspectPiSdkSurface } from '../../../integrations/pi/piSdk'
import { OpenAICompatibleRuntime } from './openai-compatible.runtime'
import { CodexRuntime, OpenCodeRuntime, PiRuntime } from './adapters'
import { AnthropicRuntime, GoogleRuntime } from './provider-adapters'
import { PiSdkRuntime, type PiSdkRuntimeConfig } from './pi-sdk.runtime'
import { readRuntimeFeatureFlags, RuntimeCapabilityUnavailableError } from './features'

const factories = new Map<AgentRuntimeKind, RuntimeFactory>()

export function registerAgentRuntime(kind: AgentRuntimeKind, factory: RuntimeFactory) {
  factories.set(kind, factory)
}

export function hasAgentRuntime(kind: AgentRuntimeKind) {
  return factories.has(kind)
}

export function createAgentRuntime(kind: AgentRuntimeKind, config: Record<string, unknown> = {}): AgentRuntime {
  const factory = factories.get(kind)
  if (!factory) throw new Error("Agent Runtime 未注册：" + kind)
  return factory(config)
}

export function listAgentRuntimes() {
  return Array.from(factories.keys())
}

function staticDriver(kind: AgentRuntimeKind, piSdk: boolean): RuntimeDriver {
  if (kind === 'openai-compatible' || kind === 'anthropic' || kind === 'google') return 'provider-adapter'
  if (kind === 'pi') return piSdk ? 'pi-sdk' : 'pi-rpc'
  if (kind === 'opencode') return 'opencode-unprepared'
  return 'codex-unprepared'
}

/**
 * Static metadata is labelled as main-config; an actual AgentRuntime instance
 * is authoritative and its own getCapabilities() is returned unchanged.
 */
export function getAgentRuntimeCapabilities(kind: AgentRuntimeKind, context: NativeRuntimeCapabilityContext = {}, instance?: AgentRuntime): RuntimeCapabilityReport {
  if (!factories.has(kind)) {
    return withRuntimeCapabilityProvenance(unavailableRuntimeCapabilities('Runtime 未注册'), { source: 'main-config', driver: staticDriver(kind, readRuntimeFeatureFlags().piSdk), instance: false })
  }
  if (instance?.getCapabilities) {
    return withRuntimeCapabilityProvenance(instance.getCapabilities(), {
      source: 'runtime-instance',
      driver: (instance.getCapabilityDriver?.() as RuntimeDriver | undefined) || staticDriver(kind, readRuntimeFeatureFlags().piSdk),
      instance: true,
    })
  }
  const flags = readRuntimeFeatureFlags()
  if (kind === 'pi') {
    const capabilities = flags.piSdk ? piSdkStaticCapabilities({ nativeSessionOperations: flags.nativeSessionOperations }) : nativeRuntimeCapabilities('pi', context)
    return withRuntimeCapabilityProvenance(capabilities, { source: 'main-config', driver: flags.piSdk ? 'pi-sdk' : 'pi-rpc', instance: false })
  }
  if (kind === 'opencode') {
    return withRuntimeCapabilityProvenance(nativeRuntimeCapabilities('opencode', context), { source: 'main-config', driver: 'opencode-unprepared', instance: false })
  }
  return withRuntimeCapabilityProvenance(unavailableRuntimeCapabilities('This runtime has no verified capability ledger.'), { source: 'main-config', driver: staticDriver(kind, flags.piSdk), instance: false })
}

export function registerBuiltInAgentRuntimes() {
  registerAgentRuntime('openai-compatible', config => new OpenAICompatibleRuntime({ baseUrl: String(config?.baseUrl || ''), apiKey: String(config?.apiKey || ''), protocol: config?.protocol === 'responses' ? 'responses' : 'chat_completions' }))
  registerAgentRuntime('anthropic', config => new AnthropicRuntime({ baseUrl: String(config?.baseUrl || ''), apiKey: String(config?.apiKey || '') }))
  registerAgentRuntime('google', config => new GoogleRuntime({ baseUrl: String(config?.baseUrl || ''), apiKey: String(config?.apiKey || '') }))
  registerAgentRuntime('codex', config => new CodexRuntime({ endpoint: String(config?.endpoint || 'http://127.0.0.1:17371'), token: String(config?.token || '') }))
  registerAgentRuntime('opencode', config => new OpenCodeRuntime({ endpoint: String(config?.endpoint || 'http://127.0.0.1:4096'), token: String(config?.token || ''), directory: typeof config?.directory === 'string' ? config.directory : undefined, model: typeof config?.model === 'string' ? config.model : undefined, remoteSessionId: typeof config?.remoteSessionId === 'string' ? config.remoteSessionId : undefined, nativeToolPolicy: config?.nativeToolPolicy === 'ask' ? 'ask' : 'disabled', enableNativeSessionOperations: config?.enableNativeSessionOperations === true, hostPermissionBroker: config?.hostPermissionBroker === true, managed: config?.managed === true }))
  registerAgentRuntime('pi', config => {
    if (config?.driver === 'pi-sdk') {
      if (!readRuntimeFeatureFlags().piSdk) throw new RuntimeCapabilityUnavailableError('pi.sdk', 'Pi SDK runtime feature gate is disabled')
      if (!config.sdk || typeof config.sdk !== 'object' || Array.isArray(config.sdk)) throw new Error('PI_SDK_PREPARATION_REQUIRED')
      return new PiSdkRuntime(config.sdk as PiSdkRuntimeConfig)
    }
    return new PiRuntime({
    command: String(config?.command || 'pi'),
    args: Array.isArray(config?.args) ? config.args.map(String) : [],
    directory: typeof config?.directory === 'string' ? config.directory : undefined,
    provider: typeof config?.provider === 'string' ? config.provider : undefined,
    model: typeof config?.model === 'string' ? config.model : undefined,
    apiKey: typeof config?.apiKey === 'string' ? config.apiKey : undefined,
    baseUrl: typeof config?.baseUrl === 'string' ? config.baseUrl : undefined,
    api: typeof config?.api === 'string' ? config.api : undefined,
    headers: config?.headers && typeof config.headers === 'object' && !Array.isArray(config.headers) ? Object.fromEntries(Object.entries(config.headers).filter(([, value]) => typeof value === 'string')) : undefined,
    sessionId: typeof config?.sessionId === 'string' ? config.sessionId : undefined,
    sessionDir: typeof config?.sessionDir === 'string' ? config.sessionDir : undefined,
    allowNativeTools: config?.allowNativeTools === true,
    allowExtensions: config?.allowExtensions === true,
    })
  })
}
