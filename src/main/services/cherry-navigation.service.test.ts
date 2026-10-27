import { EventEmitter } from 'node:events'
import { IPC_CHANNELS } from '../../shared/types'
import type { BrowserWindow, WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHERRY_NAVIGATION_QUEUE_CAPACITY as CAPACITY,
  CHERRY_NAVIGATION_QUEUE_TTL_MS as TTL,
  getCherryNavigationInitData,
  handleCherryNavigationRequest,
  registerCherryNavigationWindow
} from './cherry-navigation.service'

class MockWebContents extends EventEmitter {
  id = 7
  destroyed = false
  loading = false
  crashed = false
  send = vi.fn()
  isDestroyed() { return this.destroyed }
  isLoadingMainFrame() { return this.loading }
  isCrashed() { return this.crashed }
  navigate(isInPlace = false, isMainFrame = true) {
    this.emit('did-start-navigation', {}, 'file:///cherry/index.html', isInPlace, isMainFrame)
  }
}
class MockWindow extends EventEmitter {
  destroyed = false
  webContents = new MockWebContents()
  isDestroyed() { return this.destroyed }
  close() {
    this.destroyed = true
    this.emit('closed')
  }
}
const ok = { ok: true, data: undefined }
const error = (code: string) => ({ ok: false, error: { code } })
let window: MockWindow
let dispose: () => void
const sender = () => window.webContents as unknown as WebContents
const request = (route: string, input?: unknown, from: WebContents | null = sender()) =>
  handleCherryNavigationRequest(route, input, from)
const ready = (input?: unknown) => request('navigation.protocol_dispatch_ready', input)
const open = (path = '/app/chat') => request('navigation.open_route_in_main', { path })

beforeEach(() => {
  vi.useFakeTimers()
  window = new MockWindow()
  dispose = registerCherryNavigationWindow(window as unknown as BrowserWindow)
})
afterEach(() => {
  dispose()
  vi.useRealTimers()
})

describe('registered Cherry shell navigation adapter', () => {
  it('leaves unowned routes, tab attach and protocol ingress to the coordinator', () => {
    for (const route of ['other', 'navigation.protocol_data', 'tab.attached', 'navigation.focus_or_open_conversation']) {
      expect(request(route, { secret: 'not consumed' }, null)).toBeUndefined()
    }
    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('delivers ready-before-request commands with exact source event and void result', async () => {
    expect(await ready()).toEqual(ok)
    expect(await open('/settings/provider')).toEqual(ok)
    expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith(
      IPC_CHANNELS.CHERRY_NAVIGATION_OPEN_ROUTE, { to: '/settings/provider' }
    )
    expect(getCherryNavigationInitData(sender())).toEqual({ ok: true, data: null })
    expect(await request('navigation.ack_open_route', { requestId: 0 })).toEqual(ok)
    expect(await ready()).toEqual(ok)
    expect(window.webContents.send).toHaveBeenCalledTimes(1)
  })

  it('queues until mount readiness, drains FIFO once and never replays on reload', async () => {
    const first = open('/app/chat')
    const second = open('/settings/appearance')
    expect(first).toBeInstanceOf(Promise)
    const settled = vi.fn()
    void Promise.resolve(first).then(settled)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    expect(window.webContents.send).not.toHaveBeenCalled()
    expect(getCherryNavigationInitData(sender())).toEqual({ ok: true, data: null })
    expect(await ready()).toEqual(ok)
    expect(await first).toEqual(ok)
    expect(await second).toEqual(ok)
    expect(window.webContents.send.mock.calls).toEqual([
      [IPC_CHANNELS.CHERRY_NAVIGATION_OPEN_ROUTE, { to: '/app/chat' }],
      [IPC_CHANNELS.CHERRY_NAVIGATION_OPEN_ROUTE, { to: '/settings/appearance' }]
    ])
    expect(vi.getTimerCount()).toBe(0)
    await ready()
    window.webContents.navigate()
    await ready()
    expect(window.webContents.send).toHaveBeenCalledTimes(2)
  })

  it.each([
    '/app/browser', '/app/release-notes', '/settings/prompts', '/settings/skills/skill-1',
    '/app/mini-app/mini-1', '/app/paintings/a/b', '/settings/mcp/settings/server-1',
    '/settings/scheduled-tasks/task-1', '/settings/mcp/servers'
  ])('admits actual source route %s', async path => {
    await ready()
    expect(await open(path)).toEqual(ok)
    expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.CHERRY_NAVIGATION_OPEN_ROUTE, { to: path })
  })

  it.each([
    'https://evil.invalid/', 'file:///C:/secret', 'cherrystudio://navigate?path=/app/chat',
    '//evil.invalid/app/chat', '/app', '/app/not-a-route', '/settingsX/provider',
    '/settings/mcp/arbitrary', '/agents', '/app/chat/extra', '/app/../chat',
    '/app/paintings/a/../b', '/app/paintings/a//b', '/app/paintings/a\\b',
    '/app/paintings/%2e%2e', '/app/mini-app/%2fsecret', '/settings/skills/x/y',
    '/app/chat#token=secret', '/app/chat?token=secret',
    '/settings/provider?addProviderData=secret',
    '/settings/mcp/servers?protocolInstallRequestId=secret',
    '/settings/mcp/mcp-install?protocolInstall=secret',
    '/app/chat\n', '/app/mini-app/\u0000', '/app/mini-app/a b',
    `/app/mini-app/${'a'.repeat(2048)}`
  ])('refuses unsafe/unregistered path without secret echo or send: %s', async path => {
    await ready()
    const result = await open(path)
    expect(result).toMatchObject(error('NAVIGATION_ROUTE_FORBIDDEN'))
    expect(JSON.stringify(result)).not.toContain(path)
    expect(window.webContents.send).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([null, undefined, [], {}, { path: 12 }, { path: '/app/chat', windowId: 'forged' }])(
    'rejects malformed open input %j', async input => {
      expect(await request('navigation.open_route_in_main', input)).toMatchObject(error('INVALID_INPUT'))
      expect(window.webContents.send).not.toHaveBeenCalled()
    }
  )

  it('requires source void readiness and a valid integer ACK without fake queue acknowledgement', async () => {
    for (const input of [null, {}, false, { windowId: 'forged' }]) {
      expect(await ready(input)).toMatchObject(error('INVALID_INPUT'))
    }
    for (const input of [null, {}, { requestId: -1 }, { requestId: 0.2 }, { requestId: NaN },
      { requestId: Infinity }, { requestId: Number.MAX_SAFE_INTEGER + 1 }, { requestId: '1' },
      { requestId: 1, path: '/app/chat' }]) {
      expect(await request('navigation.ack_open_route', input)).toMatchObject(error('INVALID_INPUT'))
    }
    const pending = open()
    expect(await request('navigation.ack_open_route', { requestId: 1 })).toEqual(ok)
    expect(window.webContents.send).not.toHaveBeenCalled()
    await ready()
    expect(await pending).toEqual(ok)
  })

  it('checks the actual sender object, not a reused id, for every owned operation and init data', async () => {
    const other = new MockWebContents() // deliberately same id
    for (const from of [null, other as unknown as WebContents]) {
      expect(await request('navigation.protocol_dispatch_ready', undefined, from)).toMatchObject(error('NAVIGATION_INVALID_SENDER'))
      expect(await request('navigation.open_route_in_main', { path: '/app/chat' }, from)).toMatchObject(error('NAVIGATION_INVALID_SENDER'))
      expect(await request('navigation.ack_open_route', { requestId: 0 }, from)).toMatchObject(error('NAVIGATION_INVALID_SENDER'))
      expect(getCherryNavigationInitData(from)).toMatchObject(error('NAVIGATION_INVALID_SENDER'))
    }
    const pending = open()
    expect(other.send).not.toHaveBeenCalled()
    expect(window.webContents.send).not.toHaveBeenCalled()
    await ready()
    await pending
    expect(other.send).not.toHaveBeenCalled()
  })

  it('rejects overflow explicitly and delivers exactly the bounded accepted queue', async () => {
    const pending = Array.from({ length: CAPACITY }, () => open())
    expect(await open()).toMatchObject(error('NAVIGATION_QUEUE_FULL'))
    expect(vi.getTimerCount()).toBe(CAPACITY)
    await ready()
    expect(await Promise.all(pending)).toEqual(Array.from({ length: CAPACITY }, () => ok))
    expect(window.webContents.send).toHaveBeenCalledTimes(CAPACITY)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('expires individual callers at TTL, recovers capacity and never sends expired requests', async () => {
    const first = open()
    await vi.advanceTimersByTimeAsync(TTL - 1)
    const second = open('/settings/data')
    await vi.advanceTimersByTimeAsync(1)
    expect(await first).toMatchObject(error('NAVIGATION_QUEUE_EXPIRED'))
    await ready()
    expect(await second).toEqual(ok)
    expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.CHERRY_NAVIGATION_OPEN_ROUTE, { to: '/settings/data' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('checks wall-clock expiry before drain even if timers have not fired', async () => {
    const pending = open()
    vi.setSystemTime(Date.now() + TTL)
    await ready()
    expect(await pending).toMatchObject(error('NAVIGATION_QUEUE_EXPIRED'))
    expect(window.webContents.send).not.toHaveBeenCalled()
    expect(await open()).toEqual(ok)
  })

  it.each(['navigation', 'crash', 'reload-gap'])('invalidates readiness on %s and requires a new ready generation', async kind => {
    await ready()
    await open('/app/chat')
    if (kind === 'navigation') window.webContents.navigate()
    if (kind === 'crash') {
      window.webContents.crashed = true
      window.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    }
    if (kind === 'reload-gap') window.webContents.loading = true
    const pending = open('/settings/provider')
    expect(pending).toBeInstanceOf(Promise)
    expect(window.webContents.send).toHaveBeenCalledTimes(1)
    if (kind !== 'navigation') {
      expect(await ready()).toMatchObject(error('NAVIGATION_RENDERER_NOT_READY'))
    }
    window.webContents.crashed = false
    window.webContents.loading = false
    // Finishing load is not the source mount/listener readiness notification.
    window.webContents.emit('did-finish-load')
    expect(window.webContents.send).toHaveBeenCalledTimes(1)
    await ready()
    expect(await pending).toEqual(ok)
    await ready()
    expect(window.webContents.send).toHaveBeenCalledTimes(2)
  })

  it('does not invalidate readiness on subframe or in-place navigation', async () => {
    await ready()
    window.webContents.navigate(false, false)
    window.webContents.navigate(true, true)
    expect(await open()).toEqual(ok)
  })

  it.each(['closed', 'contents-destroyed', 'silent-destroy', 'dispose'])('cancels queue and removes all listeners on %s', async kind => {
    const pending = open()
    const oldSender = sender()
    if (kind === 'closed') window.close()
    if (kind === 'contents-destroyed') {
      window.webContents.destroyed = true
      window.webContents.emit('destroyed')
    }
    if (kind === 'silent-destroy') {
      window.destroyed = true
      expect(getCherryNavigationInitData(oldSender)).toMatchObject(error('NAVIGATION_INVALID_SENDER'))
    }
    if (kind === 'dispose') dispose()
    expect(await pending).toMatchObject(error('NAVIGATION_WINDOW_CLOSED'))
    for (const event of ['did-start-navigation', 'render-process-gone', 'destroyed']) {
      expect(window.webContents.listenerCount(event)).toBe(0)
    }
    expect(window.listenerCount('closed')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(await ready()).toMatchObject(error('NAVIGATION_INVALID_SENDER'))
    expect(getCherryNavigationInitData(oldSender)).toMatchObject(error('NAVIGATION_INVALID_SENDER'))
    dispose()
  })

  it('registers idempotently, refuses a second live shell, and never retargets an old queue', async () => {
    expect(registerCherryNavigationWindow(window as unknown as BrowserWindow)).toBe(dispose)
    expect(window.webContents.listenerCount('did-start-navigation')).toBe(1)
    const next = new MockWindow()
    expect(() => registerCherryNavigationWindow(next as unknown as BrowserWindow)).toThrow('already registered')
    const oldSender = sender()
    const pending = open()
    window.close()
    expect(await pending).toMatchObject(error('NAVIGATION_WINDOW_CLOSED'))
    window = next
    const newDispose = registerCherryNavigationWindow(next as unknown as BrowserWindow)
    dispose() // old cleanup must not remove new registration
    dispose = newDispose
    expect(await request('navigation.protocol_dispatch_ready', undefined, oldSender)).toMatchObject(error('NAVIGATION_INVALID_SENDER'))
    await ready()
    expect(next.webContents.send).not.toHaveBeenCalled()
    expect(await open()).toEqual(ok)
    expect(next.webContents.send).toHaveBeenCalledTimes(1)
  })

  it('refuses destroyed window registration without adding listeners', () => {
    dispose()
    const dead = new MockWindow()
    dead.webContents.destroyed = true
    expect(() => registerCherryNavigationWindow(dead as unknown as BrowserWindow)).toThrow('destroyed')
    expect(dead.webContents.eventNames()).toEqual([])
  })

  it('returns a redacted delivery error and requires readiness again after a send failure', async () => {
    await ready()
    window.webContents.send.mockImplementationOnce(() => { throw new Error('native secret URL token') })
    expect(await open()).toEqual({
      ok: false, error: { code: 'NAVIGATION_DELIVERY_FAILED', message: 'Cherry navigation event could not be delivered' }
    })
    const pending = open('/settings/data')
    expect(pending).toBeInstanceOf(Promise)
    await ready()
    expect(await pending).toEqual(ok)
  })

  it('settles a failed queued delivery once, retains remaining requests until another ready', async () => {
    const first = open()
    const second = open('/settings/data')
    window.webContents.send.mockImplementationOnce(() => { throw new Error('send failed') })
    await ready()
    expect(await first).toMatchObject(error('NAVIGATION_DELIVERY_FAILED'))
    expect(window.webContents.send).toHaveBeenCalledTimes(1)
    await ready()
    expect(await second).toEqual(ok)
    await ready()
    expect(window.webContents.send).toHaveBeenCalledTimes(2)
  })
})
