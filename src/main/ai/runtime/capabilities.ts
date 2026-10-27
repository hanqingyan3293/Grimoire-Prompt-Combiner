import { runtimeCapabilityKeys, type RuntimeCapabilities, type RuntimeCapability, type RuntimeCapabilityStatus } from './types'

export function unavailableRuntimeCapabilities(reason: string): RuntimeCapabilities {
  return Object.fromEntries(runtimeCapabilityKeys.map(key => [key, { state: 'unavailable', reason }])) as RuntimeCapabilities
}

/** Read capability metadata without constructing a runtime or selecting credentials. */
export function nativeRuntimeCapabilities(kind: 'pi' | 'opencode', options: { persistent?: boolean; managed?: boolean } = {}): RuntimeCapabilities {
  const result = unavailableRuntimeCapabilities('This adapter does not expose this capability.') as Record<RuntimeCapability, RuntimeCapabilityStatus>
  result.streaming = { state: 'supported', reason: kind === 'pi' ? 'Pi 1.0.1 JSONL prompt/delta/settled is consumed.' : 'OpenCode 1.18.34 legacy events are consumed while the prompt runs.' }
  result['session.resume'] = options.persistent
    ? { state: 'supported', reason: 'A validated main-owned native session reference is attached.' }
    : { state: 'blocked', reason: 'No validated persistent session reference is attached.', unblock: 'Validate owner, config, storage and native identity before resume.' }
  result['session.fork'] = { state: 'not-implemented', reason: 'Native fork is not exposed yet.', unblock: 'Verify the version-matched fork API and branch isolation.' }
  result['event.replay'] = { state: kind === 'pi' ? 'unavailable' : 'blocked', reason: kind === 'pi' ? 'JSONL RPC has no durable event cursor.' : 'Legacy events are live-only; v2 durable events do not replay the legacy execution loop.' }
  result['permission.once'] = kind === 'pi'
    ? { state: 'blocked', reason: 'Pi RPC native tools and extensions stay disabled without a policy bridge.' }
    : { state: 'supported', reason: 'A native allow-once round trip is covered by real binary smoke.' }
  result['permission.deny'] = kind === 'pi'
    ? { state: 'blocked', reason: 'Pi RPC native approval is not connected.' }
    : { state: 'supported', reason: 'Native rejection returns a tool error and idle, without executing the tool.' }
  result['permission.session'] = { state: 'blocked', reason: 'Owner/session/action-scoped grants are not connected yet.' }
  result['native.tools'] = { state: 'blocked', reason: 'Tool policy and path boundaries require acceptance before general enablement.' }
  result.compaction = { state: 'not-implemented', reason: 'No native compaction operation is exposed yet.' }
  result.recovery = { state: 'not-implemented', reason: 'No source-backed recovery event is emitted.' }
  result['process.lease'] = kind === 'opencode' && options.managed
    ? { state: 'supported', reason: 'A main-owned process lease is attached.' }
    : { state: 'unavailable', reason: 'This adapter instance has no managed process lease.' }
  return result
}
