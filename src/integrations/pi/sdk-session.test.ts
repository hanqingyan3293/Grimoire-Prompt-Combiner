import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildPiProviderInjection } from './modelInjection'
import { createPiSdkResourceLoader, createPiSdkSession, piSdkDigest, type PiSdkSessionHandle } from './sdk-session'

// Vitest runs modules in a VM without new Function's native import callback.
// Only the test import transport changes; production/native ESM is smoke-tested.
vi.mock('./piSdk', () => ({
  loadPiSdk: () => import('@earendil-works/pi-coding-agent'),
  loadPiAi: () => import('@earendil-works/pi-ai'),
}))

const owned: string[] = []
const handles: PiSdkSessionHandle[] = []
afterEach(async () => {
  await Promise.all(handles.splice(0).map(handle => handle.dispose()))
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true })
  vi.restoreAllMocks()
})
function options() {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pi-sdk-session-test-')))
  owned.push(cwd)
  const injection = buildPiProviderInjection({
    id: 'grimoire-sdk-test', name: 'Fixture', baseUrl: 'http://127.0.0.1:1/v1',
    api: 'openai-completions', route: 'direct-api-key',
  }, { id: 'grimoire-sdk-test::fixture', providerId: 'grimoire-sdk-test', apiModelId: 'fixture', name: 'Fixture', capabilities: [] }, 'fixture-memory-only-key')
  return { ownerId: 'unit-owner', localSessionId: 'local-test', cwd,
    injection, configFingerprint: piSdkDigest('test-config'), systemPrompt: 'Host literal', customTools: [] }
}

describe('Pi SDK source session boundary', () => {
  it('exposes no discovering loader ports and refuses external resource changes', async () => {
    const loader = await createPiSdkResourceLoader('literal')
    expect(loader.getSkills().skills).toEqual([])
    expect(loader.getPrompts().prompts).toEqual([])
    expect(loader.getThemes().themes).toEqual([])
    expect(loader.getAgentsFiles().agentsFiles).toEqual([])
    expect(loader.getSystemPrompt()).toBe('literal')
    expect(loader.getSystemPromptSource()).toBeUndefined()
    expect(loader.getAppendSystemPromptSources()).toEqual([])
    expect(loader.getExtensions().extensions.map(extension => extension.path)).toEqual(['<grimoire:pi-sdk-boundary>'])
    expect(() => loader.extendResources({ skillPaths: [] })).toThrow('disabled')
    await expect(loader.reload()).rejects.toThrow('disabled')
  })

  it('uses actual ModelRuntime/AgentSessionRuntime without fetch, profiles, persistence or native tools; disposes credentials', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network allowed'))
    const input = options()
    const handle = await createPiSdkSession(input)
    handles.push(handle)
    const { session, services } = handle.runtime
    expect(session.sessionId).toBeTruthy()
    expect(session.sessionFile).toBeUndefined()
    expect(session.getActiveToolNames()).toEqual([])
    expect(session.getCallableToolNames()).toEqual([])
    // Source appends its canonical cwd marker even to an explicit literal prompt.
    expect(session.systemPrompt).toMatch(/^Host literal\n\n<cwd>\n/)
    expect(session.systemPrompt).toContain('</cwd>')
    expect(services.settingsManager.getCacheWarmingMode()).toBe('off')
    expect(services.settingsManager.getRetrySettings().enabled).toBe(false)
    expect(services.settingsManager.getCompactionEnabled()).toBe(false)
    expect((await services.modelRuntime.getAuth(session.model!))?.auth.apiKey).toBe(input.injection.apiKey)
    expect(fetch).not.toHaveBeenCalled()
    await handle.dispose()
    await handle.dispose()
    expect(services.modelRuntime.getRegisteredProviderIds()).not.toContain(input.injection.providerName)
    expect(await services.modelRuntime.listCredentials()).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  }, 20_000)

  it('rejects request-scoped environment injection before SDK resource setup', async () => {
    const input = options()
    input.injection.requestEnvironment = { AZURE_OPENAI_API_VERSION: 'fixture' }
    await expect(createPiSdkSession(input)).rejects.toThrow('requestEnvironment/Azure')
  })

  it('redacts source message_end before SessionManager persists a provider message', async () => {
    const loader = await createPiSdkResourceLoader('', ['fixture-secret'])
    const boundary = loader.getExtensions().extensions[0]
    const hook = boundary.handlers.get('message_end')![0]
    const result = await hook({ message: { role: 'assistant', errorMessage: 'provider echoed fixture-secret', content: [{ type: 'text', text: 'fixture-secret' }] } })
    expect(JSON.stringify(result)).not.toContain('fixture-secret')
    expect(JSON.stringify(result)).toContain('[REDACTED]')
  })
})
