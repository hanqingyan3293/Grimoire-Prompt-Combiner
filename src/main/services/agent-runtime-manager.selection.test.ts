import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() } }))
vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof import('fs')>()
  const existsSync = vi.fn(() => false)
  return { ...actual, existsSync, default: { ...actual, existsSync } }
})
vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>()
  const execFileSync = vi.fn(() => { throw new Error('CLI unavailable') })
  return { ...actual, execFileSync, default: { ...actual, execFileSync } }
})

import { inspectAgentRuntime, runtimeSelectionContract } from './agent-runtime-manager'

describe('runtime status selection contract', () => {
  it('projects provider/catalog and runtime/freeform metadata from the main process', () => {
    expect(runtimeSelectionContract('openai-compatible')).toEqual({ provider: 'grimoire', model: 'catalog' })
    expect(runtimeSelectionContract('anthropic')).toEqual({ provider: 'grimoire', model: 'catalog' })
    expect(runtimeSelectionContract('opencode')).toEqual({ provider: 'runtime', model: 'freeform' })
    expect(runtimeSelectionContract('pi')).toEqual({ provider: 'runtime', model: 'freeform' })
    expect(inspectAgentRuntime('openai-compatible').contract).toEqual({ provider: 'grimoire', model: 'catalog' })
  })

  it('does not depend on the Pi CLI when the main process selects the SDK driver', () => {
    const previous = process.env.GRIMOIRE_PI_SDK_RUNTIME
    try {
      delete process.env.GRIMOIRE_PI_SDK_RUNTIME
      expect(inspectAgentRuntime('pi')).toMatchObject({ available: false, driver: 'pi-rpc' })
      process.env.GRIMOIRE_PI_SDK_RUNTIME = '1'
      expect(inspectAgentRuntime('pi')).toMatchObject({ available: true, driver: 'pi-sdk', executable: null, version: '1.0.1' })
      expect(inspectAgentRuntime('opencode')).toMatchObject({ driver: 'opencode-unprepared' })
    } finally {
      if (previous === undefined) delete process.env.GRIMOIRE_PI_SDK_RUNTIME
      else process.env.GRIMOIRE_PI_SDK_RUNTIME = previous
    }
  })
})
