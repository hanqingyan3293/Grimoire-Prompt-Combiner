import fs from 'node:fs'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntime, RuntimeEvent, RuntimeSendInput } from '../ai/runtime/types'
import { IPC_CHANNELS } from '../../shared/types'

const mock = vi.hoisted(() => ({ root: '', handlers: new Map<string, Function>(), runtime: null as AgentRuntime | null, execute: vi.fn(), senderEvents: [] as Array<{ sender: unknown; sends: ReturnType<typeof vi.fn> }> }))
vi.mock('electron', () => ({ app: { getPath: () => mock.root }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: (key: string, handler: Function) => mock.handlers.set(key, handler) } }))
vi.mock('./providers.ipc', () => ({ getActiveProvider: async () => ({ id: 'provider', name: 'Mock', default_model: 'model', base_url: 'http://mock' }) }))
vi.mock('../ai/runtime/registry', () => ({ createAgentRuntime: () => mock.runtime }))
vi.mock('../ai/runtime/grimoire-tools', () => ({ createGrimoireToolRegistry: () => ({ list: () => [{ name: 'grimoire.write', description: 'Mock tool', inputSchema: { type: 'object' } }], execute: mock.execute }) }))
vi.mock('../services/agent-runtime-manager', () => ({ inspectAgentRuntime: vi.fn(), inspectAgentRuntimes: vi.fn(), resolveAgentRuntimeCommand: () => ({ command: 'pi', args: [] }), shutdownAgentRuntimes: vi.fn(), startOpenCodeRuntime: vi.fn() }))
vi.mock('../services/agent-runtime-preparation.service', () => ({
  prepareNativeRuntime: vi.fn(async ({ store, sessionId, kind }: { store: 'ai' | 'agent'; sessionId: string; kind: 'pi' | 'opencode' }) => ({
    config: { endpoint: 'http://127.0.0.1:4096', model: 'grimoire/model', nativeToolPolicy: 'ask' },
    identity: { runtime: kind, driver: kind === 'opencode' ? 'opencode-legacy' : 'pi-rpc', owner: store + ':' + sessionId, directory: '/main-owned', binaryVersion: kind === 'opencode' ? '1.18.34' : '1.0.1', configFingerprint: 'permission-test-config' },
    release: async () => {},
  })),
}))
import { initDatabase, closeDatabase } from '../database'
import { createAiSession, getAiSession } from '../services/ai-session.service'
import { createAgentSession, getAgentSession } from '../services/agent-session.service'
import { registerAiSessionsIPC, shutdownAiSessions } from './ai-sessions.ipc'
import { registerAgentIPC, shutdownAgentPermissionBroker } from './agent.ipc'
import { OpenAICompatibleRuntime } from '../ai/runtime/openai-compatible.runtime'

const call = { callId: 'call-1', name: 'grimoire.write', input: { value: 1 } }
function runtime(batches: RuntimeEvent[][]): AgentRuntime {
  let index = 0
  return {
    kind: 'openai-compatible',
    createSession: vi.fn((model, messages = []) => ({ id: 'one-runtime-session', runtime: 'openai-compatible' as const, model, createdAt: 'now', messages })),
    send: vi.fn(async function* (_input: RuntimeSendInput) { for (const event of batches[index++] || []) yield event }),
    interrupt: vi.fn(async () => {}), close: vi.fn(async () => {})
  }
}
function makeSender() { const events = new EventEmitter(); const sends = vi.fn(); const sender = Object.assign(events, { isDestroyed: () => false, send: sends }); mock.senderEvents.push({ sender, sends }); return sender }
function invokeAs(sender: unknown, channel: string, value: unknown) { return mock.handlers.get(channel)!({ sender }, value) }
function invoke(channel: string, value: unknown) { return invokeAs(makeSender(), channel, value) }

beforeEach(async () => {
  mock.root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-runtime-turn-'))
  await initDatabase()
  mock.handlers.clear()
  mock.execute.mockReset().mockResolvedValue({ ok: true })
  mock.senderEvents = []
  registerAiSessionsIPC(); registerAgentIPC()
})
afterEach(async () => { await shutdownAiSessions(); shutdownAgentPermissionBroker(); closeDatabase(); fs.rmSync(mock.root, { recursive: true, force: true }) })

for (const kind of ['ai', 'agent'] as const) {
  describe(`${kind} registered send lifecycle and ownership`, () => {
    function session() { return kind === 'ai' ? createAiSession({ runtime: 'openai-compatible', modelId: 'model' }) : createAgentSession({ runtime: 'openai-compatible', model: 'model' }) }
    function send(id: string) { return invoke(kind === 'ai' ? IPC_CHANNELS.AI_SESSION_SEND : IPC_CHANNELS.AGENT_SESSION_SEND, { sessionId: id, content: 'hello' }) }
    function assertLifecycle(expectedSends: number) {
      expect(mock.runtime!.createSession).toHaveBeenCalledTimes(1)
      expect(mock.runtime!.send).toHaveBeenCalledTimes(expectedSends)
      for (const [input] of vi.mocked(mock.runtime!.send).mock.calls) expect(input.sessionId).toBe('one-runtime-session')
      expect(mock.runtime!.interrupt).toHaveBeenCalledTimes(1)
      expect(mock.runtime!.interrupt).toHaveBeenCalledWith('one-runtime-session')
      expect(mock.runtime!.close).toHaveBeenCalledTimes(1)
    }
    it('executes only the host completion batch once and reuses the session with updated messages', async () => {
      mock.runtime = runtime([[{ type: 'tool-started', ...call }, { type: 'completed', text: '', toolOwnership: 'host', toolCalls: [call] }], [{ type: 'text-delta', text: 'done' }, { type: 'completed', text: 'done' }]])
      await send(session().id)
      assertLifecycle(2)
      expect(mock.execute).toHaveBeenCalledTimes(1)
      expect(vi.mocked(mock.runtime.send).mock.calls[1][0].messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'tool', toolCallId: call.callId })]))
    })
    it.each(['runtime', undefined] as const)('does not execute telemetry or an unproven completion ownership %s', async ownership => {
      mock.runtime = runtime([[{ type: 'tool-started', ownership: 'runtime', ...call }, { type: 'tool-progress', ownership: 'runtime', callId: call.callId, output: 'partial' }, { type: 'tool-finished', ownership: 'runtime', callId: call.callId, output: 'done' }, { type: 'completed', text: '', toolCalls: [call], toolOwnership: ownership }]])
      const id = session().id
      await send(id)
      assertLifecycle(1)
      expect(mock.execute).not.toHaveBeenCalled()
      const snapshot = kind === 'ai' ? getAiSession(id) : getAgentSession(id)
      expect(snapshot!.events.length).toBeGreaterThan(0)
    })
    it.each(['chat_completions', 'responses'] as const)('keeps actual OpenAI-compatible %s host execution working', async protocol => {
      const actual = new OpenAICompatibleRuntime({ apiKey: 'mock', protocol })
      let count = 0
      const create = async function* () {
        if (count++ === 0) {
          if (protocol === 'responses') yield { type: 'response.output_item.done', item: { type: 'function_call', call_id: call.callId, name: call.name, arguments: JSON.stringify(call.input) } }
          else yield { choices: [{ delta: { tool_calls: [{ index: 0, id: call.callId, function: { name: call.name, arguments: JSON.stringify(call.input) } }] } }] }
        }
      }
      ;(actual as any).client = { responses: { create }, chat: { completions: { create } } }
      mock.runtime = actual
      await send(session().id)
      expect(count).toBe(2)
      expect(mock.execute).toHaveBeenCalledTimes(1)
      expect(mock.execute).toHaveBeenCalledWith(call.name, call.input, expect.objectContaining({ toolCallId: call.callId }))
    })
    it('keeps native session grants exact across production IPC sends', async () => {
      const nativeDetail = (pattern: string) => ({ patterns: [pattern], tool: { name: 'bash', callID: 'native-call' } })
      const permissionEvent = (requestId: string, pattern: string): RuntimeEvent => ({ type: 'permission-requested', requestId, action: 'bash', detail: nativeDetail(pattern) })
      mock.runtime = {
        ...runtime([
          [permissionEvent('native-one', 'echo allowed'), { type: 'completed', text: 'first' }],
          [permissionEvent('native-two', 'echo allowed'), { type: 'completed', text: 'second' }],
          [permissionEvent('native-three', 'rm -rf blocked'), { type: 'completed', text: 'must not complete' }],
        ]),
        kind: kind === 'ai' ? 'openai-compatible' : 'openai-compatible',
        approve: vi.fn(async () => {}),
        reject: vi.fn(async () => {}),
      }
      const id = kind === 'ai' ? createAiSession({ runtime: 'opencode', modelId: 'model' }).id : createAgentSession({ runtime: 'opencode', model: 'model' }).id
      const choices = ['allowForSession', 'deny']
      const sends = vi.fn((channel: string, value: { requestId: string }) => {
        const decision = choices.shift()
        queueMicrotask(() => { void invokeAs(sender, channel === IPC_CHANNELS.AI_PERMISSION_REQUEST ? IPC_CHANNELS.AI_PERMISSION_DECISION : IPC_CHANNELS.AGENT_PERMISSION_DECISION, { requestId: value.requestId, decision }) })
      })
      const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: sends })
      const send = (content: string) => invokeAs(sender, kind === 'ai' ? IPC_CHANNELS.AI_SESSION_SEND : IPC_CHANNELS.AGENT_SESSION_SEND, { sessionId: id, content })

      await send('first')
      await send('same exact native scope')
      await send('different native resource')

      expect(sends).toHaveBeenCalledTimes(2)
      expect(mock.runtime!.approve).toHaveBeenCalledTimes(2)
      expect(mock.runtime!.reject).toHaveBeenCalledTimes(1)
      expect(mock.runtime!.approve).toHaveBeenNthCalledWith(1, expect.objectContaining({ decision: 'accept', action: 'bash' }))
      expect(mock.runtime!.approve).toHaveBeenNthCalledWith(2, expect.objectContaining({ decision: 'accept', action: 'bash' }))
      expect(mock.runtime!.reject).toHaveBeenCalledWith(expect.objectContaining({ decision: 'decline', action: 'bash' }))
    })

    it('closes once after a second-send failure', async () => {
      mock.runtime = runtime([[{ type: 'completed', text: '', toolOwnership: 'host', toolCalls: [call] }], [{ type: 'failed', error: 'broken' }]])
      await expect(send(session().id)).rejects.toThrow('broken')
      assertLifecycle(2)
    })
    it('still closes exactly once if final interrupt fails', async () => {
      mock.runtime = runtime([[{ type: 'completed', text: '' }]])
      vi.mocked(mock.runtime.interrupt!).mockRejectedValue(new Error('interrupt failed'))
      await expect(send(session().id)).rejects.toThrow('interrupt failed')
      assertLifecycle(1)
    })
    it('does not execute a started tool after cancellation and closes once', async () => {
      mock.runtime = runtime([[{ type: 'tool-started', ...call }, { type: 'cancelled', reason: 'user' }]])
      const id = session().id
      await send(id)
      assertLifecycle(1)
      expect(mock.execute).not.toHaveBeenCalled()
      expect((kind === 'ai' ? getAiSession(id) : getAgentSession(id))!.session.status).toBe('interrupted')
    })
  })
}

it('AI archive revokes a native session grant before the next production send', async () => {
  const detail = (pattern: string) => ({ patterns: [pattern], tool: { name: 'bash', callID: 'archive-call' } })
  const event = (requestId: string, pattern: string): RuntimeEvent => ({ type: 'permission-requested', requestId, action: 'bash', detail: detail(pattern) })
  mock.runtime = {
    ...runtime([[event('archive-one', 'echo allowed'), { type: 'completed', text: 'first' }], [event('archive-two', 'echo allowed'), { type: 'completed', text: 'second' }]]),
    approve: vi.fn(async () => {}), reject: vi.fn(async () => {}),
  }
  const id = createAiSession({ runtime: 'opencode', modelId: 'model' }).id
  const decisions = ['allowForSession', 'deny']
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn((channel: string, value: { requestId: string }) => {
    queueMicrotask(() => { void invokeAs(sender, IPC_CHANNELS.AI_PERMISSION_DECISION, { requestId: value.requestId, decision: decisions.shift() }) })
  }) })
  const send = () => invokeAs(sender, IPC_CHANNELS.AI_SESSION_SEND, { sessionId: id, content: 'hello' })
  await send()
  expect(sender.listenerCount('destroyed')).toBe(1)
  await invokeAs(sender, IPC_CHANNELS.AI_SESSION_ARCHIVE, id)
  expect(sender.listenerCount('destroyed')).toBe(0)
  await send()
  expect(sender.send).toHaveBeenCalledTimes(2)
  expect(mock.runtime!.approve).toHaveBeenCalledTimes(1)
  expect(mock.runtime!.reject).toHaveBeenCalledTimes(1)
})

it('Agent delete revokes its persistent native permission grant', async () => {
  const detail = { patterns: ['echo agent-scope'], tool: { name: 'bash', callID: 'agent-delete-call' } }
  mock.runtime = {
    ...runtime([[{ type: 'permission-requested', requestId: 'agent-delete-request', action: 'bash', detail }, { type: 'completed', text: 'ok' }]]),
    approve: vi.fn(async () => {}), reject: vi.fn(async () => {}),
  }
  const id = createAgentSession({ runtime: 'opencode', model: 'model' }).id
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn((_channel: string, value: { requestId: string }) => { queueMicrotask(() => { void invokeAs(sender, IPC_CHANNELS.AGENT_PERMISSION_DECISION, { requestId: value.requestId, decision: 'allowForSession' }) }) }) })
  await invokeAs(sender, IPC_CHANNELS.AGENT_SESSION_SEND, { sessionId: id, content: 'hello' })
  expect(sender.listenerCount('destroyed')).toBe(1)
  await invokeAs(sender, IPC_CHANNELS.AGENT_SESSION_DELETE, id)
  expect(sender.listenerCount('destroyed')).toBe(0)
})

it('AI cancellation targets the one runtime session and finally does not interrupt twice', async () => {
  const id = createAiSession({ runtime: 'openai-compatible', modelId: 'model' }).id
  mock.runtime = runtime([])
  mock.runtime.send = vi.fn(async function* () {
    await invoke(IPC_CHANNELS.AI_SESSION_INTERRUPT, id)
    await invoke(IPC_CHANNELS.AI_SESSION_INTERRUPT, id)
    yield { type: 'cancelled' as const, reason: 'user' }
  })
  await invoke(IPC_CHANNELS.AI_SESSION_SEND, { sessionId: id, content: 'hello' })
  expect(mock.runtime.interrupt).toHaveBeenCalledTimes(1)
  expect(mock.runtime.close).toHaveBeenCalledTimes(1)
})
