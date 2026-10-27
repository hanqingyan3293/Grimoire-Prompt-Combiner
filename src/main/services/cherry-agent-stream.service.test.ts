import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: (name: string) => name === 'exe' ? path.join(root, 'Grimoire.exe') : path.join(root, 'profile') } }))
import { closeDatabase, initDatabase } from '../database'
import { getCherryAgentTurn } from './cherry-agent-turn.service'
import { CherryAgentStreamCoordinator, createCherryAgentRuntimePump } from './cherry-agent-stream.service'

beforeEach(async () => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-agent-stream-')); fs.mkdirSync(path.join(root, 'profile')); await initDatabase() })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })
function expectCode(work: () => unknown, code: string): void { try { work(); throw new Error('expected refusal') } catch (error) { expect(error).toMatchObject({ code }) } }
async function realCoordinator() {
  // The coordinator intentionally accepts a real session input only; create it
  // through the same source-shaped blueprint/read-model services as production.
  const { createAgentBlueprint } = await import('./agent-blueprint.service')
  const { createAgentSessionReadModel } = await import('./agent-session-read-model.service')
  const agent = createAgentBlueprint({ name: 'Agent', type: null, runtime: 'pi', model: 'provider::model' })
  return { coordinator: new CherryAgentStreamCoordinator(), sessionId: createAgentSessionReadModel({ agentId: agent.id, name: '', workspace: { type: 'system' } }).id }
}

describe('main-owned Cherry Agent stream coordinator seam', () => {
  it('refuses runtime pump before any provider/workspace/process access', async () => {
    await expect(createCherryAgentRuntimePump('missing-session', 'do not launch')).rejects.toMatchObject({ status: 503, code: 'AGENT_RUNTIME_UNAVAILABLE' })
  })
  it('aborts a reservation before start without leaving a pending assistant', async () => {
    const { coordinator, sessionId } = await realCoordinator(), lease = coordinator.reserve({ sessionId, content: 'stop before launch' })
    expect(coordinator.abort(lease.leaseId, lease.ownerToken).status).toBe('paused')
    const pump = vi.fn(async () => undefined)
    await expect(coordinator.start(lease.leaseId, lease.ownerToken, pump)).rejects.toMatchObject({ code: 'INVALID_START' })
    expect(pump).not.toHaveBeenCalled()
    expect(getCherryAgentTurn(lease.reservation).status).toBe('paused')
    coordinator.forget(lease.leaseId, lease.ownerToken)
  })
  it('holds admission and forget until an aborted pump drains', async () => {
    const { coordinator, sessionId } = await realCoordinator(), lease = coordinator.reserve({ sessionId, content: 'hello' })
    let release!: () => void
    const run = coordinator.start(lease.leaseId, lease.ownerToken, async () => new Promise<void>(resolve => { release = resolve }))
    coordinator.abort(lease.leaseId, lease.ownerToken)
    expectCode(() => coordinator.reserve({ sessionId, content: 'unsafe overlap' }), 'SESSION_DRAINING')
    expectCode(() => coordinator.forget(lease.leaseId, lease.ownerToken), 'SESSION_DRAINING')
    release(); await run
    coordinator.forget(lease.leaseId, lease.ownerToken)
    const second = coordinator.reserve({ sessionId, content: 'safe after drain' })
    coordinator.abort(second.leaseId, second.ownerToken)
  })
  it('copies reservations, publication input and replay output instead of sharing mutable truth', async () => {
    const { coordinator, sessionId } = await realCoordinator(), lease = coordinator.reserve({ sessionId, content: 'hello' })
    const actualId = lease.reservation.assistantMessageId
    ;(lease.reservation as { assistantMessageId: string }).assistantMessageId = 'corrupted'
    const update = { kind: 'text-delta' as const, text: 'real' }
    await coordinator.start(lease.leaseId, lease.ownerToken, async (_context, sink) => { sink.publish(update); update.text = 'corrupt'; sink.finish('success') })
    const first = coordinator.attach(lease.leaseId, lease.ownerToken)
    expect(first.reservation.assistantMessageId).toBe(actualId)
    expect(first.events[0].update).toEqual({ kind: 'text-delta', text: 'real' })
    ;(first.events[0].update as { text: string }).text = 'external corruption'
    expect(coordinator.attach(lease.leaseId, lease.ownerToken).events[0].update).toEqual({ kind: 'text-delta', text: 'real' })
  })
  it('evicts replay by count and bytes, and explicitly refuses lost-prefix replay', async () => {
    const { coordinator, sessionId } = await realCoordinator(), lease = coordinator.reserve({ sessionId, content: 'hello' })
    await coordinator.start(lease.leaseId, lease.ownerToken, async (_context, sink) => {
      for (let i = 0; i < 260; i++) sink.publish({ kind: 'text-delta', text: 'x'.repeat(2100) })
      sink.finish('success')
    })
    expectCode(() => coordinator.attach(lease.leaseId, lease.ownerToken), 'REPLAY_GAP')
    const replay = coordinator.attach(lease.leaseId, lease.ownerToken, 259)
    expect(replay.status).toBe('success')
    expect(replay.events).toHaveLength(1)
  })
  it('requires an injected pump and never opens a stream from reservation alone', async () => {
    const { coordinator, sessionId } = await realCoordinator(), lease = coordinator.reserve({ sessionId, content: 'hello' })
    await expect(coordinator.start(lease.leaseId, lease.ownerToken, undefined as never)).rejects.toMatchObject({ code: 'PUMP_REQUIRED' })
    expect(coordinator.attach(lease.leaseId, lease.ownerToken).status).toBe('reserved')
    expectCode(() => coordinator.publish(lease.leaseId, lease.ownerToken, { kind: 'text-delta', text: 'no' }), 'STREAM_NOT_RUNNING')
  })
  it('admits one pending turn, rejects concurrent admission, and runs a real injected pump', async () => {
    const { coordinator, sessionId } = await realCoordinator(), lease = coordinator.reserve({ sessionId, content: 'hello' })
    expectCode(() => coordinator.reserve({ sessionId, content: 'second' }), 'TURN_ALREADY_PENDING')
    const terminal = await coordinator.start(lease.leaseId, lease.ownerToken, async (_context, sink) => {
      sink.publish({ kind: 'text-delta', text: 'answer' })
      sink.finish('success')
    })
    expect(terminal.status).toBe('success')
    expect(terminal.events).toEqual([{ ordinal: 1, update: { kind: 'text-delta', text: 'answer' } }])
    expect(getCherryAgentTurn({ ...lease.reservation }).status).toBe('success')
  })
  it('supports bounded attach replay and keeps ordered transitions', async () => {
    const { coordinator, sessionId } = await realCoordinator(), lease = coordinator.reserve({ sessionId, content: 'hello' })
    await coordinator.start(lease.leaseId, lease.ownerToken, async (_context, sink) => {
      sink.publish({ kind: 'text-delta', text: 'a' }); sink.publish({ kind: 'reasoning-delta', text: 'b' }); sink.finish('success')
    })
    expect(coordinator.attach(lease.leaseId, lease.ownerToken, 1).events).toEqual([{ ordinal: 2, update: { kind: 'reasoning-delta', text: 'b' } }])
    expect(coordinator.attach(lease.leaseId, lease.ownerToken, 99).events).toEqual([])
  })
  it('aborts through AbortController, persists paused terminal state, and rejects later publication', async () => {
    const { coordinator, sessionId } = await realCoordinator(), lease = coordinator.reserve({ sessionId, content: 'hello' }), observed: { aborted?: boolean } = {}
    const run = coordinator.start(lease.leaseId, lease.ownerToken, async (context, sink) => { observed.aborted = context.signal.aborted; sink.publish({ kind: 'text-delta', text: 'partial' }); await new Promise<void>(resolve => setTimeout(resolve, 5)); observed.aborted = context.signal.aborted })
    const aborted = coordinator.abort(lease.leaseId, lease.ownerToken)
    expect(aborted.status).toBe('paused'); expect(observed.aborted).toBe(false)
    await run
    expect(observed.aborted).toBe(true)
    expect(getCherryAgentTurn({ ...lease.reservation })).toMatchObject({ status: 'paused', data: { parts: [{ type: 'text', text: 'partial' }] } })
    expectCode(() => coordinator.publish(lease.leaseId, lease.ownerToken, { kind: 'text-delta', text: 'late' }), 'STREAM_NOT_RUNNING')
  })
  it('turns pump failure or missing terminal into generic error without persisting exception secrets', async () => {
    const { coordinator, sessionId } = await realCoordinator(), lease = coordinator.reserve({ sessionId, content: 'hello' })
    const failed = await coordinator.start(lease.leaseId, lease.ownerToken, async (_context, sink) => { sink.publish({ kind: 'text-delta', text: 'partial' }); throw new Error('secret-api-key=do-not-persist') })
    expect(failed.status).toBe('error')
    const message = getCherryAgentTurn({ ...lease.reservation }); expect(message.status).toBe('error'); expect(JSON.stringify(message)).not.toContain('secret-api-key')
    const second = await realCoordinator(), lease2 = second.coordinator.reserve({ sessionId: second.sessionId, content: 'hello' })
    expect((await second.coordinator.start(lease2.leaseId, lease2.ownerToken, async () => undefined)).status).toBe('error')
  })
  it('retains terminal replay until explicit forget, then cleans only memory', async () => {
    const { coordinator, sessionId } = await realCoordinator(), lease = coordinator.reserve({ sessionId, content: 'hello' })
    await coordinator.start(lease.leaseId, lease.ownerToken, async (_context, sink) => sink.finish('success'))
    expect(coordinator.attach(lease.leaseId, lease.ownerToken).status).toBe('success')
    coordinator.forget(lease.leaseId, lease.ownerToken)
    expectCode(() => coordinator.attach(lease.leaseId, lease.ownerToken), 'LEASE_NOT_FOUND')
    expect(getCherryAgentTurn({ ...lease.reservation }).status).toBe('success')
  })
  it('enforces lease ownership and terminal transitions', async () => {
    const { coordinator, sessionId } = await realCoordinator(), lease = coordinator.reserve({ sessionId, content: 'hello' })
    expectCode(() => coordinator.attach(lease.leaseId, 'wrong'), 'LEASE_OWNER_MISMATCH')
    expectCode(() => coordinator.forget(lease.leaseId, lease.ownerToken), 'LEASE_ACTIVE')
    await coordinator.start(lease.leaseId, lease.ownerToken, async (_context, sink) => sink.finish('success'))
    expectCode(() => coordinator.finish(lease.leaseId, lease.ownerToken, 'success'), 'ALREADY_TERMINAL')
  })
})
