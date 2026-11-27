import { EventEmitter } from 'node:events'
import http, { type IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import type { LookupFunction } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComfyUIClient } from './comfy-client'
import { createComfyHttpFetch } from './comfy-http.transport'

const io = vi.hoisted(() => ({ lookup: vi.fn(), https: vi.fn() }))
vi.mock('node:dns/promises', async original => ({ ...await original<typeof import('node:dns/promises')>(), lookup: io.lookup }))
vi.mock('node:https', async original => ({ ...await original<typeof import('node:https')>(), request: io.https }))

const nativeFetch = globalThis.fetch
const servers: http.Server[] = []
const queue = { queue_running: [], queue_pending: [[1, 'owned']] }
function response(body = JSON.stringify(queue), statusCode = 200, headers: IncomingMessage['headers'] = {}) {
  const incoming = Object.assign(new EventEmitter(), { statusCode, headers, resume: vi.fn(), destroy: vi.fn() })
  const outgoing = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() })
  io.https.mockImplementation((_options: RequestOptions, done: (message: IncomingMessage) => void) => {
    queueMicrotask(() => { done(incoming as unknown as IncomingMessage); incoming.emit('data', Buffer.from(body)); incoming.emit('end') })
    return outgoing
  })
  return { incoming, outgoing }
}
async function fixture(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  return 'http://127.0.0.1:' + address.port
}
function nativeFetchFixture() { const fetch = vi.fn(nativeFetch); vi.stubGlobal('fetch', fetch); return fetch }

beforeEach(() => {
  io.lookup.mockReset(); io.https.mockReset()
  io.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  response()
  // No real public requests: the pre-C2 naked fetch sees a deterministic fixture.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(queue))))
})
afterEach(async () => {
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers()
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

describe('C2 controlled Comfy HTTP/DNS transport', () => {
  it.each([
    [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }],
    [{ address: '93.184.216.34', family: 4 }, { address: 'fd00::1', family: 6 }],
    [{ address: '2001:4860:4860::8888', family: 6 }, { address: '::ffff:169.254.169.254', family: 6 }],
    [{ address: '93.184.216.34', family: 4 }, { address: '64:ff9b::7f00:1', family: 6 }],
    [{ address: '198.18.0.1', family: 4 }],
    [{ address: '2001:2::1', family: 6 }],
  ])('rejects any non-public answer before opening a request: %j', async (...addresses) => {
    io.lookup.mockResolvedValue(addresses)
    await expect(new ComfyUIClient('https://comfy.example').queue()).rejects.toMatchObject({ code: 'COMFY_ADDRESS_INVALID', retryable: false })
    expect(io.https).not.toHaveBeenCalled()
  })

  it('pins the approved IP, preserves Host/SNI/TLS and ignores the ambient fetch/proxy route', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(queue))); vi.stubGlobal('fetch', fetch)
    await expect(new ComfyUIClient('https://comfy.example:8443/prefix').queue('owned')).resolves.toMatchObject({ queued: true })
    expect(fetch).not.toHaveBeenCalled(); expect(io.https).toHaveBeenCalledOnce()
    expect(io.lookup).toHaveBeenCalledWith('comfy.example', { all: true })
    const options = io.https.mock.calls[0][0] as RequestOptions
    expect(options).toMatchObject({ hostname: 'comfy.example', servername: 'comfy.example', port: '8443', path: '/prefix/queue', agent: false, rejectUnauthorized: true })
    expect(options.headers).toMatchObject({ host: 'comfy.example:8443' })
    const callback = vi.fn(); const allCallback = vi.fn()
    options.lookup!('comfy.example', {}, callback)
    options.lookup!('comfy.example', { all: true }, allCallback)
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4)
    expect(allCallback).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }])
    expect(io.lookup).toHaveBeenCalledOnce()
  })

  it('checks localhost DNS rather than granting trust to the hostname label', async () => {
    io.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }, { address: '93.184.216.34', family: 4 }])
    await expect(new ComfyUIClient('http://localhost:8188').queue()).rejects.toMatchObject({ code: 'COMFY_ADDRESS_INVALID', retryable: false })
    expect(io.https).not.toHaveBeenCalled()
  })

  it('uses the original literal IPv6 target without IP-literal SNI', async () => {
    await expect(new ComfyUIClient('https://[2001:4860:4860::8888]').queue('owned')).resolves.toMatchObject({ queued: true })
    expect(io.lookup).not.toHaveBeenCalled()
    const options = io.https.mock.calls[0]?.[0] as RequestOptions
    expect(options?.hostname).toBe('2001:4860:4860::8888'); expect(options?.servername).toBeUndefined()
    expect(options?.headers).toMatchObject({ host: '[2001:4860:4860::8888]' })
  })

  it('does not follow a cross-origin redirect or send the POST to its destination', async () => {
    const { incoming, outgoing } = response('', 307, { location: 'https://other.example/prompt' })
    await expect(new ComfyUIClient('https://comfy.example').submit({})).rejects.toMatchObject({ code: 'COMFY_REDIRECT_INVALID', retryable: false })
    expect(io.https).toHaveBeenCalledOnce(); expect(incoming.destroy).toHaveBeenCalled()
    expect(JSON.parse(String(outgoing.end.mock.calls[0]?.[0]))).toEqual({ prompt: {} })
  })

  it('rechecks DNS on a same-origin redirect and rejects a changed private answer', async () => {
    response('', 302, { location: '/queue-next' })
    io.lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]).mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }])
    await expect(new ComfyUIClient('https://comfy.example').queue()).rejects.toMatchObject({ code: 'COMFY_ADDRESS_INVALID', retryable: false })
    expect(io.https).toHaveBeenCalledOnce(); expect(io.lookup).toHaveBeenCalledTimes(2)
  })

  it('rejects a redirect away from the configured image view route', async () => {
    response('', 302, { location: '/system_stats' })
    const client = new ComfyUIClient('https://comfy.example/prefix')
    await expect(client.downloadImage({ filename: 'a.png', subfolder: '', type: 'output', url: client.baseUrl + '/view?filename=a.png' })).rejects.toMatchObject({ code: 'COMFY_REDIRECT_INVALID', retryable: false })
    expect(io.https).toHaveBeenCalledOnce()
  })

  it('bounds a real JSON stream without trusting a missing content-length header', async () => {
    nativeFetchFixture()
    const base = await fixture((_request, reply) => { reply.writeHead(200, { 'Content-Type': 'application/json' }); reply.end(JSON.stringify({ queue_pending: [], queue_running: [], excess: 'x'.repeat(10 * 1024 * 1024 + 1) })) })
    await expect(new ComfyUIClient(base).queue()).rejects.toMatchObject({ code: 'COMFY_RESPONSE_TOO_LARGE', retryable: false })
  })

  it('keeps malformed successful JSON out of the transient transport retry category', async () => {
    nativeFetchFixture()
    const base = await fixture((_request, reply) => { reply.writeHead(200, { 'Content-Type': 'text/html' }); reply.end('<html>not JSON</html>') })
    await expect(new ComfyUIClient(base).queue()).rejects.toMatchObject({ code: 'COMFY_BAD_RESPONSE', retryable: false })
  })

  it.each([400, 429, 503])('preserves HTTP %i even when the error body is HTML', async status => {
    nativeFetchFixture()
    const base = await fixture((_request, reply) => { reply.writeHead(status, { 'Content-Type': 'text/html' }); reply.end('<html>upstream error</html>') })
    await expect(new ComfyUIClient(base).queue()).rejects.toMatchObject({ code: 'COMFY_HTTP_' + status, retryable: status === 429 || status >= 500, status })
  })

  it.each([400, 429, 503])('preserves image HTTP %i rather than classifying every image error as retryable', async status => {
    nativeFetchFixture()
    const base = await fixture((_request, reply) => { reply.writeHead(status); reply.end('upstream error') })
    await expect(new ComfyUIClient(base).downloadImage({ filename: 'a.png', subfolder: '', type: 'output', url: base + '/view?filename=a.png' })).rejects.toMatchObject({ code: 'COMFY_HTTP_' + status, retryable: status === 429 || status >= 500, status })
  })

  it('uses the real local main-process HTTP connector, not global fetch', async () => {
    const fetch = nativeFetchFixture(); let count = 0
    const base = await fixture((_request, reply) => { count++; reply.end(JSON.stringify(queue)) })
    await expect(new ComfyUIClient(base).queue('owned')).resolves.toMatchObject({ queued: true })
    expect(count).toBe(1); expect(fetch).not.toHaveBeenCalled()
  })

  it('times out DNS itself and removes the owned timer', async () => {
    vi.useFakeTimers()
    io.lookup.mockImplementation(() => new Promise(() => {}))
    const outcome = new ComfyUIClient('https://comfy.example').queue().then(value => ({ value }), error => ({ error }))
    await vi.advanceTimersByTimeAsync(30_001)
    expect(await outcome).toMatchObject({ error: { code: 'COMFY_TIMEOUT', retryable: true } })
    expect(io.https).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels pending DNS and never connects when that late answer arrives', async () => {
    let finish: (value: Array<{ address: string; family: number }>) => void = () => {}
    io.lookup.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const controller = new AbortController()
    const outcome = new ComfyUIClient('https://comfy.example').queue('owned', { signal: controller.signal }).then(value => ({ value }), error => ({ error }))
    await Promise.resolve()
    controller.abort()
    expect(await outcome).toMatchObject({ error: { name: 'AbortError', code: 'COMFY_READ_ABORTED', retryable: false } })
    finish([{ address: '93.184.216.34', family: 4 }])
    await Promise.resolve()
    expect(io.https).not.toHaveBeenCalled()
  })

  it.each([[], [{ address: 'not-an-ip', family: 4 }], [{ address: '93.184.216.34', family: 0 }]])('rejects empty or invalid resolver answers: %j', async (...addresses) => {
    io.lookup.mockResolvedValue(addresses)
    await expect(new ComfyUIClient('https://comfy.example').queue()).rejects.toMatchObject({ code: 'COMFY_ADDRESS_INVALID', retryable: false })
    expect(io.https).not.toHaveBeenCalled()
  })

  it('rejects an oversized declared JSON body without reading it', async () => {
    const { incoming } = response('{}', 200, { 'content-length': String(10 * 1024 * 1024 + 1) })
    await expect(new ComfyUIClient('https://comfy.example').queue()).rejects.toMatchObject({ code: 'COMFY_RESPONSE_TOO_LARGE', retryable: false })
    expect(incoming.destroy).toHaveBeenCalled()
  })

  it('bounds image chunks at 100MiB even without a size header', async () => {
    const incoming = Object.assign(new EventEmitter(), { statusCode: 200, headers: {}, resume: vi.fn(), destroy: vi.fn() })
    const outgoing = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() })
    io.https.mockImplementation((_options: RequestOptions, done: (message: IncomingMessage) => void) => {
      queueMicrotask(() => {
        done(incoming as unknown as IncomingMessage)
        const chunk = Buffer.alloc(1024 * 1024)
        for (let i = 0; i < 101; i++) incoming.emit('data', chunk)
        incoming.emit('end')
      })
      return outgoing
    })
    const client = new ComfyUIClient('https://comfy.example')
    await expect(client.downloadImage({ filename: 'a.png', subfolder: '', type: 'output', url: client.baseUrl + '/view?filename=a.png' })).rejects.toMatchObject({ code: 'COMFY_RESPONSE_TOO_LARGE', retryable: false })
    expect(incoming.destroy).toHaveBeenCalled()
  })

  it('stops after three same-origin redirects', async () => {
    response('', 302, { location: '/queue-next' })
    await expect(new ComfyUIClient('https://comfy.example').queue()).rejects.toMatchObject({ code: 'COMFY_REDIRECT_INVALID', retryable: false })
    expect(io.https).toHaveBeenCalledTimes(4)
    expect(io.lookup).toHaveBeenCalledTimes(4)
  })

  it('follows a valid same-origin redirect after a new complete DNS validation', async () => {
    const { outgoing } = response()
    let calls = 0
    io.https.mockImplementation((_options: RequestOptions, done: (message: IncomingMessage) => void) => {
      const redirected = calls++ === 0
      const incoming = Object.assign(new EventEmitter(), { statusCode: redirected ? 302 : 200, headers: redirected ? { location: '/next' } : {}, resume: vi.fn(), destroy: vi.fn() })
      queueMicrotask(() => { done(incoming as unknown as IncomingMessage); incoming.emit('data', Buffer.from(redirected ? '' : JSON.stringify(queue))); incoming.emit('end') })
      return outgoing
    })
    await expect(new ComfyUIClient('https://comfy.example').queue('owned')).resolves.toMatchObject({ queued: true })
    expect(io.lookup).toHaveBeenCalledTimes(2)
    expect(io.https.mock.calls.map(call => call[0].path)).toEqual(['/queue', '/next'])
  })

  it('retains a valid server error message while keeping the HTTP status code', async () => {
    response(JSON.stringify({ error: 'public fixture busy' }), 503, { 'content-type': 'application/json' })
    await expect(new ComfyUIClient('https://comfy.example').queue()).rejects.toMatchObject({ code: 'COMFY_HTTP_503', status: 503, retryable: true, message: 'public fixture busy' })
  })

  it.each([null, [], {}, { queue_running: 'not-a-list', queue_pending: [] }])('rejects a malformed queue body instead of reporting zero pending jobs: %j', async value => {
    response(JSON.stringify(value))
    await expect(new ComfyUIClient('https://comfy.example').queue()).rejects.toMatchObject({ code: 'COMFY_BAD_RESPONSE', retryable: false })
  })

  it.each([null, []])('rejects a malformed acknowledged submit body with its stable code: %j', async value => {
    response(JSON.stringify(value))
    await expect(new ComfyUIClient('https://comfy.example').submit({})).rejects.toMatchObject({ code: 'COMFY_BAD_RESPONSE', retryable: false })
  })

  it.each(['declared', 'streamed']) ('does not retry an oversized 503 JSON response (%s)', async kind => {
    const maximum = 10 * 1024 * 1024
    response(kind === 'streamed' ? 'x'.repeat(maximum + 1) : '{}', 503, { 'content-type': 'application/json', ...(kind === 'declared' ? { 'content-length': String(maximum + 1) } : {}) })
    await expect(new ComfyUIClient('https://comfy.example').history('owned')).rejects.toMatchObject({ code: 'COMFY_RESPONSE_TOO_LARGE', status: 503, retryable: false })
  })

  it('provides the original source fetch contract for a real binary view response', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const base = await fixture((_request, reply) => { reply.writeHead(200, { 'content-type': 'image/png' }); reply.end(png) })
    const fetch = createComfyHttpFetch(base)
    await expect(fetch(base + '/view?filename=a.png').then(async reply => Buffer.from(await reply.arrayBuffer()))).resolves.toEqual(png)
  })
})
