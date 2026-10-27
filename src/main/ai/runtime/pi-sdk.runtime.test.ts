import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { RuntimeEvent, RuntimeMessage } from './types'
import { buildPiProviderInjection } from '../../../integrations/pi/modelInjection'
import { createPiSdkSession, type PiSdkSessionOptions } from '../../../integrations/pi/sdk-session'
import { PiSdkRuntime, type PiSdkRuntimeConfig } from './pi-sdk.runtime'

vi.mock('../../../integrations/pi/sdk-session', async importOriginal => {
  const real = await importOriginal<typeof import('../../../integrations/pi/sdk-session')>()
  return { ...real, createPiSdkSession: vi.fn() }
})
const create = vi.mocked(createPiSdkSession)
const owned: string[] = []
const runtimes: PiSdkRuntime[] = []
let mode: 'text' | 'no-settled' | 'tool' | 'wait' = 'text'
let lastOptions: PiSdkSessionOptions
let dispose: ReturnType<typeof vi.fn>
let executions: ReturnType<typeof vi.fn>
let sourceListeners: Set<(event: any) => void>
function emit(event: unknown) { for (const listener of sourceListeners) listener(event) }

function fixture(extra: Partial<PiSdkRuntimeConfig> = {}) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pi-sdk-runtime-test-')))
  owned.push(cwd)
  const injection = buildPiProviderInjection({
    id: 'fixture', name: 'Fixture', baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', route: 'direct-api-key',
  }, { id: 'fixture::model', providerId: 'fixture', apiModelId: 'model', name: 'Fixture', capabilities: [] }, 'unit-memory-secret')
  const config: PiSdkRuntimeConfig = { enabled: true, ownerId: 'unit-owner', cwd, model: 'fixture::model', injection, ...extra }
  const runtime = new PiSdkRuntime(config)
  runtimes.push(runtime)
  return runtime
}
async function drain(iterator: AsyncGenerator<RuntimeEvent>) { const events: RuntimeEvent[] = []; for await (const event of iterator) events.push(event); return events }
function input(sessionId: string, content = 'hi', prefix: RuntimeMessage[] = []) {
  return { sessionId, model: 'fixture::model', messages: [...prefix, { role: 'user' as const, content }] }
}
beforeEach(() => {
  create.mockReset()
  sourceListeners = new Set()
  mode = 'text'
  dispose = vi.fn(async () => undefined)
  executions = vi.fn(async () => 'host output')
  create.mockImplementation(async options => {
    lastOptions = options
    let release: (() => void) | undefined
    const session = {
      isIdle: true,
      subscribe(listener: (event: any) => void) { sourceListeners.add(listener); return () => sourceListeners.delete(listener) },
      async prompt() {
        session.isIdle = false
        if (mode === 'wait') { await new Promise<void>(resolve => { release = resolve }); session.isIdle = true; emit({ type: 'agent_settled' }); return }
        if (mode === 'tool') {
          emit({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'grimoire_echo', args: { value: 'same' } })
          let result: unknown
          let isError = false
          try { result = await options.customTools[0].execute('call-1', { value: 'same' }, undefined, undefined, {} as never) }
          catch { isError = true }
          emit({ type: 'tool_execution_end', toolCallId: 'call-1', toolName: 'grimoire_echo', result, isError })
        }
        emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'answer' } })
        emit({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } })
        emit({ type: 'agent_end', messages: [], willRetry: false })
        session.isIdle = true
        if (mode !== 'no-settled') emit({ type: 'agent_settled' })
      },
      async waitForIdle() {},
      async abort() { release?.() },
    }
    return { runtime: { session } as never, checkpoint: () => undefined, dispose }
  })
})
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.close()))
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true })
})
function toolConfig(): Partial<PiSdkRuntimeConfig> {
  return { toolAllowlist: ['grimoire_echo'], customTools: [{ name: 'grimoire_echo', description: 'Fixture',
    parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } as unknown as ToolDefinition['parameters'],
    execute: (...args) => executions(...args),
  }] }
}

describe('PiSdkRuntime main-only feature gate', () => {
  it('rejects disabled gates, native tool names, prompt tool injection and Azure environment without loading SDK', async () => {
    expect(() => fixture({ enabled: false })).toThrow('feature gate')
    const native = toolConfig()
    native.toolAllowlist = ['bash']
    native.customTools = native.customTools!.map(tool => ({ ...tool, name: 'bash' }))
    expect(() => fixture(native)).toThrow('native tools')
    expect(create).not.toHaveBeenCalled()
    const runtime = fixture()
    const session = runtime.createSession('fixture::model')
    const events = await drain(runtime.send({ ...input(session.id), tools: [{ name: 'bash' }] }))
    expect(events).toMatchObject([{ type: 'failed' }])
    expect(create).not.toHaveBeenCalled()
    expect(JSON.stringify(runtime)).not.toContain('unit-memory-secret')
  })

  it('keeps the real source session across prompts and rejects altered host history', async () => {
    const runtime = fixture()
    const session = runtime.createSession('fixture::model')
    expect((await drain(runtime.send(input(session.id)))).at(-1)).toEqual({ type: 'completed', text: 'answer', toolOwnership: 'runtime' })
    const history: RuntimeMessage[] = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'answer' }]
    expect((await drain(runtime.send(input(session.id, 'second', history)))).at(-1)?.type).toBe('completed')
    expect(create).toHaveBeenCalledTimes(1)
    expect((await drain(runtime.send(input(session.id, 'third', history)))).at(-1)?.type).toBe('failed')
    expect(lastOptions.customTools).toEqual([])
    expect(sourceListeners.size).toBe(0)
    expect(runtime.getCapabilities()['native.tools'].state).toBe('unavailable')
    expect(runtime.getCapabilities()['event.replay'].state).toBe('unavailable')
  })

  it('does not complete on agent_end without authoritative agent_settled', async () => {
    mode = 'no-settled'
    const runtime = fixture()
    const session = runtime.createSession('fixture::model')
    const events = await drain(runtime.send(input(session.id)))
    expect(events.at(-1)?.type).toBe('failed')
    expect(events.some(event => event.type === 'completed')).toBe(false)
    expect(events.some(event => event.type === 'usage')).toBe(false)
  })

  it('rejects busy send, aborts the source wait and disposes once', async () => {
    mode = 'wait'
    const runtime = fixture()
    const session = runtime.createSession('fixture::model')
    const generator = runtime.send(input(session.id))
    await generator.next()
    await vi.waitFor(() => expect(sourceListeners.size).toBe(1))
    expect((await drain(runtime.send(input(session.id)))).at(-1)?.type).toBe('failed')
    await runtime.interrupt(session.id)
    expect((await drain(generator)).at(-1)?.type).toBe('cancelled')
    await runtime.close()
    await runtime.close()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('gates permission before host execute, rejects foreign/stale replies and honors deny', async () => {
    mode = 'tool'
    const runtime = fixture(toolConfig())
    const session = runtime.createSession('fixture::model')
    const events: RuntimeEvent[] = []
    for await (const event of runtime.send(input(session.id))) {
      events.push(event)
      if (event.type === 'permission-requested') {
        expect(executions).not.toHaveBeenCalled()
        await expect(runtime.approve({ requestId: event.requestId, sessionId: 'foreign', decision: 'accept' })).rejects.toThrow('mismatched')
        await expect(runtime.approve({ requestId: event.requestId, sessionId: session.id, callId: 'foreign', decision: 'accept' })).rejects.toThrow('mismatched')
        await runtime.reject({ requestId: event.requestId, sessionId: session.id, callId: 'call-1', action: event.action, decision: 'decline' })
        await expect(runtime.approve({ requestId: event.requestId, sessionId: session.id, decision: 'accept' })).rejects.toThrow('stale')
      }
    }
    expect(executions).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({ type: 'completed', toolOwnership: 'runtime' })
    expect(events.find(event => event.type === 'tool-started')).toMatchObject({ ownership: 'runtime' })
  })

  it('grants only the same session/tool/input and never leaks credentials in events or host output', async () => {
    mode = 'tool'
    executions.mockResolvedValue('unit-memory-secret')
    const runtime = fixture(toolConfig())
    const session = runtime.createSession('fixture::model')
    for await (const event of runtime.send(input(session.id))) {
      expect(JSON.stringify(event)).not.toContain('unit-memory-secret')
      if (event.type === 'permission-requested') await runtime.approve({ requestId: event.requestId, sessionId: session.id, decision: 'acceptForSession' })
    }
    expect(executions).toHaveBeenCalledTimes(1)
    const history: RuntimeMessage[] = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'answer' }]
    const next = await drain(runtime.send(input(session.id, 'again', history)))
    expect(next.some(event => event.type === 'permission-requested')).toBe(false)
    expect(executions).toHaveBeenCalledTimes(2)
    const foreign = runtime.createSession('fixture::model')
    for await (const event of runtime.send(input(foreign.id))) {
      if (event.type === 'permission-requested') await runtime.reject({ requestId: event.requestId, sessionId: foreign.id, decision: 'decline' })
    }
    expect(executions).toHaveBeenCalledTimes(2)
  })

  it('fails closed on non-native history restore and disabled lifecycle gates', async () => {
    const runtime = fixture()
    const session = runtime.createSession('fixture::model')
    expect(() => runtime.loadSession({ ...session, id: 'restored' })).toThrow('main-owned matching native reference')
    await expect(runtime.forkSession(session.id)).rejects.toThrow('feature gate')
    await expect(drain(runtime.compactSession(session.id))).rejects.toThrow('feature gate')
  })
})
