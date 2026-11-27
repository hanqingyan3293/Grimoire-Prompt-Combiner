import { EventEmitter } from 'node:events'
import type { ClientRequest, IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import { afterEach, beforeEach, vi } from 'vitest'

type Fixture = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
const io = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('node:http', async original => ({ ...await original<typeof import('node:http')>(), request: io.request }))
vi.mock('node:https', async original => ({ ...await original<typeof import('node:https')>(), request: io.request }))

let fixture: Fixture | undefined
const pending = new Set<() => void>()

/** Test only: exercise the production Node connector with response streams. */
export function mockComfyHttpFixture(next: Fixture): void { fixture = next }

function requestFixture(options: RequestOptions, callback: (response: IncomingMessage) => void): ClientRequest {
  const outgoing = new EventEmitter()
  const incoming = new EventEmitter()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let disposed = false
  const signal = options.signal
  const cleanup = () => { signal?.removeEventListener('abort', dispose); pending.delete(dispose) }
  const dispose = () => {
    if (disposed) return
    disposed = true; cleanup()
    if (reader) void reader.cancel().catch(() => undefined)
    incoming.emit('close')
  }
  pending.add(dispose)
  signal?.addEventListener('abort', dispose, { once: true })
  const response = Object.assign(incoming, { statusCode: 0, headers: {}, resume: vi.fn(), destroy: vi.fn(() => { dispose(); return response }) }) as unknown as IncomingMessage
  const request = Object.assign(outgoing, {
    destroy: vi.fn(() => { dispose(); return request }),
    end(body?: string | Uint8Array) {
      const hostname = String(options.hostname || options.host)
      const host = hostname.includes(':') && !hostname.startsWith('[') ? '[' + hostname + ']' : hostname
      const url = new URL(String(options.protocol || 'http:') + '//' + host + (options.port ? ':' + options.port : '') + String(options.path || '/')).toString()
      const init: RequestInit = { method: options.method, headers: options.headers as HeadersInit, body: typeof body === 'string' ? body : body ? Buffer.from(body).toString('utf8') : undefined, signal }
      void Promise.resolve().then(() => {
        if (!fixture) throw new Error('Comfy HTTP fixture not configured')
        return fixture(url, init)
      }).then(async result => {
        if (disposed) return
        response.statusCode = result.status
        response.headers = Object.fromEntries(result.headers.entries())
        callback(response)
        if (disposed) return
        if (result.body) {
          reader = result.body.getReader()
          while (!disposed) {
            const chunk = await reader.read()
            if (chunk.done) break
            incoming.emit('data', Buffer.from(chunk.value))
          }
        }
        if (!disposed) { incoming.emit('end'); incoming.emit('close') }
      }).catch(error => {
        if (!disposed) outgoing.emit('error', error)
      }).finally(() => { reader?.releaseLock(); cleanup() })
      return request
    },
  }) as unknown as ClientRequest
  return request
}

beforeEach(() => { fixture = undefined; io.request.mockReset(); io.request.mockImplementation(requestFixture) })
afterEach(() => { for (const dispose of [...pending]) dispose(); fixture = undefined })
