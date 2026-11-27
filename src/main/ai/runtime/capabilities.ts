import { runtimeCapabilityKeys, type RuntimeCapabilities, type RuntimeCapability, type RuntimeCapabilityStatus } from './types'

export type RuntimeDriver =
  | 'provider-adapter'
  | 'pi-rpc'
  | 'pi-sdk'
  | 'opencode-unprepared'
  | 'opencode-managed'
  | 'codex-unprepared'

export type RuntimeCapabilitySource = 'main-config' | 'runtime-instance'

export type RuntimeCapabilityProvenance = {
  source: RuntimeCapabilitySource
  driver: RuntimeDriver
  instance: boolean
}

export type RuntimeCapabilityReport = RuntimeCapabilities & { provenance: RuntimeCapabilityProvenance }

export function unavailableRuntimeCapabilities(reason: string): RuntimeCapabilities {
  return Object.fromEntries(runtimeCapabilityKeys.map(key => [key, { state: 'unavailable', reason }])) as RuntimeCapabilities
}

/** Read capability metadata without constructing a runtime or selecting credentials. */
export type NativeRuntimeCapabilityContext = {
  persistent?: boolean
  managed?: boolean
  nativeToolPolicy?: 'disabled' | 'ask'
  nativeSessionOperations?: boolean
  hostPermissionBroker?: boolean
}

/** Attach main-owned provenance without changing the capability-key shape. */
export function withRuntimeCapabilityProvenance(capabilities: RuntimeCapabilities, provenance: RuntimeCapabilityProvenance): RuntimeCapabilityReport {
  return { ...capabilities, provenance: Object.freeze({ ...provenance }) }
}

/**
 * Static Pi SDK metadata. It names the selected driver and the boundaries that
 * are fixed by main-process configuration, but it must not invent a resume
 * reference or host-tool approval state that only a prepared instance owns.
 */
export function piSdkStaticCapabilities(options: { nativeSessionOperations?: boolean } = {}): RuntimeCapabilities {
  const result = unavailableRuntimeCapabilities('Pi SDK static metadata does not include this capability.') as Record<RuntimeCapability, RuntimeCapabilityStatus>
  result.streaming = { state: 'supported', reason: 'Pi 1.0.1 AgentSession.subscribe; completion requires agent_settled and idle.' }
  result['session.resume'] = {
    state: 'blocked',
    reason: 'Static main-process metadata has no validated session reference; only a prepared instance may report resume.',
    unblock: 'Prepare a Pi SDK instance with a validated owner/config/header/checkpoint reference and host history.',
  }
  result['session.fork'] = options.nativeSessionOperations
    ? { state: 'supported', reason: 'Opt-in full-history SessionManager.forkFrom is enabled by native session operations.' }
    : { state: 'unavailable', reason: 'Pi SDK full-history fork is not enabled by the main-process feature flag.' }
  for (const name of ['permission.once', 'permission.deny', 'permission.session'] as const) {
    result[name] = { state: 'unavailable', reason: 'Static metadata cannot know whether this session has host custom tools; the actual instance reports the exact tool/input boundary.' }
  }
  result['native.tools'] = { state: 'unavailable', reason: 'All Pi SDK native tools are suppressed; only constructor-allowlisted host custom tools can exist.' }
  result['event.replay'] = { state: 'unavailable', reason: 'AgentSession.subscribe has no public durable event cursor.' }
  result.compaction = options.nativeSessionOperations
    ? { state: 'supported', reason: 'Opt-in compactSession calls public AgentSession.compact; no automatic compaction is implied.' }
    : { state: 'unavailable', reason: 'Pi SDK compaction is not enabled by the main-process feature flag.' }
  result.recovery = { state: 'not-implemented', reason: 'No source-backed recovery event is emitted.' }
  result['process.lease'] = { state: 'unavailable', reason: 'In-process ESM SDK has no subprocess or shared-process lease.' }
  return result
}

export function nativeRuntimeCapabilities(kind: 'pi' | 'opencode', options: NativeRuntimeCapabilityContext = {}): RuntimeCapabilities {
  const result = unavailableRuntimeCapabilities('This adapter does not expose this capability.') as Record<RuntimeCapability, RuntimeCapabilityStatus>
  result.streaming = { state: 'supported', reason: kind === 'pi' ? 'Pi 1.0.1 JSONL prompt/delta/settled is consumed.' : 'OpenCode 1.18.34 legacy events are consumed while the prompt runs.' }
  result['session.resume'] = options.persistent
    ? { state: 'supported', reason: 'A validated main-owned native session reference is attached.' }
    : { state: 'blocked', reason: 'No validated persistent session reference is attached.', unblock: 'Validate owner, config, storage and native identity before resume.' }
  result['session.fork'] = kind === 'opencode' && options.nativeSessionOperations
    ? { state: 'supported', reason: 'The legacy /session/:id/fork operation is implemented and returns an independent native session.' }
    : { state: 'unavailable', reason: kind === 'pi' ? 'Pi RPC has no verified native fork operation.' : 'This adapter context does not enable native session operations.' }
  result['event.replay'] = kind === 'pi' ? { state: 'unavailable', reason: 'JSONL RPC has no durable event cursor.' } : { state: 'blocked', reason: 'Legacy events are live-only; v2 durable events do not replay the legacy execution loop.' }
  result['permission.once'] = kind === 'pi'
    ? { state: 'blocked', reason: 'Pi RPC native tools and extensions stay disabled without a policy bridge.' }
    : options.nativeToolPolicy === 'ask'
      ? { state: 'supported', reason: 'The pure adapter answers native approval with once; main can wrap it with the host broker.' }
      : { state: 'unavailable', reason: 'Native approval is disabled because the runtime tool policy is not ask.' }
  result['permission.deny'] = kind === 'pi'
    ? { state: 'blocked', reason: 'Pi RPC native approval is not connected.' }
    : options.nativeToolPolicy === 'ask'
      ? { state: 'supported', reason: 'The pure adapter answers native rejection with reject, without executing the tool.' }
      : { state: 'unavailable', reason: 'Native rejection is disabled because the runtime tool policy is not ask.' }
  result['permission.session'] = kind === 'pi'
    ? { state: 'unavailable', reason: 'Pi RPC has no connected host permission broker or session grant.' }
    : options.hostPermissionBroker
      ? { state: 'supported', reason: 'The main broker persists exact owner/session/action/pattern grants; native process-wide always is never emitted.' }
      : { state: 'unavailable', reason: 'No main-process permission broker is attached.' }
  result['native.tools'] = kind === 'opencode' && options.nativeToolPolicy === 'ask'
    ? { state: 'supported', reason: 'Native tools are explicitly enabled by the runtime policy; approval remains brokered.' }
    : { state: 'unavailable', reason: kind === 'pi' ? 'Pi RPC native tools are disabled by default.' : 'Native tools are disabled because the runtime tool policy is not ask.' }
  result.compaction = kind === 'opencode' && options.nativeSessionOperations
    ? { state: 'supported', reason: 'The legacy /session/:id/summarize operation is implemented and awaits the native result.' }
    : { state: 'unavailable', reason: kind === 'pi' ? 'Pi RPC has no verified native compaction operation.' : 'This adapter context does not enable native session operations.' }
  result.recovery = { state: 'not-implemented', reason: 'No source-backed recovery event is emitted.' }
  result['process.lease'] = kind === 'opencode' && options.managed
    ? { state: 'supported', reason: 'A main-owned process lease is attached.' }
    : { state: 'unavailable', reason: 'This adapter instance has no managed process lease.' }
  return result
}
