import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpAgentRuntime } from './http-agent.runtime'

afterEach(() => vi.unstubAllGlobals())

describe('HTTP agent runtime', () => {
  it('normalizes SSE text and tool events into runtime events', async () => {
    const fetchMock = vi.fn(async () => new Response([
      'data: {"type":"text-delta","text":"hello"}',
      '',
      'data: {"type":"tool-started","callId":"call-1","name":"grimoire.tags.search","input":{"query":"猫"}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)

    const runtime = new HttpAgentRuntime({ endpoint: 'http://127.0.0.1:17371/', runtime: 'codex' })
    const session = runtime.createSession('test', [{ role: 'user', content: 'hi' }])
    const events = []
    for await (const event of runtime.send({ sessionId: session.id, model: 'test', messages: session.messages })) events.push(event)

    expect(events).toEqual(expect.arrayContaining([
      { type: 'session-started', sessionId: session.id },
      { type: 'text-delta', text: 'hello' },
      { type: 'tool-started', callId: 'call-1', name: 'grimoire.tags.search', input: { query: '猫' } },
    ]))
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:17371/prompt', expect.objectContaining({ method: 'POST' }))
  })

  it('rejects non-success responses with the server message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'agent offline' }), { status: 503, headers: { 'content-type': 'application/json' } })))
    const runtime = new HttpAgentRuntime({ endpoint: 'http://127.0.0.1:1', runtime: 'opencode' })
    const session = runtime.createSession('test')
    const iterator = runtime.send({ sessionId: session.id, model: 'test', messages: [] })
    await expect(iterator.next()).rejects.toThrow('agent offline')
  })
})
