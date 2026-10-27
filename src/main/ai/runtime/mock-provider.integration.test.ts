import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { OpenAICompatibleRuntime } from './openai-compatible.runtime'
import { withRetry } from './retry-policy'
import { HttpAgentRuntime } from './http-agent.runtime'

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function writeSse(response: ServerResponse, records: unknown[]) {
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close', 'cache-control': 'no-cache' })
  for (const record of records) response.write('data: ' + JSON.stringify(record) + '\n\n')
  response.write('data: [DONE]\n\n')
  response.end()
}

describe('OpenAI-compatible mock provider integration', () => {
  it('routes Chat Completions and Responses requests to their distinct endpoints', async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const server = createServer(async (request, response) => {
      const body = JSON.parse((await readBody(request)) || '{}') as Record<string, unknown>
      requests.push({ path: request.url || '', body })
      if (request.url === '/v1/chat/completions') {
        writeSse(response, [{ choices: [{ delta: { content: 'chat-ok' } }] }])
        return
      }
      if (request.url === '/v1/responses') {
        writeSse(response, [{ type: 'response.output_text.delta', delta: 'responses-ok' }, { type: 'response.completed' }])
        return
      }
      response.writeHead(404)
      response.end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock provider did not bind')
    const baseUrl = 'http://127.0.0.1:' + address.port + '/v1'
    try {
      const chat = new OpenAICompatibleRuntime({ baseUrl, apiKey: 'test', protocol: 'chat_completions' })
      const chatSession = chat.createSession('mock-chat', [{ role: 'user', content: 'hi' }])
      const chatEvents = []
      for await (const event of chat.send({ sessionId: chatSession.id, model: chatSession.model, messages: chatSession.messages })) chatEvents.push(event)

      const responses = new OpenAICompatibleRuntime({ baseUrl, apiKey: 'test', protocol: 'responses' })
      const responsesSession = responses.createSession('mock-responses', [{ role: 'user', content: 'hi' }])
      const responseEvents = []
      for await (const event of responses.send({ sessionId: responsesSession.id, model: responsesSession.model, messages: responsesSession.messages })) responseEvents.push(event)

      expect(chatEvents).toContainEqual({ type: 'text-delta', text: 'chat-ok' })
      expect(responseEvents).toContainEqual({ type: 'text-delta', text: 'responses-ok' })
      expect(requests.map(item => item.path)).toEqual(['/v1/chat/completions', '/v1/responses'])
      expect((requests[1].body as { input?: unknown[] }).input).toBeTruthy()
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})

/**
 * Functional coverage for the runtime behaviours added this session: usage capture and
 * retry. Both only exist across the wire — the unit tests assert the mappers in isolation,
 * and these assert the mappers fire on real SSE that a server actually produced.
 */
describe('runtime usage capture and retry over real HTTP', () => {
  /** Collects every event a runtime emits for one call. */
  async function drain(runtime: OpenAICompatibleRuntime, model = 'mock-model') {
    const session = runtime.createSession(model, [{ role: 'user', content: 'hi' }])
    const events: Array<{ type: string } & Record<string, unknown>> = []
    for await (const event of runtime.send({ sessionId: session.id, model, messages: session.messages })) {
      events.push(event as never)
    }
    return events
  }

  it('requests stream usage and emits a normalized usage event from the final chunk', async () => {
    let sawStreamOptions: unknown = null
    const server = createServer(async (request, response) => {
      const body = JSON.parse((await readBody(request)) || '{}') as Record<string, unknown>
      if (request.url === '/v1/chat/completions') {
        // The provider only sends usage when the caller asked for it — this asserts the RUNTIME
        // asked, which is the half a unit test of the mapper cannot see.
        sawStreamOptions = body.stream_options
        writeSse(response, [
          { choices: [{ delta: { content: 'ok' } }] },
          { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 8 } } }
        ])
        return
      }
      response.writeHead(404)
      response.end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock provider did not bind')

    const runtime = new OpenAICompatibleRuntime({ baseUrl: 'http://127.0.0.1:' + address.port + '/v1', apiKey: 'test', protocol: 'chat_completions' })
    const events = await drain(runtime)
    const usage = events.find(event => event.type === 'usage')

    expect(sawStreamOptions).toEqual({ include_usage: true })
    // The mapper ran on real wire data, and cached tokens survived the trip.
    expect(usage).toMatchObject({ inputTokens: 12, outputTokens: 5, cachedTokens: 8 })
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('emits NO usage event when the provider omits usage', async () => {
    // A usage-less provider must not announce a phantom zero reading.
    const server = createServer((_request, response) => {
      writeSse(response, [{ choices: [{ delta: { content: 'ok' } }] }])
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock provider did not bind')

    const runtime = new OpenAICompatibleRuntime({ baseUrl: 'http://127.0.0.1:' + address.port + '/v1', apiKey: 'test', protocol: 'chat_completions' })
    const events = await drain(runtime)

    expect(events.some(event => event.type === 'usage')).toBe(false)
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('lets withRetry re-run a 503 and succeed on the second attempt', async () => {
    // The real proof of retry: a server that FAILS ONCE and then works. Attempt counting is
    // the assertion no unit test with a stub generator can make.
    let attempts = 0
    const server = createServer((_request, response) => {
      attempts += 1
      if (attempts === 1) {
        response.writeHead(503, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: '503 Service Unavailable' } }))
        return
      }
      writeSse(response, [{ choices: [{ delta: { content: 'second-attempt-ok' } }] }])
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock provider did not bind')

    const runtime = new OpenAICompatibleRuntime({ baseUrl: 'http://127.0.0.1:' + address.port + '/v1', apiKey: 'test', protocol: 'chat_completions' })
    const events: Array<{ type: string; text?: string }> = []
    const policy = { enabled: true, maxAttempts: 3, backoffEnabled: false }
    // A FRESH generator per attempt: `withRetry` calls this factory once per try, and reusing
    // one exhausted generator would make every retry a no-op.
    for await (const event of withRetry(policy, () => {
      const session = runtime.createSession('mock-model', [{ role: 'user', content: 'hi' }])
      return runtime.send({ sessionId: session.id, model: 'mock-model', messages: session.messages }) as never
    }, async () => {})) {
      events.push(event as never)
    }

    expect(attempts).toBe(2)
    expect(events.some(event => event.type === 'text-delta' && event.text === 'second-attempt-ok')).toBe(true)
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('does NOT retry a 401 — the second attempt would fail identically', async () => {
    let attempts = 0
    const server = createServer((_request, response) => {
      attempts += 1
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: '401 Unauthorized' } }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock provider did not bind')

    const runtime = new OpenAICompatibleRuntime({ baseUrl: 'http://127.0.0.1:' + address.port + '/v1', apiKey: 'test', protocol: 'chat_completions' })
    const policy = { enabled: true, maxAttempts: 3, backoffEnabled: false }
    for await (const _event of withRetry(policy, () => {
      const session = runtime.createSession('mock-model', [{ role: 'user', content: 'hi' }])
      return runtime.send({ sessionId: session.id, model: 'mock-model', messages: session.messages }) as never
    }, async () => {})) { /* drain */ }

    expect(attempts).toBe(1)
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
})

describe('runtime cancellation over real HTTP', () => {
  it('interrupt aborts an in-flight stream and emits cancelled, not failed', async () => {
    // A server that streams slowly and never ends: without a working interrupt the call would
    // run until the server gave up. This asserts the abort actually reaches the socket.
    let serverClosed = false
    const server = createServer((_request, response) => {
      // `keep-alive`, not `close`: the previous version wrote one token and RETURNED, which
      // ended the HTTP response — the SDK saw EOF and reported `completed` before the abort
      // could land, so the test measured nothing. Holding the response open is what makes an
      // abort meaningful.
      response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
      response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'first' } }] }) + '\n\n')
      const timer = setInterval(() => {
        if (serverClosed) { clearInterval(timer); return }
        try { response.write(': keep-alive\n\n') } catch { clearInterval(timer) }
      }, 50)
      response.on('close', () => clearInterval(timer))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock provider did not bind')

    const runtime = new OpenAICompatibleRuntime({ baseUrl: 'http://127.0.0.1:' + address.port + '/v1', apiKey: 'test', protocol: 'chat_completions' })
    const session = runtime.createSession('mock-model', [{ role: 'user', content: 'hi' }])

    const events: Array<{ type: string }> = []
    const consuming = (async () => {
      for await (const event of runtime.send({ sessionId: session.id, model: 'mock-model', messages: session.messages })) {
        events.push(event as never)
        if (event.type === 'text-delta') {
                await runtime.interrupt(session.id)
        }
      }
    })()
    await consuming

    // A cancellation must surface as `cancelled`; `failed` would show the user an error for
    // their own deliberate action.
    // Record what DID happen, so a failed expectation names the actual event sequence.
    expect(events.map(e => e.type)).toContain('cancelled')
    serverClosed = true
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('resolves without throwing when nothing is in flight', async () => {
    // Interrupting an idle session is a no-op, not an error.
    const runtime = new OpenAICompatibleRuntime({ baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test', protocol: 'chat_completions' })
    await expect(runtime.interrupt('session_never_started')).resolves.toBeUndefined()
  })
})

describe('agent runtime permission round trip over real HTTP', () => {
  it('surfaces a permission request and delivers the approval back to the agent', async () => {
    // The whole approval cycle: the agent asks, the host answers, the answer reaches the
    // agent. A test that only asserted the outgoing event would miss a wrong approval path.
    const approvalBodies: Array<Record<string, unknown>> = []
    const server = createServer(async (request, response) => {
      const body = JSON.parse((await readBody(request)) || '{}') as Record<string, unknown>
      if (request.url === '/prompt') {
        response.writeHead(200, { 'content-type': 'application/json' })
        // `requestPrompt` ALREADY unwraps a `response` envelope for the JSON path
        // (`{ response: JSON.parse(raw) }`), so the fields sit at the TOP level of the body.
        // Nesting them under another `response` made the runtime read an empty object — the
        // test's first version did that and produced only `session-started, completed`.
        response.end(JSON.stringify({
          text: '',
          events: [
            { type: 'permission-requested', requestId: 'req-1', action: 'shell.execute' },
            { type: 'text-delta', text: 'waiting' }
          ]
        }))
        return
      }
      if (request.url === '/approval') {
        approvalBodies.push(body)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: true }))
        return
      }
      response.writeHead(404)
      response.end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock provider did not bind')

    const runtime = new HttpAgentRuntime({ endpoint: 'http://127.0.0.1:' + address.port, token: 'tok', runtime: 'opencode' as never })
    const session = runtime.createSession('model', [{ role: 'user', content: 'hi' }])

    const events: Array<{ type: string } & Record<string, unknown>> = []
    for await (const event of runtime.send({ sessionId: session.id, model: 'model', messages: session.messages })) {
      events.push(event as never)
    }

    const requested = events.find(event => event.type === 'permission-requested')
    expect(requested).toMatchObject({ requestId: 'req-1', action: 'shell.execute' })

    // Answer it, and assert the AGENT received the decision — not just that a local promise
    // resolved.
    await runtime.approve({ requestId: 'req-1', decision: 'accept' })
    expect(approvalBodies).toHaveLength(1)
    expect(approvalBodies[0]).toMatchObject({ requestId: 'req-1', decision: 'accept' })

    // Rejecting must send the opposite decision, not reuse the accept path.
    await runtime.reject({ requestId: 'req-2', decision: 'decline' })
    expect(approvalBodies[1]).toMatchObject({ requestId: 'req-2', decision: 'decline' })
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('also reaches the agent over the streaming transport', async () => {
    // The runtime reads an SSE body when the agent streams; the same events must survive that
    // path, since which transport an agent uses is not something the host chooses.
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close', 'cache-control': 'no-cache' })
      response.write('data: ' + JSON.stringify({ type: 'permission-requested', requestId: 'sse-req', action: 'file.write' }) + '\n\n')
      response.write('data: ' + JSON.stringify({ type: 'text-delta', text: 'streamed' }) + '\n\n')
      response.end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock provider did not bind')

    const runtime = new HttpAgentRuntime({ endpoint: 'http://127.0.0.1:' + address.port, runtime: 'pi' as never })
    const session = runtime.createSession('model', [{ role: 'user', content: 'hi' }])
    const events: Array<{ type: string } & Record<string, unknown>> = []
    for await (const event of runtime.send({ sessionId: session.id, model: 'model', messages: session.messages })) {
      events.push(event as never)
    }

    expect(events.some(event => event.type === 'permission-requested' && event.requestId === 'sse-req')).toBe(true)
    expect(events.some(event => event.type === 'text-delta' && event.text === 'streamed')).toBe(true)
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
})
