import { describe, expect, it, vi } from 'vitest'
import { nativeRuntimeCapabilities } from './capabilities'
import { getAgentRuntimeCapabilities, registerAgentRuntime, registerBuiltInAgentRuntimes } from './registry'
import { readRuntimeFeatureFlags } from './features'

describe('runtime capability boundaries', () => {
  it('does not construct a runtime or start work when reading the ledger', () => {
    const factory = vi.fn(() => { throw new Error('must not run') })
    registerAgentRuntime('codex', factory)
    expect(getAgentRuntimeCapabilities('codex').recovery.state).toBe('unavailable')
    expect(factory).not.toHaveBeenCalled()
  })

  it('reports missing configuration instead of promising resume or a process lease', () => {
    registerBuiltInAgentRuntimes()
    for (const kind of ['pi', 'opencode'] as const) {
      const ledger = getAgentRuntimeCapabilities(kind)
      expect(ledger['session.resume'].state).toBe('blocked')
      expect(ledger['process.lease'].state).toBe('unavailable')
      expect(ledger.recovery.state).toBe('not-implemented')
    }
  })

  it('returns isolated ledger objects so caller mutation cannot enable blocked features', () => {
    const first = nativeRuntimeCapabilities('pi')
    first['native.tools'].state = 'supported'
    expect(nativeRuntimeCapabilities('pi')['native.tools'].state).toBe('unavailable')
  })

  it('keeps advanced features disabled unless the main process explicitly opts in', () => {
    expect(readRuntimeFeatureFlags({})).toEqual({ piSdk: false, openCodeReplay: false, nativeSessionOperations: false })
    expect(readRuntimeFeatureFlags({ GRIMOIRE_PI_SDK_RUNTIME: 'true' }).piSdk).toBe(false)
    expect(readRuntimeFeatureFlags({ GRIMOIRE_PI_SDK_RUNTIME: '1' }).piSdk).toBe(true)
  })

  it('separates the pure adapter approval from the main broker session grant', () => {
    const pure = nativeRuntimeCapabilities('opencode', { nativeToolPolicy: 'ask' })
    expect(pure['permission.once'].state).toBe('supported')
    expect(pure['permission.deny'].state).toBe('supported')
    expect(pure['permission.session'].state).toBe('unavailable')
    const brokered = nativeRuntimeCapabilities('opencode', { nativeToolPolicy: 'ask', hostPermissionBroker: true })
    expect(brokered['permission.session'].state).toBe('supported')
    expect(brokered['permission.session'].reason).toContain('exact owner/session/action/pattern grants')
    expect(brokered['permission.session'].reason).toContain('native process-wide always is never emitted')
  })

  it('reports implemented OpenCode fork/compaction only with native session operations', () => {
    const enabled = nativeRuntimeCapabilities('opencode', { nativeSessionOperations: true })
    expect(enabled['session.fork'].state).toBe('supported')
    expect(enabled.compaction.state).toBe('supported')
    const disabled = nativeRuntimeCapabilities('opencode')
    expect(disabled['session.fork'].state).toBe('unavailable')
    expect(disabled.compaction.state).toBe('unavailable')
    const pi = nativeRuntimeCapabilities('pi', { nativeSessionOperations: true })
    expect(pi['session.fork'].state).toBe('unavailable')
    expect(pi.compaction.state).toBe('unavailable')
  })

  it('reports a process lease only when the runtime instance carries the managed lease', () => {
    expect(nativeRuntimeCapabilities('opencode', { managed: true })['process.lease'].state).toBe('supported')
    expect(nativeRuntimeCapabilities('opencode')['process.lease'].state).toBe('unavailable')
    expect(nativeRuntimeCapabilities('pi', { managed: true })['process.lease'].state).toBe('unavailable')
  })

  it('names the main-selected Pi SDK driver but refuses to invent static resume approval', () => {
    const previous = process.env.GRIMOIRE_PI_SDK_RUNTIME
    process.env.GRIMOIRE_PI_SDK_RUNTIME = '1'
    try {
      const ledger = getAgentRuntimeCapabilities('pi')
      expect(ledger.provenance).toEqual({ source: 'main-config', driver: 'pi-sdk', instance: false })
      expect(ledger['session.resume'].state).toBe('blocked')
      expect(ledger['session.resume'].reason).toContain('no validated session reference')
      expect(ledger['permission.once'].state).toBe('unavailable')
      expect(ledger['permission.session'].state).toBe('unavailable')
      expect(ledger['native.tools'].state).toBe('unavailable')
      expect(ledger['process.lease'].state).toBe('unavailable')
    } finally {
      if (previous === undefined) delete process.env.GRIMOIRE_PI_SDK_RUNTIME
      else process.env.GRIMOIRE_PI_SDK_RUNTIME = previous
    }
  })

  it('reuses the actual instance ledger and labels its driver instead of static flags', () => {
    const capabilities = nativeRuntimeCapabilities('opencode', { managed: true, hostPermissionBroker: true, nativeSessionOperations: true })
    const instance = {
      kind: 'opencode' as const,
      getCapabilities: () => capabilities,
      getCapabilityDriver: () => 'opencode-managed' as const,
    }
    const ledger = getAgentRuntimeCapabilities('opencode', { managed: false }, instance as never)
    expect(ledger.provenance).toEqual({ source: 'runtime-instance', driver: 'opencode-managed', instance: true })
    expect(ledger['process.lease'].state).toBe('supported')
    expect(ledger['permission.session'].state).toBe('supported')
  })

  it('labels static OpenCode metadata as unprepared and keeps instance capabilities unavailable', () => {
    const ledger = getAgentRuntimeCapabilities('opencode')
    expect(ledger.provenance).toEqual({ source: 'main-config', driver: 'opencode-unprepared', instance: false })
    expect(ledger['process.lease'].state).toBe('unavailable')
    expect(ledger['permission.session'].state).toBe('unavailable')
  })
})
