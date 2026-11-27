import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase } from '../database'
import { prepareNativeRuntime } from './agent-runtime-preparation.service'
import { createAiSession } from './ai-session.service'

vi.mock('electron', () => ({ app: { getPath: () => 'D:/runtime-prep-test' } }))
vi.mock('./agent-runtime-manager', () => ({
  agentRuntimeSessionDirectory: (kind: string) => `D:/runtime-prep-test/${kind}`,
  resolveAgentRuntimeCommand: () => ({ command: 'pi.exe', args: [], status: { version: '1.0.1' } }),
  startOpenCodeRuntime: vi.fn(async () => ({ endpoint: 'http://127.0.0.1:1', directory: 'D:/runtime-prep-test/workspace', defaultModel: 'grimoire/model', binaryVersion: '1.18.34', release: vi.fn(async () => {}) })),
}))
vi.mock('../ai/provider-catalog', () => ({ listModelCatalog: () => [] }))

beforeEach(async () => { fs.mkdirSync('D:/runtime-prep-test', { recursive: true }); await initDatabase() })
afterEach(() => { closeDatabase(); fs.rmSync('D:/runtime-prep-test', { recursive: true, force: true }) })

describe('native runtime preparation', () => {
  it('rejects renderer-owned command/endpoint overrides and unregistered workspace paths', async () => {
    await expect(prepareNativeRuntime({ store: 'ai', sessionId: 's', kind: 'pi', provider: { id: 'p', base_url: 'https://p.invalid', api_key: 'k' }, model: 'm', metadata: { command: 'evil' } })).rejects.toThrow('UNMANAGED_OVERRIDE')
    await expect(prepareNativeRuntime({ store: 'ai', sessionId: 's', kind: 'pi', provider: { id: 'p', base_url: 'https://p.invalid', api_key: 'k' }, model: 'm', metadata: { directory: path.resolve(os.tmpdir()) } })).rejects.toThrow('WORKSPACE')
  })

  it('refuses missing providers and unsupported OAuth routes before launch', async () => {
    await expect(prepareNativeRuntime({ store: 'ai', sessionId: 's', kind: 'pi', provider: null, model: 'm', metadata: {} })).rejects.toThrow('PROVIDER_REQUIRED')
    await expect(prepareNativeRuntime({ store: 'ai', sessionId: 's', kind: 'pi', provider: { id: 'p', base_url: 'https://p.invalid', access_mode: 'login' }, model: 'm', metadata: {} })).rejects.toThrow('OAUTH_ROUTE')
  })

  it('keeps the opt-in Pi SDK query path separate from the RPC command', async () => {
    const previous = process.env.GRIMOIRE_PI_SDK_RUNTIME
    process.env.GRIMOIRE_PI_SDK_RUNTIME = '1'
    try {
      const sessionId = createAiSession({ runtime: 'pi', modelId: 'm' }).id
      const prepared = await prepareNativeRuntime({ store: 'ai', sessionId, kind: 'pi', provider: { id: 'p', base_url: 'https://p.invalid', api_key: 'k' }, model: 'm', metadata: {} })
      expect(prepared.config.driver).toBe('pi-sdk')
      expect(prepared.config.command).toBeUndefined()
      expect(prepared.config.args).toBeUndefined()
      expect(prepared.config.sdk).toMatchObject({ enabled: true, ownerId: 'ai:' + sessionId })
      expect(prepared.identity.driver).toBe('pi-sdk')
    } finally {
      if (previous === undefined) delete process.env.GRIMOIRE_PI_SDK_RUNTIME
      else process.env.GRIMOIRE_PI_SDK_RUNTIME = previous
    }
  })
})
