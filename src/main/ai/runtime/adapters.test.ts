import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPiRpcArgs, OpenCodeRuntime, PiRuntime, normalizePiRpcRecord, type PiRpcTurnState } from './adapters'
import type { RuntimeEvent } from './types'

afterEach(() => vi.unstubAllGlobals())

describe('local runtime protocol adapters', () => {
  it('reports explicit OpenCode and Pi capability states without hiding blockers', () => {
    const openCode = new OpenCodeRuntime({ endpoint: 'http://127.0.0.1:4097' }).getCapabilities()
    const pi = new PiRuntime('unused').getCapabilities()
    expect(openCode['session.resume'].state).toBe('blocked')
    expect(openCode['event.replay'].state).toBe('blocked')
    expect(openCode.recovery.state).toBe('not-implemented')
    expect(pi['session.resume'].state).toBe('blocked')
    expect(pi['native.tools'].state).toBe('blocked')
    expect(pi['permission.once'].state).toBe('blocked')
  })

  it('uses agent_end messages but waits for payload-free agent_settled, including retry', () => {
    const state: PiRpcTurnState = {}
    expect(normalizePiRpcRecord({ type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'retry' }] }], willRetry: true }, state)).toEqual([])
    expect(state).toEqual({ text: 'retry', willRetry: true })
    expect(normalizePiRpcRecord({ type: 'agent_end', messages: [{ role: 'user', content: 'not assistant' }, { role: 'assistant', content: [{ type: 'thinking', text: 'private' }, { type: 'text', text: 'done' }] }], willRetry: false }, state)).toEqual([])
    expect(normalizePiRpcRecord({ type: 'agent_settled' }, state)).toEqual([{ type: 'completed', text: 'done' }])
    expect(normalizePiRpcRecord({ type: 'agent_settled', message: { text: 'invented payload' } })).toEqual([{ type: 'completed', text: '' }])
  })

  it('maps exact Pi 1.0.1 tool records to one execution start, progress, and finish', () => {
    expect(normalizePiRpcRecord({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'reasoning' } })).toEqual([{ type: 'reasoning-delta', text: 'reasoning' }])
    expect(normalizePiRpcRecord({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0, id: 'call_1', toolName: 'read' } })).toEqual([])
    expect(normalizePiRpcRecord({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_end', contentIndex: 0, toolCall: { type: 'toolCall', id: 'call_1', name: 'read', arguments: { path: 'a' } } } })).toEqual([])
    expect(normalizePiRpcRecord({ type: 'tool_execution_start', toolCallId: 'call_1', toolName: 'read', args: { path: 'a' } })).toEqual([{ type: 'tool-started', ownership: 'runtime', callId: 'call_1', name: 'read', input: { path: 'a' } }])
    expect(normalizePiRpcRecord({ type: 'tool_execution_update', toolCallId: 'call_1', toolName: 'read', partialResult: 'progress' })).toEqual([{ type: 'tool-progress', ownership: 'runtime', callId: 'call_1', name: 'read', status: 'running', output: 'progress' }])
    expect(normalizePiRpcRecord({ type: 'tool_execution_end', toolCallId: 'call_1', result: 'done', isError: false })).toEqual([{ type: 'tool-finished', ownership: 'runtime', callId: 'call_1', output: 'done', error: undefined }])
  })

  it('Pi send retains authoritative text without deltas and does not end at a retry', async () => {
    const runtime = new PiRuntime('unused')
    const records = [
      { type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'retry' }] }], willRetry: true },
      { type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'final' }] }], willRetry: false },
      { type: 'agent_settled' }
    ]
    const internal = runtime as any
    internal.ensureChild = async () => { internal.child = { stdin: { write: vi.fn() } } }
    internal.nextLine = async () => JSON.stringify(records.shift())
    const session = runtime.createSession('model', [{ role: 'user', content: 'hello' }])
    const events = []
    for await (const event of runtime.send({ sessionId: session.id, model: session.model, messages: session.messages })) events.push(event)
    expect(events).toEqual([{ type: 'session-started', sessionId: session.id }, { type: 'completed', text: 'final' }])
    expect(session.messages.at(-1)?.content).toBe('final')
    expect(runtime).not.toHaveProperty('approve')
  })

  it('builds a safe Pi RPC command with managed session and no native tools/extensions', () => {
    expect(buildPiRpcArgs({
      command: 'pi.exe', provider: 'p', model: 'p::m', apiKey: 'secret', baseUrl: 'https://provider.invalid/v1',
      api: 'openai-completions', sessionId: 'grimoire-session', sessionDir: 'C:/managed/sessions',
    })).toEqual(['--mode', 'rpc', '--provider', 'p', '--model', 'm', '--session-id', 'grimoire-session', '--session-dir', 'C:/managed/sessions', '--no-tools', '--no-extensions'])
    expect(buildPiRpcArgs({ command: 'pi.exe', args: ['--no-tools', '--extension', 'trusted'], allowNativeTools: true, allowExtensions: true })).toEqual(['--no-tools', '--extension', 'trusted', '--mode', 'rpc', '--no-session'])
    expect(() => buildPiRpcArgs({ command: 'pi.exe', args: ['--tools', 'bash'] })).toThrow('PI_NATIVE_TOOLS_DISABLED')
    expect(() => buildPiRpcArgs({ command: 'pi.exe', args: ['--extension', 'untrusted.mjs'] })).toThrow('PI_EXTENSIONS_DISABLED')
    expect(() => buildPiRpcArgs({ command: 'pi.exe', args: ['--api-key', 'secret'] })).toThrow('PI_API_KEY_ARG_FORBIDDEN')
  })
})

type RecordEvent = Record<string, unknown>
const endpoint = 'http://127.0.0.1:4097'
const frame = (record: RecordEvent) => 'data: ' + JSON.stringify(record) + '\n\n'
const metadata = (sessionID = 'remote', id = 'assistant', role = 'assistant'): RecordEvent => ({ type: 'message.updated', properties: { sessionID, info: { sessionID, id, role } } })
const snapshot = (id: string, text: string, type = 'text', messageID = 'assistant', sessionID = 'remote'): RecordEvent => ({ type: 'message.part.updated', properties: { sessionID, part: { id, messageID, sessionID, type, text } } })
const delta = (partID: string, text: string, messageID = 'assistant', sessionID = 'remote'): RecordEvent => ({ type: 'message.part.delta', properties: { sessionID, messageID, partID, field: 'text', delta: text } })
const idle = (sessionID = 'remote'): RecordEvent => ({ type: 'session.idle', properties: { sessionID } })
const permission = (sessionID = 'remote', id = 'permission', action = 'bash'): RecordEvent => ({ type: 'permission.asked', properties: { sessionID, id, permission: action, patterns: ['echo ok'], tool: { messageID: 'assistant', callID: 'call' } } })
const tool = (status: string, input: unknown = { command: 'echo ok' }, sessionID = 'remote'): RecordEvent => ({ type: 'message.part.updated', properties: { sessionID, part: { sessionID, messageID: 'assistant', id: 'tool-part', type: 'tool', tool: 'bash', callID: 'call', state: { status, input, output: '', error: status === 'error' ? 'native tool failed' : undefined } } } })
const terminalEvents = (events: RuntimeEvent[]) => events.filter(event => ['completed', 'failed', 'cancelled'].includes(event.type))
async function collect(runtime: OpenCodeRuntime, session: ReturnType<OpenCodeRuntime['createSession']>) {
  const events: RuntimeEvent[] = []
  for await (const event of runtime.send({ sessionId: session.id, model: session.model, messages: session.messages })) events.push(event)
  return events
}
function fixedTurn(records: RecordEvent[] | string, config: ConstructorParameters<typeof OpenCodeRuntime>[0] = { endpoint }) {
  const fetchMock = vi.fn(async (input: string, options?: RequestInit) => {
    const url = new URL(input)
    if (url.pathname === '/api/session') return new Response('{"id":"remote"}')
    if (url.pathname === '/event') return new Response(typeof records === 'string' ? records : records.map(frame).join(''))
    if (options?.method === 'PATCH') return new Response('true')
    if (options?.method === 'POST') return new Response('{}')
    throw new Error('Unexpected route ' + url.pathname)
  })
  vi.stubGlobal('fetch', fetchMock)
  const runtime = new OpenCodeRuntime(config)
  const session = runtime.createSession('grimoire/model', [{ role: 'user', content: 'hello' }])
  return { runtime, session, fetchMock }
}
function liveTurn(options: { pendingPrompt?: boolean; config?: Partial<ConstructorParameters<typeof OpenCodeRuntime>[0]> } = {}) {
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = []
  const streams: ReadableStream<Uint8Array>[] = []
  const promptSignals: AbortSignal[] = []
  const cancelled = vi.fn()
  let reply: (() => Promise<Response>) | undefined
  let remoteCount = 0
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    if (url.pathname === '/api/session') return new Response(JSON.stringify({ id: 'remote-' + ++remoteCount }))
    if (url.pathname === '/event') {
      const stream = new ReadableStream<Uint8Array>({ start(controller) { controllers.push(controller) }, cancel: cancelled })
      streams.push(stream)
      return new Response(stream)
    }
    if (url.pathname.endsWith('/reply')) return reply ? await reply() : new Response('true')
    if (url.pathname.endsWith('/message')) {
      const signal = init!.signal as AbortSignal
      promptSignals.push(signal)
      if (options.pendingPrompt) return await new Promise<Response>((_, reject) => {
        if (signal.aborted) reject(signal.reason)
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
    return new Response('true')
  })
  vi.stubGlobal('fetch', fetchMock)
  const runtime = new OpenCodeRuntime({ endpoint, ...options.config })
  const session = runtime.createSession('grimoire/model', [{ role: 'user', content: 'hello' }])
  const iterator = runtime.send({ sessionId: session.id, model: session.model, messages: session.messages })
  const push = (record: RecordEvent, index = 0) => controllers[index].enqueue(new TextEncoder().encode(frame(record)))
  return { runtime, session, iterator, fetchMock, controllers, streams, promptSignals, cancelled, push, setReply: (value: () => Promise<Response>) => { reply = value } }
}

describe('OpenCode 1.18.34 legacy adapter', () => {
  it('uses version-matched routes, filters user echo, and disables all native tools by default', async () => {
    const fixture = fixedTurn([metadata('remote', 'user', 'user'), snapshot('u', 'user echo', 'text', 'user'), metadata(), snapshot('a', 'OK'), idle()])
    const { runtime, session, fetchMock } = fixture
    expect(await collect(runtime, session)).toEqual([{ type: 'session-started', sessionId: session.id }, { type: 'text-delta', text: 'OK' }, { type: 'completed', text: 'OK' }])
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/api/session', '/event', '/session/remote/message'])
    expect(JSON.parse(fetchMock.mock.calls[2][1]!.body as string)).toEqual({ agent: 'build', model: { providerID: 'grimoire', modelID: 'model' }, tools: { '*': false }, parts: [{ type: 'text', text: 'hello' }] })
    expect(session.messages.at(-1)?.content).toBe('OK')
  })

  it('installs explicit ask rules and denied escape actions, with directory on every legacy route', async () => {
    const { runtime, session, fetchMock } = fixedTurn([idle()], { endpoint, directory: 'C:/isolated workspace', nativeToolPolicy: 'ask' })
    await collect(runtime, session)
    const legacyCalls = fetchMock.mock.calls.filter(([url]) => !url.endsWith('/api/session'))
    expect(legacyCalls.every(([url]) => new URL(url).searchParams.get('directory') === 'C:/isolated workspace')).toBe(true)
    const patch = legacyCalls.find(([, init]) => init?.method === 'PATCH')!
    expect(JSON.parse(patch[1]!.body as string).permission).toEqual([
      { permission: '*', pattern: '*', action: 'ask' },
      ...['external_directory', 'task', 'skill', 'question'].map(permission => ({ permission, pattern: '*', action: 'deny' })),
    ])
    const prompt = legacyCalls.find(([url]) => new URL(url).pathname.endsWith('/message'))!
    expect(JSON.parse(prompt[1]!.body as string)).not.toHaveProperty('tools')
    expect(() => new OpenCodeRuntime({ endpoint, nativeToolPolicy: 'allow' as any })).toThrow('OPENCODE_NATIVE_TOOL_POLICY_INVALID')
  })

  it('merges snapshots/deltas by message+part, routes reasoning, and never treats unknown role as assistant', async () => {
    const repeated = { ...delta('t1', 'B'), id: 'delta-b' }
    const records = [
      snapshot('unknown', 'not an assistant'), metadata('remote', 'user', 'user'), snapshot('u', 'echo', 'text', 'user'),
      metadata(), snapshot('r1', 'think', 'reasoning'), delta('r1', ' more'), snapshot('r1', 'think more', 'reasoning'),
      snapshot('t1', 'A'), repeated, repeated, snapshot('t1', 'AB'), snapshot('t1', 'A'),
      snapshot('t2', 'C'), metadata('remote', 'assistant-2'), snapshot('t1', 'D', 'text', 'assistant-2'),
      delta('missing', 'orphan'), delta('u', 'echo delta', 'user'), idle(), idle(),
    ]
    const { runtime, session } = fixedTurn(records)
    const events = await collect(runtime, session)
    expect(events.filter(event => event.type === 'text-delta').map(event => event.text).join('')).toBe('ABCD')
    expect(events.filter(event => event.type === 'reasoning-delta')).toEqual([{ type: 'reasoning-delta', text: 'think' }, { type: 'reasoning-delta', text: ' more' }])
    expect(terminalEvents(events)).toEqual([{ type: 'completed', text: 'ABCD' }])
  })

  it.each(['completed', 'error'])('emits one native tool start/finish for %s and does not fail the turn on tool failure', async status => {
    const { runtime, session } = fixedTurn([metadata(), tool('pending'), tool('running'), tool('running'), tool(status), tool(status), { type: 'tool.failed', properties: { sessionID: 'remote', error: 'not a Session.Error event' } }, idle()])
    const events = await collect(runtime, session)
    expect(events.filter(event => event.type === 'tool-started')).toEqual([{ type: 'tool-started', ownership: 'runtime', callId: 'call', name: 'bash', input: { command: 'echo ok' } }])
    expect(events.filter(event => event.type === 'tool-finished')).toEqual([{ type: 'tool-finished', ownership: 'runtime', callId: 'call', output: '', error: status === 'error' ? 'native tool failed' : undefined }])
    expect(terminalEvents(events)).toEqual([{ type: 'completed', text: '' }])
  })

  it('filters nested foreign session metadata before bounded event-id dedupe', async () => {
    const { runtime, session } = fixedTurn([
      { ...metadata('foreign'), id: 'shared' }, { ...metadata(), id: 'shared' },
      { type: 'message.part.updated', properties: { part: { sessionID: 'foreign', messageID: 'assistant', id: 'a', type: 'text', text: 'foreign' } } },
      { ...snapshot('a', 'OK'), id: 'shared-part' }, { ...snapshot('a', 'OK'), id: 'shared-part' }, idle(),
    ])
    expect(terminalEvents(await collect(runtime, session))).toEqual([{ type: 'completed', text: 'OK' }])
    const context = { localSessionId: session.id, remoteSessionId: 'remote', turn: { controller: new AbortController() }, messageRoles: new Map(), parts: new Map(), tools: new Map(), permissions: new Map(), seenEventIds: new Set() }
    const normalize = (record: RecordEvent) => (runtime as any).normalizeEvent(record, context)
    normalize({ ...metadata(), id: 'first' })
    for (let i = 0; i < 5000; i++) normalize({ ...metadata('foreign'), id: 'foreign-' + i })
    expect(context.seenEventIds).toEqual(new Set(['first']))
    for (let i = 0; i < 4096; i++) normalize({ ...metadata(), id: 'local-' + i })
    expect(context.seenEventIds.size).toBe(4096)
    expect(context.seenEventIds.has('first')).toBe(false)
  })

  it.each(['session.idle', 'session.error', 'session.compacted', 'session.completed', 'unknown.session.failed'])('ignores no-session or unknown lifecycle %s, rather than false success', async type => {
    const { runtime, session } = fixedTurn([{ type, properties: { message: 'unattributed' } }, { type: 'session.completed', properties: { sessionID: 'remote' } }])
    expect(terminalEvents(await collect(runtime, session))).toEqual([{ type: 'failed', error: 'OpenCode 事件流提前结束：未收到终止事件' }])
  })

  it('maps only real session.compacted, never invented start/end compaction events', async () => {
    const { runtime, session } = fixedTurn([{ type: 'session.compaction.started', properties: { sessionID: 'remote' } }, { type: 'session.compacted', properties: { sessionID: 'remote' } }, { type: 'session.compaction.completed', properties: { sessionID: 'remote' } }, idle()])
    const events = await collect(runtime, session)
    expect(events.filter(event => event.type.startsWith('compaction-'))).toEqual([{ type: 'compaction-finished', detail: { sessionID: 'remote' } }])
  })

  it('keeps remote identity over turns and consumes a restored reference only once', async () => {
    const { runtime, session, fetchMock } = fixedTurn([idle()], { endpoint, remoteSessionId: 'remote' })
    await collect(runtime, session)
    await collect(runtime, session)
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/api/session'))).toBe(false)
    const another = runtime.createSession('grimoire/model')
    expect(runtime.getSessionReference(session.id)).toBe('remote')
    expect(runtime.getSessionReference(another.id)).toBeUndefined()
  })

  it('binds concurrent native permissions to the correct send instead of the last local session', async () => {
    const f = liveTurn()
    const second = f.runtime.createSession('grimoire/model')
    const iterator2 = f.runtime.send({ sessionId: second.id, model: second.model, messages: [] })
    try {
      await f.iterator.next(); await iterator2.next()
      f.push(permission('remote-2', 'foreign'))
      f.push(permission('remote-1', 'permission-a'))
      f.push(permission('remote-2', 'permission-b'), 1)
      expect((await f.iterator.next()).value).toMatchObject({ type: 'permission-requested', requestId: 'permission-a', detail: { localSessionId: f.session.id, remoteSessionId: 'remote-1' } })
      expect((await iterator2.next()).value).toMatchObject({ type: 'permission-requested', requestId: 'permission-b', detail: { localSessionId: second.id, remoteSessionId: 'remote-2' } })
      await expect(f.runtime.approve({ requestId: 'permission-a', decision: 'accept', sessionId: second.id })).rejects.toThrow('会话不匹配')
      await f.runtime.approve({ requestId: 'permission-a', decision: 'accept', sessionId: f.session.id, callId: 'call', action: 'bash' })
      await f.runtime.approve({ requestId: 'permission-b', decision: 'acceptForSession', sessionId: second.id, callId: 'call', action: 'bash' })
      const replies = f.fetchMock.mock.calls.filter(([url]) => url.includes('/reply'))
      expect(replies.map(([, init]) => JSON.parse(init!.body as string))).toEqual([{ reply: 'once' }, { reply: 'once' }])
      f.push(idle('remote-1')); f.push(idle('remote-2'), 1)
      expect((await f.iterator.next()).value?.type).toBe('completed')
      expect((await iterator2.next()).value?.type).toBe('completed')
    } finally { await f.runtime.close(); await f.iterator.return(undefined); await iterator2.return(undefined) }
    expect((f.runtime as any).permissionSessions.size).toBe(0)
  })

  it('rejects unknown/stale/invalid decisions, mismatched call/action, and concurrent duplicate replies', async () => {
    const f = liveTurn()
    let resolveReply!: (response: Response) => void
    try {
      await f.iterator.next(); f.push(permission('remote-1')); await f.iterator.next()
      await expect(f.runtime.approve({ requestId: 'unknown', decision: 'accept' })).rejects.toThrow('已失效')
      await expect(f.runtime.approve({ requestId: 'permission', decision: 'always' as any })).rejects.toThrow('决策无效')
      await expect(f.runtime.approve({ requestId: 'permission', decision: 'accept', callId: 'wrong' })).rejects.toThrow('工具调用不匹配')
      await expect(f.runtime.approve({ requestId: 'permission', decision: 'accept', action: 'wrong' })).rejects.toThrow('动作不匹配')
      f.setReply(() => new Promise(resolve => { resolveReply = resolve }))
      const first = f.runtime.approve({ requestId: 'permission', decision: 'accept' })
      await expect(f.runtime.approve({ requestId: 'permission', decision: 'decline' })).rejects.toThrow('正在回复')
      resolveReply(new Response('true')); await first
      await expect(f.runtime.approve({ requestId: 'permission', decision: 'accept' })).rejects.toThrow('已失效')
      f.push(permission('remote-1')); f.push({ type: 'permission.replied', properties: { sessionID: 'remote-1', requestID: 'permission', reply: 'once' } }); f.push(idle('remote-1'))
      expect((await f.iterator.next()).value).toMatchObject({ type: 'permission-resolved' })
      expect((await f.iterator.next()).value?.type).toBe('completed')
      expect(f.fetchMock.mock.calls.filter(([url]) => url.includes('/reply'))).toHaveLength(1)
    } finally { await f.runtime.close(); await f.iterator.return(undefined) }
  })

  it.each(['external_directory', 'task', 'skill', 'question'])('fails closed for native %s even if a server emits an ask', async action => {
    const f = liveTurn()
    try {
      await f.iterator.next(); f.push(permission('remote-1', 'escape', action)); await f.iterator.next()
      await expect(f.runtime.approve({ requestId: 'escape', decision: 'acceptForSession' })).rejects.toThrow('OPENCODE_NATIVE_ACTION_DISABLED')
      await f.runtime.reject({ requestId: 'escape', decision: 'decline' })
      const reply = f.fetchMock.mock.calls.find(([url]) => url.includes('/reply'))!
      expect(JSON.parse(reply[1]!.body as string)).toEqual({ reply: 'reject' })
    } finally { await f.runtime.close(); await f.iterator.return(undefined) }
  })

  it('cancels the approval response body on HTTP error and does not retry an ambiguous decision', async () => {
    const f = liveTurn()
    const cancel = vi.fn()
    try {
      await f.iterator.next(); f.push(permission('remote-1')); await f.iterator.next()
      f.setReply(async () => new Response(new ReadableStream({ cancel }), { status: 503 }))
      await expect(f.runtime.approve({ requestId: 'permission', decision: 'accept' })).rejects.toThrow('HTTP 503')
      await expect(f.runtime.approve({ requestId: 'permission', decision: 'accept' })).rejects.toThrow('已失效')
      expect(cancel).toHaveBeenCalledTimes(1)
    } finally { await f.runtime.close(); await f.iterator.return(undefined) }
  })

  it.each(['idle', 'error', 'EOF', 'interrupt', 'close'] as const)('expires pending permissions on %s', async mode => {
    const f = liveTurn()
    try {
      await f.iterator.next(); f.push(permission('remote-1')); await f.iterator.next()
      if (mode === 'idle') f.push(idle('remote-1'))
      else if (mode === 'error') f.push({ type: 'session.error', properties: { sessionID: 'remote-1', error: { data: { message: 'native failure' } } } })
      else if (mode === 'EOF') f.controllers[0].close()
      else if (mode === 'interrupt') await f.runtime.interrupt(f.session.id)
      else await f.runtime.close()
      const terminal = await f.iterator.next()
      expect(terminal.value?.type).toBe(mode === 'idle' ? 'completed' : mode === 'interrupt' ? 'cancelled' : 'failed')
      await expect(f.runtime.approve({ requestId: 'permission', decision: 'accept' })).rejects.toThrow('已失效')
      await f.iterator.next()
      expect((f.runtime as any).activeSends.size).toBe(0)
      expect((f.runtime as any).readers.size).toBe(0)
      expect(f.streams[0].locked).toBe(false)
    } finally { await f.runtime.close(); await f.iterator.return(undefined) }
  })

  it.each(['interrupt', 'close', 'timeout'] as const)('aborts a real pending prompt guard and reader on %s without success', async mode => {
    if (mode === 'timeout') vi.useFakeTimers()
    const f = liveTurn({ pendingPrompt: true })
    try {
      await f.iterator.next()
      const next = f.iterator.next()
      if (mode === 'interrupt') await f.runtime.interrupt(f.session.id)
      else if (mode === 'close') await f.runtime.close()
      else await vi.advanceTimersByTimeAsync(120_001)
      expect((await next).value?.type).toBe(mode === 'interrupt' ? 'cancelled' : 'failed')
      await f.iterator.next()
      expect(f.promptSignals[0].aborted).toBe(true)
      expect(f.cancelled).toHaveBeenCalledTimes(1)
      expect(f.streams[0].locked).toBe(false)
      expect((f.runtime as any).activeSends.size).toBe(0)
    } finally { vi.useRealTimers(); await f.runtime.close(); await f.iterator.return(undefined) }
  })

  it('checks cancellation again after waiting for the prompt at a buffered terminal', async () => {
    const f = liveTurn({ pendingPrompt: true })
    try {
      await f.iterator.next(); f.push(idle('remote-1'))
      const terminal = f.iterator.next()
      await new Promise(resolve => setTimeout(resolve, 0))
      await f.runtime.interrupt(f.session.id)
      expect((await terminal).value).toEqual({ type: 'cancelled', reason: 'user' })
      expect(f.session.messages).toHaveLength(1)
    } finally { await f.runtime.close(); await f.iterator.return(undefined) }
  })

  it('drains a late prompt response before cleanup resolves and cancels its body', async () => {
    let resolvePrompt!: (response: Response) => void
    const cancelled = vi.fn()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/session')) return new Response('{"id":"remote"}')
      if (url.endsWith('/event')) return new Response(frame({ type: 'session.error', properties: { sessionID: 'remote', message: 'fail' } }))
      return await new Promise<Response>(resolve => { resolvePrompt = resolve })
    })
    vi.stubGlobal('fetch', fetchMock)
    const runtime = new OpenCodeRuntime({ endpoint })
    const session = runtime.createSession('model')
    const iterator = runtime.send({ sessionId: session.id, model: session.model, messages: [] })
    await iterator.next()
    expect((await iterator.next()).value).toEqual({ type: 'failed', error: 'fail' })
    let drained = false
    const cleanup = iterator.next().then(result => { drained = true; return result })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(drained).toBe(false)
    resolvePrompt(new Response(new ReadableStream({ cancel: cancelled })))
    expect((await cleanup).done).toBe(true)
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect((runtime as any).activeSends.size).toBe(0)
    await runtime.close()
  })

  it.each(['transport', 'HTTP'] as const)('unblocks a waiting event stream on prompt %s failure', async failure => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ cancel })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/api/session')) return new Response('{"id":"remote"}')
      if (url.endsWith('/event')) return new Response(stream)
      if (failure === 'HTTP') return new Response('failed', { status: 503 })
      throw new Error('prompt transport failed')
    }))
    const runtime = new OpenCodeRuntime({ endpoint })
    const events = await collect(runtime, runtime.createSession('model'))
    expect(terminalEvents(events)).toHaveLength(1)
    expect(events.at(-1)?.type).toBe('failed')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(stream.locked).toBe(false)
  })

  it('cancels an unread HTTP error body without admitting a prompt', async () => {
    const cancel = vi.fn()
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{"id":"remote"}')).mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const runtime = new OpenCodeRuntime({ endpoint })
    expect(await collect(runtime, runtime.createSession('model'))).toEqual([{ type: 'failed', error: 'OpenCode 事件流失败：HTTP 503' }])
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each(['', 'data: {"type":"session.idle","properties":', 'data: [DONE]'])('fails on nonterminal EOF %j', async payload => {
    const { runtime, session } = fixedTurn(payload)
    expect(terminalEvents(await collect(runtime, session))).toEqual([{ type: 'failed', error: 'OpenCode 事件流提前结束：未收到终止事件' }])
  })

  it('decodes split UTF-8 and a final complete SSE tail, releasing the reader', async () => {
    const bytes = new TextEncoder().encode([metadata(), snapshot('a', '猫'), idle()].map(frame).join('').trimEnd())
    let index = 0
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (index < bytes.length) controller.enqueue(bytes.slice(index, ++index)); else controller.close() } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{"id":"remote"}')).mockResolvedValueOnce(new Response(stream)).mockResolvedValueOnce(new Response('{}')))
    const runtime = new OpenCodeRuntime({ endpoint })
    expect(terminalEvents(await collect(runtime, runtime.createSession('model')))).toEqual([{ type: 'completed', text: '猫' }])
    expect(stream.locked).toBe(false)
  })

  it('keeps fork/compaction main-only and feature-gated', async () => {
    const runtime = new OpenCodeRuntime({ endpoint })
    await expect(runtime.forkSession('unknown')).rejects.toThrow('OPENCODE_NATIVE_SESSION_OPERATIONS_DISABLED')
    await expect(runtime.compactSession('unknown')).rejects.toThrow('OPENCODE_NATIVE_SESSION_OPERATIONS_DISABLED')
  })

  it('forks to a new native reference and calls summarize with exact legacy payload, without invented events', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const pathname = new URL(url).pathname
      if (pathname.endsWith('/fork')) return new Response('{"id":"native-child"}')
      if (pathname.endsWith('/summarize')) return new Response('true')
      if (init?.method === 'PATCH') return new Response('{"id":"parent"}')
      throw new Error('Unexpected route')
    })
    vi.stubGlobal('fetch', fetchMock)
    const runtime = new OpenCodeRuntime({ endpoint, remoteSessionId: 'parent', enableNativeSessionOperations: true })
    const parent = runtime.createSession('grimoire/model', [{ role: 'user', content: 'history' }])
    const fork = await runtime.forkSession(parent.id)
    expect(fork.id).not.toBe(parent.id)
    expect(fork.messages).toEqual(parent.messages)
    expect(fork.messages).not.toBe(parent.messages)
    expect(runtime.getSessionReference(fork.id)).toBe('native-child')
    expect(runtime.getSessionReference(parent.id)).toBe('parent')
    await expect(runtime.compactSession(fork.id)).resolves.toBeUndefined()
    const request = fetchMock.mock.calls.find(([url]) => url.endsWith('/summarize'))!
    expect(request[0]).toBe(endpoint + '/session/native-child/summarize')
    expect(JSON.parse(request[1]!.body as string)).toEqual({ providerID: 'grimoire', modelID: 'model', auto: false })
    expect((runtime as any).activeSends.size).toBe(0)
  })

  it.each(['{}', 'false'])('rejects non-success native summarize payload %s', async payload => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => new Response(init?.method === 'PATCH' ? '{}' : payload)))
    const runtime = new OpenCodeRuntime({ endpoint, remoteSessionId: 'parent', enableNativeSessionOperations: true })
    const session = runtime.createSession('grimoire/model')
    await expect(runtime.compactSession(session.id)).rejects.toThrow('未返回原生成功状态')
    expect((runtime as any).activeSends.size).toBe(0)
  })
})
