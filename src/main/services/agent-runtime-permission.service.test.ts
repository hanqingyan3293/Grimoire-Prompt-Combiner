import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { RuntimePermissionBroker, runtimePermissionGrantKey } from './agent-runtime-permission.service'

function owner() { return Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn() }) }
const detail = { permission: 'bash', patterns: ['echo ok'], tool: { callID: 'one' } }

describe('main runtime permission scopes', () => {
  it('requires the same sender and consumes a request exactly once', async () => {
    const broker = new RuntimePermissionBroker()
    const sender = owner()
    const promise = broker.request({ sender, sessionId: 's', scope: 'ai:s:config', permission: 'execute', detail, action: 'bash', channel: 'permission', requestId: 'r', native: true })
    expect(broker.decide(owner(), 'r', 'allowOnce')).toBe(false)
    expect(broker.decide(sender, 'r', 'bogus')).toBe(false)
    expect(broker.decide(sender, 'r', 'deny')).toBe(true)
    expect(await promise).toBe('deny')
    expect(broker.decide(sender, 'r', 'allowOnce')).toBe(false)
    expect(sender.listenerCount('destroyed')).toBe(0)
  })

  it('scopes grants by sender, session/config, action and exact resource pattern', async () => {
    const broker = new RuntimePermissionBroker()
    const sender = owner()
    const request = (id: string, scope: string, input = detail, who = sender) => broker.request({ sender: who, sessionId: 's', scope, permission: 'execute', detail: input, action: 'bash', channel: 'permission', requestId: id, native: true, mode: 'automatic' })
    const first = request('one', 'ai:s:config')
    expect(broker.decide(sender, 'one', 'allowForSession')).toBe(true)
    expect(await first).toBe('allowForSession')
    expect(await request('two', 'ai:s:config', { ...detail, tool: { callID: 'two' } })).toBe('allowOnce')
    const changed = request('three', 'ai:other:config')
    expect(broker.decide(sender, 'three', 'deny')).toBe(true)
    expect(await changed).toBe('deny')
    const otherOwner = owner()
    const other = request('four', 'ai:s:config', detail, otherOwner)
    expect(broker.decide(otherOwner, 'four', 'deny')).toBe(true)
    await other
    const changedPattern = request('five', 'ai:s:config', { ...detail, patterns: ['rm something'] })
    expect(broker.decide(sender, 'five', 'deny')).toBe(true)
    await changedPattern
    expect(sender.send).toHaveBeenCalledTimes(3)
  })

  it('clears an idle session grant even when no request is pending', async () => {
    const broker = new RuntimePermissionBroker()
    const sender = owner()
    const scope = 'ai:s:config'
    const first = broker.request({ sender, sessionId: 's', scope, permission: 'execute', detail, action: 'bash', channel: 'permission', requestId: 'first', native: true, mode: 'automatic' })
    expect(broker.decide(sender, 'first', 'allowForSession')).toBe(true)
    expect(await first).toBe('allowForSession')
    broker.clearScope(scope)
    const second = broker.request({ sender, sessionId: 's', scope, permission: 'execute', detail, action: 'bash', channel: 'permission', requestId: 'second', native: true, mode: 'automatic' })
    expect(sender.send).toHaveBeenCalledTimes(2)
    expect(broker.decide(sender, 'second', 'deny')).toBe(true)
    expect(await second).toBe('deny')
    expect(sender.listenerCount('destroyed')).toBe(0)
  })

  it('clears every scope for one session without affecting another session', async () => {
    const broker = new RuntimePermissionBroker()
    const sender = owner()
    const grant = (id: string, scope: string) => broker.request({ sender, sessionId: scope, scope, permission: 'execute', detail, action: 'bash', channel: 'permission', requestId: id, native: true, mode: 'automatic' })
    const first = grant('first', 'ai:s:config-a')
    broker.decide(sender, 'first', 'allowForSession')
    await first
    const other = grant('other', 'ai:other:config-a')
    broker.decide(sender, 'other', 'allowForSession')
    await other
    const pending = grant('pending', 'ai:s:config-b')
    broker.clearScopes('ai:s')
    expect(await pending).toBe('cancel')
    const revoked = grant('revoked', 'ai:s:config-a')
    expect(sender.send).toHaveBeenCalledTimes(4)
    broker.decide(sender, 'revoked', 'deny')
    await revoked
    const retained = grant('retained', 'ai:other:config-a')
    expect(await retained).toBe('allowOnce')
    expect(sender.send).toHaveBeenCalledTimes(4)
    broker.shutdown()
    expect(sender.listenerCount('destroyed')).toBe(0)
  })

  it('does not weaken a native ask under automatic or full mode', async () => {
    for (const mode of ['automatic', 'full']) {
      const broker = new RuntimePermissionBroker()
      const sender = owner()
      const answer = broker.request({ sender, sessionId: 's', scope: 'ai:s', permission: 'read', detail: {}, action: 'unknown.read', native: true, mode, channel: 'permission', requestId: 'r' })
      expect(sender.send).toHaveBeenCalledTimes(1)
      broker.decide(sender, 'r', 'deny')
      expect(await answer).toBe('deny')
    }
  })

  it('cancels on abort and ignores late approval', async () => {
    const broker = new RuntimePermissionBroker()
    const sender = owner()
    const abort = new AbortController()
    const answer = broker.request({ sender, sessionId: 's', scope: 'ai:s', permission: 'execute', detail, native: true, signal: abort.signal, channel: 'permission', requestId: 'r' })
    abort.abort()
    expect(await answer).toBe('cancel')
    expect(broker.decide(sender, 'r', 'allowOnce')).toBe(false)
    expect(sender.listenerCount('destroyed')).toBe(0)
  })

  it('never grants every host tool sharing the same permission kind', () => {
    expect(runtimePermissionGrantKey('write', { tool: 'grimoire.a', input: { id: 1 } }, false)).not.toBe(runtimePermissionGrantKey('write', { tool: 'grimoire.b', input: { id: 1 } }, false))
    expect(runtimePermissionGrantKey('write', {}, false)).toBeUndefined()
  })

  it('downgrades a session decision to allow-once when force-prompt or detail is invalid', async () => {
    const cases = [
      { id: 'forced', detail, forcePrompt: true },
      { id: 'invalid', detail: {}, forcePrompt: false },
    ]
    for (const item of cases) {
      const broker = new RuntimePermissionBroker()
      const sender = owner()
      const answer = broker.request({ sender, sessionId: 's', scope: 'ai:s', permission: 'execute', detail: item.detail, action: 'bash', native: true, forcePrompt: item.forcePrompt, channel: 'permission', requestId: item.id })
      expect(broker.decide(sender, item.id, 'allowForSession')).toBe(true)
      expect(await answer).toBe('allowOnce')
      const second = broker.request({ sender, sessionId: 's', scope: 'ai:s', permission: 'execute', detail: item.detail, action: 'bash', native: true, channel: 'permission', requestId: item.id + '-second' })
      expect(sender.send).toHaveBeenCalledTimes(2)
      expect(broker.decide(sender, item.id + '-second', 'deny')).toBe(true)
      await second
    }
  })

  it('returns the effective decision for persistence without changing the boolean decide API', async () => {
    const broker = new RuntimePermissionBroker()
    const sender = owner()
    const downgraded = broker.request({ sender, sessionId: 's', scope: 'ai:s', permission: 'execute', detail: {}, action: 'bash', native: true, channel: 'permission', requestId: 'invalid' })
    expect(broker.decideWithDecision(sender, 'invalid', 'allowForSession')).toBe('allowOnce')
    expect(await downgraded).toBe('allowOnce')
    expect(broker.decide(sender, 'invalid', 'deny')).toBe(false)

    const granted = broker.request({ sender, sessionId: 's', scope: 'ai:s', permission: 'execute', detail, action: 'bash', native: true, channel: 'permission', requestId: 'exact' })
    expect(broker.decideWithDecision(sender, 'exact', 'allowForSession')).toBe('allowForSession')
    expect(await granted).toBe('allowForSession')
  })
})
