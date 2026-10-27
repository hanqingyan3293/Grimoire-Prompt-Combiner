export type ManagedRuntimeResource = {
  isAlive(): boolean
  close(): Promise<void>
}

export type RuntimeResourceLease<T> = {
  readonly id: string
  readonly resource: T
  release(): Promise<void>
}

type Entry<T> = {
  owner: string
  config: string
  generation: number
  controller: AbortController
  pending: Promise<T>
  consumers: Set<number>
  resource?: T
  closing?: Promise<void>
}

/** Main-owned resource accounting. A pending start reserves its owner before any await. */
export class RuntimeLeasePool<T extends ManagedRuntimeResource> {
  private readonly entries = new Map<string, Entry<T>>()
  private generation = 0
  private nextId = 0
  private shutdownPromise?: Promise<void>

  async acquire(owner: string, config: string, start: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<RuntimeResourceLease<T>> {
    signal?.throwIfAborted()
    if (!owner.trim()) throw new Error('RUNTIME_LEASE_OWNER_REQUIRED')
    if (this.shutdownPromise) throw new Error('RUNTIME_LEASE_SHUTTING_DOWN')
    let entry = this.entries.get(owner)
    if (entry?.resource && !entry.resource.isAlive() && !entry.closing) {
      await this.closeEntry(entry)
      return this.acquire(owner, config, start, signal)
    }
    entry = this.entries.get(owner)
    if (entry && entry.config !== config) throw new Error('OPENCODE_OWNER_CONFIG_CONFLICT')
    if (entry?.closing) {
      await entry.closing
      return this.acquire(owner, config, start, signal)
    }
    if (!entry) {
      const controller = new AbortController()
      entry = { owner, config, generation: this.generation, controller, pending: undefined!, consumers: new Set() }
      const target = entry
      this.entries.set(owner, entry)
      entry.pending = Promise.resolve().then(() => start(controller.signal)).then(resource => {
        target.resource = resource
        return resource
      })
      // All waiters and shutdown observe this same rejection; no detached rejection.
      void entry.pending.catch(() => {})
    }
    const id = ++this.nextId
    entry.consumers.add(id)
    const target = entry
    let onAbort: (() => void) | undefined
    const aborted = signal ? new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason || new Error('RUNTIME_LEASE_CANCELLED'))
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    }) : undefined
    try {
      const resource = await (aborted ? Promise.race([entry.pending, aborted]) : entry.pending)
      signal?.throwIfAborted()
      if (target.generation !== this.generation || target.closing || !resource.isAlive()) throw new Error('RUNTIME_LEASE_EXPIRED')
      let releasePromise: Promise<void> | undefined
      const release = () => releasePromise ||= this.release(target, id)
      return Object.freeze({ id: 'runtime-lease-' + id, resource, release })
    } catch (error) {
      await this.release(target, id)
      throw error
    } finally {
      if (onAbort) signal?.removeEventListener('abort', onAbort)
    }
  }

  private async release(entry: Entry<T>, id: number): Promise<void> {
    entry.consumers.delete(id)
    if (!entry.consumers.size) await this.closeEntry(entry)
  }

  private closeEntry(entry: Entry<T>): Promise<void> {
    if (entry.closing) return entry.closing
    entry.controller.abort(new Error('RUNTIME_LEASE_RELEASED'))
    entry.closing = (async () => {
      const resource = await entry.pending.catch(() => undefined)
      if (resource) await resource.close()
      if (this.entries.get(entry.owner) === entry) this.entries.delete(entry.owner)
    })()
    // A failed close retains ownership so it cannot be silently replaced by a new child.
    void entry.closing.catch(() => {})
    return entry.closing
  }

  releaseOwner(owner: string): Promise<void> {
    const entry = this.entries.get(owner)
    if (!entry) return Promise.resolve()
    entry.consumers.clear()
    return this.closeEntry(entry)
  }

  /** Child-process exit invalidates every outstanding lease for that owner. */
  invalidate(owner: string): Promise<void> {
    return this.releaseOwner(owner)
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.generation++
    const entries = [...this.entries.values()]
    for (const entry of entries) entry.consumers.clear()
    const shutdown = Promise.allSettled(entries.map(entry => this.closeEntry(entry))).then(results => {
      const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason)
      if (errors.length) throw new AggregateError(errors, 'RUNTIME_LEASE_CLEANUP_FAILED')
    })
    this.shutdownPromise = shutdown
    void shutdown.finally(() => { if (this.shutdownPromise === shutdown) this.shutdownPromise = undefined }).catch(() => {})
    return shutdown
  }
}
