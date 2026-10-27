import { describe, expect, it, vi } from 'vitest'
import { RuntimeLeasePool } from './agent-runtime-lease.service'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function resource() {
  let alive = true
  return { isAlive: () => alive, close: vi.fn(async () => { alive = false }) }
}

describe('main runtime lease accounting', () => {
  it('reserves a pending owner before admitting another configuration', async () => {
    const pool = new RuntimeLeasePool<ReturnType<typeof resource>>()
    const ready = deferred<ReturnType<typeof resource>>()
    const start = vi.fn(() => ready.promise)
    const first = pool.acquire('ai:s', 'one', start)
    const shared = pool.acquire('ai:s', 'one', start)
    await expect(pool.acquire('ai:s', 'two', start)).rejects.toThrow('OWNER_CONFIG_CONFLICT')
    const native = resource()
    ready.resolve(native)
    const [a, b] = await Promise.all([first, shared])
    expect(start).toHaveBeenCalledTimes(1)
    await a.release()
    expect(native.close).not.toHaveBeenCalled()
    await b.release()
    expect(native.close).toHaveBeenCalledTimes(1)
  })

  it('drains pending startup and rejects a late lease after shutdown', async () => {
    const pool = new RuntimeLeasePool<ReturnType<typeof resource>>()
    const ready = deferred<ReturnType<typeof resource>>()
    const first = pool.acquire('ai:s', 'one', () => ready.promise)
    const failed = expect(first).rejects.toThrow('EXPIRED')
    const shutdown = pool.shutdown()
    await expect(pool.acquire('other', 'one', async () => resource())).rejects.toThrow('SHUTTING_DOWN')
    const native = resource()
    ready.resolve(native)
    await Promise.all([failed, shutdown])
    expect(native.close).toHaveBeenCalledTimes(1)
    const fresh = await pool.acquire('ai:s', 'new', async () => resource())
    await fresh.release()
  })

  it('does not replace a resource until its confirmed close has completed', async () => {
    const pool = new RuntimeLeasePool<ReturnType<typeof resource>>()
    const closed = deferred<void>()
    const native = resource()
    native.close.mockImplementation(() => closed.promise)
    const first = await pool.acquire('ai:s', 'one', async () => native)
    const release = first.release()
    expect(first.release()).toBe(release)
    const nextStart = vi.fn(async () => resource())
    const next = pool.acquire('ai:s', 'one', nextStart)
    await Promise.resolve()
    expect(nextStart).not.toHaveBeenCalled()
    closed.resolve()
    await release
    await (await next).release()
    expect(nextStart).toHaveBeenCalledTimes(1)
  })

  it('keeps a child whose close failed accounted for and reports cleanup failure', async () => {
    const pool = new RuntimeLeasePool<ReturnType<typeof resource>>()
    const native = resource()
    native.close.mockRejectedValue(new Error('kill failed'))
    const first = await pool.acquire('ai:s', 'one', async () => native)
    await expect(first.release()).rejects.toThrow('kill failed')
    await expect(pool.acquire('ai:s', 'one', async () => resource())).rejects.toThrow('kill failed')
    await expect(pool.shutdown()).rejects.toThrow('CLEANUP_FAILED')
  })

  it('releases one cancelled waiter without aborting a shared startup', async () => {
    const pool = new RuntimeLeasePool<ReturnType<typeof resource>>()
    const ready = deferred<ReturnType<typeof resource>>()
    let startupSignal!: AbortSignal
    const start = (signal: AbortSignal) => { startupSignal = signal; return ready.promise }
    const abort = new AbortController()
    const first = pool.acquire('ai:s', 'one', start, abort.signal)
    const second = pool.acquire('ai:s', 'one', start)
    abort.abort(new Error('user cancelled'))
    await expect(first).rejects.toThrow('user cancelled')
    expect(startupSignal.aborted).toBe(false)
    ready.resolve(resource())
    await (await second).release()
  })

  it('closes a destroyed owner without releasing a different owner', async () => {
    const pool = new RuntimeLeasePool<ReturnType<typeof resource>>()
    const first = await pool.acquire('one', 'same', async () => resource())
    const second = await pool.acquire('two', 'same', async () => resource())
    await pool.releaseOwner('one')
    expect(first.resource.isAlive()).toBe(false)
    expect(second.resource.isAlive()).toBe(true)
    await first.release()
    await second.release()
  })
})
