import { mockComfyHttpFixture } from './test-support/comfy-http-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComfyUIClient } from './comfy-client'
import type { ComfyResultImage } from '../../shared/types'

const events = vi.hoisted(() => ({ log: vi.fn() }))
vi.mock('./logger.service', () => ({ logEvent: events.log }))
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks() })

const image: ComfyResultImage = { filename: 'r6.png', subfolder: '', type: 'output', url: 'http://127.0.0.1:8188/view?filename=r6.png' }
function barrier<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
function abortError() { return new DOMException('read fixture aborted', 'AbortError') }
function json(payload: unknown) { return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } }) }

// The network fixture has no successful response/release path. Only the
// signal supplied by the production client rejects it (finally is test cleanup).
describe('Comfy execution read signals (C1 R6)', () => {
  it.each(['history', 'queue', 'locate'] as const)('aborts deferred %s with the caller signal as a non-fault', async method => {
    const entered = barrier<AbortSignal>()
    let cleanup!: () => void; let releasing = false
    const fetchFixture = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (releasing) return Promise.reject(abortError())
      return new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!
        cleanup = () => { releasing = true; reject(abortError()) }
        signal.addEventListener('abort', cleanup, { once: true })
        entered.resolve(signal)
      })
    })
    mockComfyHttpFixture(fetchFixture)
    const controller = new AbortController()
    const client = new ComfyUIClient()
    const reading = client[method]('exact-owned-id', { signal: controller.signal }).catch(error => error)
    try {
      const effective = await entered.promise
      controller.abort()
      expect(effective.aborted).toBe(true)
      expect(await reading).toMatchObject({ name: 'AbortError', code: 'COMFY_READ_ABORTED', retryable: false })
      expect(fetchFixture).toHaveBeenCalledTimes(1)
      expect(events.log).not.toHaveBeenCalled()
    } finally { cleanup(); await reading }
  })

  it('forwards the same read signal to reconciliation history after an empty queue', async () => {
    const entered = barrier<AbortSignal>(); const urls: string[] = []
    let cleanup!: () => void
    mockComfyHttpFixture(vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(url))
      if (String(url).endsWith('/queue')) return json({ queue_pending: [], queue_running: [] })
      return new Promise<Response>((_resolve, reject) => {
        cleanup = () => reject(abortError())
        init!.signal!.addEventListener('abort', cleanup, { once: true })
        entered.resolve(init!.signal!)
      })
    }))
    const controller = new AbortController()
    const reading = new ComfyUIClient().locate('requested-only-id', { signal: controller.signal }).catch(error => error)
    try {
      const effective = await entered.promise
      controller.abort()
      expect(effective.aborted).toBe(true)
      expect(await reading).toMatchObject({ code: 'COMFY_READ_ABORTED', retryable: false })
      expect(urls).toEqual(['http://127.0.0.1:8188/queue', 'http://127.0.0.1:8188/history/requested-only-id'])
      expect(events.log).not.toHaveBeenCalled()
    } finally { cleanup(); await reading }
  })

  it('does zero fetch for an already-aborted read without emitting a fault', async () => {
    const controller = new AbortController(); controller.abort()
    const fetchFixture = vi.fn(async () => json({})); mockComfyHttpFixture(fetchFixture)
    await expect(new ComfyUIClient().history('owned', { signal: controller.signal })).rejects.toMatchObject({ code: 'COMFY_READ_ABORTED', retryable: false })
    expect(fetchFixture).not.toHaveBeenCalled()
    expect(events.log).not.toHaveBeenCalled()
  })

  it('keeps a history JSON body cancellable after response headers', async () => {
    const entered = barrier<AbortSignal>(); let body!: ReadableStreamDefaultController<Uint8Array>
    mockComfyHttpFixture(vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({ start(value) { body = value }, pull() { entered.resolve(init!.signal!) } }, { highWaterMark: 0 })
      init!.signal!.addEventListener('abort', () => body.error(abortError()), { once: true })
      return new Response(stream)
    }))
    const controller = new AbortController()
    const reading = new ComfyUIClient().history('owned', { signal: controller.signal }).catch(error => error)
    try {
      const effective = await entered.promise
      controller.abort()
      expect(effective.aborted).toBe(true)
      expect(await reading).toMatchObject({ code: 'COMFY_READ_ABORTED', retryable: false })
      expect(events.log).not.toHaveBeenCalled()
    } finally { body.error(abortError()); await reading }
  })
})

describe('Comfy whole image body lifetime (C1 R6)', () => {
  it('cancels a pending image reader on user abort without classifying it as a download failure', async () => {
    const entered = barrier<void>(); let body!: ReadableStreamDefaultController<Uint8Array>
    let cancelled = false; let effective!: AbortSignal
    mockComfyHttpFixture(vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      effective = init!.signal!
      return new Response(new ReadableStream<Uint8Array>({
        start(value) { body = value },
        pull() { entered.resolve() },
        cancel() { cancelled = true },
      }, { highWaterMark: 0 }))
    }))
    const controller = new AbortController()
    const reading = new ComfyUIClient().downloadImage(image, { signal: controller.signal }).catch(error => error)
    try {
      await entered.promise
      controller.abort()
      expect(effective.aborted).toBe(true)
      expect(cancelled).toBe(true)
      expect(await reading).toMatchObject({ name: 'AbortError', code: 'COMFY_READ_ABORTED', retryable: false })
      expect(events.log).not.toHaveBeenCalled()
    } finally { body.error(abortError()); await reading }
  })

  it('keeps the full body deadline alive until the pending reader settles', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const entered = barrier<void>(); let body!: ReadableStreamDefaultController<Uint8Array>
    let effective!: AbortSignal
    mockComfyHttpFixture(vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      effective = init!.signal!
      return new Response(new ReadableStream<Uint8Array>({ start(value) { body = value }, pull() { entered.resolve() } }, { highWaterMark: 0 }))
    }))
    const reading = new ComfyUIClient().downloadImage(image).catch(error => error)
    try {
      await entered.promise
      expect(vi.getTimerCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(29_999)
      expect(effective.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(effective.aborted).toBe(true)
      expect(await reading).toMatchObject({ code: 'COMFY_TIMEOUT', retryable: true, message: 'ComfyUI 图片下载超时' })
      expect(vi.getTimerCount()).toBe(0)
    } finally { body.error(abortError()); await reading }
  })

  it('catches a body error inside the download lifetime rather than returning an untyped rejected promise', async () => {
    const entered = barrier<void>(); let body!: ReadableStreamDefaultController<Uint8Array>
    mockComfyHttpFixture(vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(value) { body = value }, pull() { entered.resolve() } }, { highWaterMark: 0 }))))
    const reading = new ComfyUIClient().downloadImage(image).catch(error => error)
    await entered.promise
    body.error(new Error('image body fixture'))
    expect(await reading).toMatchObject({ code: 'COMFY_TRANSPORT_ERROR', retryable: true, message: 'image body fixture' })
  })
})
