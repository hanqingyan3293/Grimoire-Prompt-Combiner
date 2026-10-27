import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { admitRuntimeTurn, cancelRuntimeTurn } from './agent-runtime-admission.service'

function owner() { return Object.assign(new EventEmitter(), { isDestroyed: () => false }) }

describe('runtime turn admission', () => {
  it('reserves a session before asynchronous setup and ignores stale release', () => {
    const sender = owner()
    const first = admitRuntimeTurn('ai:one', sender)
    expect(() => admitRuntimeTurn('ai:one', sender)).toThrow('BUSY')
    first.release()
    const next = admitRuntimeTurn('ai:one', sender)
    first.release()
    expect(() => admitRuntimeTurn('ai:one', sender)).toThrow('BUSY')
    next.release()
  })

  it('requires the original sender and cancels the registered runtime once', async () => {
    const sender = owner()
    const admission = admitRuntimeTurn('agent:one', sender)
    const cancel = vi.fn(async () => {})
    admission.setCancel(cancel)
    expect(await cancelRuntimeTurn('agent:one', owner())).toBe(false)
    expect(await cancelRuntimeTurn('agent:one', sender)).toBe(true)
    expect(await cancelRuntimeTurn('agent:one', sender)).toBe(true)
    expect(cancel).toHaveBeenCalledTimes(1)
    admission.release()
  })

  it('cancels pending startup and handles destruction before a runtime is bound', async () => {
    const sender = owner()
    const admission = admitRuntimeTurn('ai:pending', sender)
    sender.emit('destroyed')
    expect(admission.signal.aborted).toBe(true)
    const cancel = vi.fn(async () => {})
    admission.setCancel(cancel)
    await cancelRuntimeTurn('ai:pending', sender)
    expect(cancel).toHaveBeenCalledTimes(1)
    admission.release()
    expect(sender.listenerCount('destroyed')).toBe(0)
  })
})
