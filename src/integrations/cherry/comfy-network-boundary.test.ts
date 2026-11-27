import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelComfyExecution } from './comfy-source-adapter'
import http from 'node:http'

const io = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', async original => ({ ...await original<typeof import('node:dns/promises')>(), lookup: io.lookup }))

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); io.lookup.mockReset() })

describe('C2 source cancellation network boundary', () => {
  it('checks DNS before every source cancellation request and never uses ambient fetch', async () => {
    io.lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])
    const fetch = vi.fn(async () => new Response(JSON.stringify({ queue_pending: [[1, 'owned']], queue_running: [] })))
    vi.stubGlobal('fetch', fetch)
    const result = await cancelComfyExecution({ endpoint: 'https://comfy.example', promptId: 'owned' })
    expect(fetch).not.toHaveBeenCalled()
    expect(io.lookup).toHaveBeenCalled()
    expect(result.outcome).not.toBe('remote-confirmed')
    expect(result.writes.every(write => !write.ok)).toBe(true)
  })

  it('preserves a successful void queue write without claiming remote confirmation', async () => {
    const requests: string[] = []
    const server = http.createServer((request, reply) => {
      requests.push(request.method + ' ' + request.url)
      if (request.method === 'POST' && request.url === '/queue') { request.resume(); reply.end(); return }
      reply.setHeader('content-type', 'application/json')
      if (request.url === '/system_stats') reply.end(JSON.stringify({ system: { comfyui_version: '0.3.40' } }))
      else if (request.url === '/queue') reply.end(JSON.stringify({ queue_running: [], queue_pending: [] }))
      else reply.end('{}')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    try {
      const result = await cancelComfyExecution({ endpoint: 'http://127.0.0.1:' + address.port, promptId: 'owned' })
      expect(result.writes).toContainEqual({ path: '/queue', method: 'POST', ok: true, status: 200, promptId: undefined, error: undefined })
      expect(result.outcome).toBe('local-only')
      expect(requests).not.toContain('POST /interrupt')
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })

  it('aborts and awaits the source background queue snapshot before returning', async () => {
    let enter!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    let pending = false
    let release: () => void = () => {}
    const fixture: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/queue') && init?.method !== 'POST') {
        pending = true; enter()
        return new Promise<Response>((_resolve, reject) => {
          release = () => { pending = false; reject(new DOMException('public snapshot fixture aborted', 'AbortError')) }
          init?.signal?.addEventListener('abort', release, { once: true })
        })
      }
      return new Response(JSON.stringify(url.endsWith('/system_stats') ? { system: { comfyui_version: '0.3.40' } } : {}), { headers: { 'content-type': 'application/json' } })
    }
    const cancellation = cancelComfyExecution({ endpoint: 'http://127.0.0.1:8188', promptId: 'owned', fetchImpl: fixture })
    try {
      await entered
      const result = await cancellation
      expect(pending).toBe(false)
      expect(result.outcome).toBe('local-only')
    } finally { release(); await cancellation }
  })
})
