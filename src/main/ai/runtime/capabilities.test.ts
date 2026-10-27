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
    expect(nativeRuntimeCapabilities('pi')['native.tools'].state).toBe('blocked')
  })

  it('keeps advanced features disabled unless the main process explicitly opts in', () => {
    expect(readRuntimeFeatureFlags({})).toEqual({ piSdk: false, openCodeReplay: false, nativeSessionOperations: false })
    expect(readRuntimeFeatureFlags({ GRIMOIRE_PI_SDK_RUNTIME: 'true' }).piSdk).toBe(false)
    expect(readRuntimeFeatureFlags({ GRIMOIRE_PI_SDK_RUNTIME: '1' }).piSdk).toBe(true)
  })
})
