import crypto from 'node:crypto'

import {
  appendCherryAgentTurn,
  finalizeCherryAgentTurn,
  reserveCherryAgentTurn,
  type CherryTurnAppendInput,
  type CherryTurnOutcome,
  type CherryTurnReservation,
  type CherryTurnUpdate
} from './cherry-agent-turn.service'

/**
 * Main-owned coordinator seam. This is deliberately not a runtime adapter:
 * an injected pump must perform real runtime work and publish/finish through
 * the supplied sink. No pump means no start, no stream-open success and no
 * fabricated completion. Persistence remains the turn service's SQLite truth;
 * this registry only retains bounded live/replay state.
 */
export type CherryAgentStreamStatus = 'reserved' | 'running' | 'success' | 'error' | 'paused'
export type CherryAgentStreamEvent = { readonly ordinal: number; readonly update: CherryTurnUpdate }
export type CherryAgentStreamSnapshot = {
  readonly leaseId: string
  readonly reservation: CherryTurnReservation
  readonly status: CherryAgentStreamStatus
  readonly events: readonly CherryAgentStreamEvent[]
}
export type CherryAgentStreamPump = (context: {
  readonly sessionId: string
  readonly attemptId: string
  readonly assistantMessageId: string
  readonly signal: AbortSignal
}, sink: {
  publish(update: CherryTurnUpdate): void
  finish(outcome: CherryTurnOutcome, error?: string): void
}) => Promise<void>
export class CherryAgentStreamError extends Error {
  constructor(readonly status: 400 | 404 | 409, readonly code: string) { super(`CHERRY_AGENT_STREAM_${code}`); this.name = 'CherryAgentStreamError' }
}
export const CHERRY_AGENT_STREAM_LIMITS = Object.freeze({ maxLeases: 64, maxReplayEvents: 256, maxReplayBytes: 512 * 1024 })
type Lease = {
  leaseId: string
  reservation: CherryTurnReservation
  ownerToken: string
  status: CherryAgentStreamStatus
  nextOrdinal: number
  events: CherryAgentStreamEvent[]
  replayBytes: number
  controller: AbortController
  started: boolean
  settled: boolean
}
function fail(status: 400 | 404 | 409, code: string): never { throw new CherryAgentStreamError(status, code) }
function token(value: unknown, field: string): asserts value is string { if (typeof value !== 'string' || !value.length) fail(400, `INVALID_${field}`) }
function bytes(event: CherryAgentStreamEvent): number { return Buffer.byteLength(JSON.stringify(event), 'utf8') }
export class CherryAgentStreamCoordinator {
  private readonly leases = new Map<string, Lease>()

  reserve(input: { sessionId: string; content: string }): CherryAgentStreamSnapshot & { ownerToken: string } {
    if (this.leases.size >= CHERRY_AGENT_STREAM_LIMITS.maxLeases) fail(409, 'LEASE_CAPACITY')
    if ([...this.leases.values()].some(lease => lease.reservation.sessionId === input.sessionId && lease.started && !lease.settled)) fail(409, 'SESSION_DRAINING')
    const reservation = reserveCherryAgentTurn(input)
    const lease: Lease = { leaseId: crypto.randomUUID(), reservation, ownerToken: crypto.randomUUID(), status: 'reserved', nextOrdinal: reservation.nextOrdinal, events: [], replayBytes: 0, controller: new AbortController(), started: false, settled: false }
    this.leases.set(lease.leaseId, lease)
    return { ...this.snapshot(lease), ownerToken: lease.ownerToken }
  }

  async start(leaseId: string, ownerToken: string, pump: CherryAgentStreamPump): Promise<CherryAgentStreamSnapshot> {
    const lease = this.authorize(leaseId, ownerToken)
    if (typeof pump !== 'function') fail(400, 'PUMP_REQUIRED')
    if (lease.started || lease.status !== 'reserved') fail(409, 'INVALID_START')
    lease.started = true
    lease.status = 'running'
    try {
      await pump({ sessionId: lease.reservation.sessionId, attemptId: lease.reservation.attemptId, assistantMessageId: lease.reservation.assistantMessageId, signal: lease.controller.signal }, {
        publish: update => this.publish(leaseId, ownerToken, update),
        finish: (outcome, error) => this.finish(leaseId, ownerToken, outcome, error)
      })
      if (lease.status === 'running') {
        // A pump returning without an explicit terminal fact is not success.
        this.finish(leaseId, ownerToken, 'error', 'runtime pump returned without terminal')
      }
    } catch {
      if (lease.status === 'running') this.finish(leaseId, ownerToken, 'error', 'runtime pump failed')
    } finally {
      lease.settled = true
    }
    return this.snapshot(lease)
  }

  publish(leaseId: string, ownerToken: string, update: CherryTurnUpdate): CherryAgentStreamEvent {
    const lease = this.authorize(leaseId, ownerToken)
    if (lease.status !== 'running') fail(409, 'STREAM_NOT_RUNNING')
    const event = { ordinal: lease.nextOrdinal, update: structuredClone(update) }
    const eventBytes = bytes(event)
    if (eventBytes > CHERRY_AGENT_STREAM_LIMITS.maxReplayBytes) fail(409, 'REPLAY_LIMIT_EXCEEDED')
    const result = appendCherryAgentTurn({ ...lease.reservation, expectedOrdinal: lease.nextOrdinal, update: event.update } as CherryTurnAppendInput)
    lease.nextOrdinal = result.nextOrdinal
    lease.events.push(event)
    lease.replayBytes += eventBytes
    while (lease.events.length > CHERRY_AGENT_STREAM_LIMITS.maxReplayEvents || lease.replayBytes > CHERRY_AGENT_STREAM_LIMITS.maxReplayBytes) { const removed = lease.events.shift()!; lease.replayBytes -= bytes(removed) }
    return structuredClone(event)
  }

  finish(leaseId: string, ownerToken: string, outcome: CherryTurnOutcome, error?: string): CherryAgentStreamSnapshot {
    const lease = this.authorize(leaseId, ownerToken)
    if (lease.status !== 'running') fail(409, 'ALREADY_TERMINAL')
    if (outcome === 'paused') lease.controller.abort()
    finalizeCherryAgentTurn({ ...lease.reservation, expectedOrdinal: lease.nextOrdinal, outcome, ...(error === undefined ? {} : { error }) })
    lease.status = outcome
    return this.snapshot(lease)
  }

  abort(leaseId: string, ownerToken: string): CherryAgentStreamSnapshot {
    const lease = this.authorize(leaseId, ownerToken)
    if (lease.status === 'reserved') {
      lease.controller.abort()
      finalizeCherryAgentTurn({ ...lease.reservation, expectedOrdinal: lease.nextOrdinal, outcome: 'paused' })
      lease.status = 'paused'
      lease.settled = true
      return this.snapshot(lease)
    }
    return this.finish(leaseId, ownerToken, 'paused')
  }

  attach(leaseId: string, ownerToken: string, afterOrdinal = 0): CherryAgentStreamSnapshot {
    const lease = this.authorize(leaseId, ownerToken)
    if (!Number.isSafeInteger(afterOrdinal) || afterOrdinal < 0) fail(400, 'INVALID_REPLAY_CURSOR')
    if (lease.events.length && afterOrdinal < lease.events[0].ordinal - 1) fail(409, 'REPLAY_GAP')
    return { ...this.snapshot(lease), events: structuredClone(lease.events.filter(event => event.ordinal > afterOrdinal)) }
  }

  forget(leaseId: string, ownerToken: string): void {
    const lease = this.authorize(leaseId, ownerToken)
    if (lease.status === 'reserved' || lease.status === 'running') fail(409, 'LEASE_ACTIVE')
    if (lease.started && !lease.settled) fail(409, 'SESSION_DRAINING')
    this.leases.delete(leaseId)
  }

  private authorize(leaseId: string, ownerToken: string): Lease {
    token(leaseId, 'LEASE_ID'); token(ownerToken, 'OWNER_TOKEN')
    const lease = this.leases.get(leaseId)
    if (!lease) fail(404, 'LEASE_NOT_FOUND')
    if (lease.ownerToken !== ownerToken) fail(409, 'LEASE_OWNER_MISMATCH')
    return lease
  }

  private snapshot(lease: Lease): CherryAgentStreamSnapshot {
    return { leaseId: lease.leaseId, reservation: structuredClone(lease.reservation), status: lease.status, events: structuredClone(lease.events) }
  }
}

export class CherryAgentRuntimeUnavailableError extends Error {
  readonly status = 503
  readonly code = 'AGENT_RUNTIME_UNAVAILABLE'
  readonly dependency = 'Mapped provider/model injection and native tool policy/approval bridge; source ai.stream transport adapter'
  constructor() { super('Cherry Agent execution unavailable: ' + 'mapped provider/model injection and native tool policy/approval bridge are not proven'); this.name = 'CherryAgentRuntimeUnavailableError' }
}
/** Explicit unavailable boundary: no reservation, workspace IO, network or process launch. */
export async function createCherryAgentRuntimePump(_sessionId: string, _content: string): Promise<CherryAgentStreamPump> {
  throw new CherryAgentRuntimeUnavailableError()
}
