import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, WebContents } from 'electron'

const { fromWebContents } = vi.hoisted(() => ({ fromWebContents: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents } }))

import { handle, handleCherryWindowRequest } from './cherry-window.service'

function webContents(destroyed = false): WebContents {
  return { isDestroyed: vi.fn(() => destroyed) } as unknown as WebContents
}

function browserWindow(destroyed = false) {
  return {
    isDestroyed: vi.fn(() => destroyed),
    isMaximized: vi.fn(() => false),
    setMinimumSize: vi.fn(),
    getSize: vi.fn(() => [1280, 800]),
    setSize: vi.fn()
  }
}

beforeEach(() => fromWebContents.mockReset())

describe('caller-scoped Cherry main window adapter', () => {
  it('leaves unowned routes to the dispatcher without resolving a window', () => {
    expect(handleCherryWindowRequest).toBe(handle)
    expect(handle('window.sub.set_always_on_top', true, webContents())).toBeUndefined()
    expect(fromWebContents).not.toHaveBeenCalled()
  })

  it('reads the actual sender window on each maximize query', () => {
    const sender = webContents()
    const window = browserWindow()
    fromWebContents.mockReturnValue(window)
    expect(handle('window.is_maximized', undefined, sender)).toEqual({ ok: true, data: false })
    window.isMaximized.mockReturnValue(true)
    expect(handle('window.is_maximized', undefined, sender)).toEqual({ ok: true, data: true })
    expect(fromWebContents.mock.calls).toEqual([[sender], [sender]])
    expect(window.isMaximized).toHaveBeenCalledTimes(2)
  })

  it.each(['missing sender', 'destroyed sender', 'unresolved window', 'destroyed window'])('%s cannot mutate native state', kind => {
    const sender = kind === 'missing sender' ? null : webContents(kind === 'destroyed sender')
    const window = browserWindow(kind === 'destroyed window')
    fromWebContents.mockReturnValue(kind === 'unresolved window' ? null : window)
    expect(handle('window.is_maximized', undefined, sender)).toEqual({ ok: true, data: false })
    expect(handle('window.get_init_data', undefined, sender)).toEqual({ ok: true, data: null })
    expect(handle('window.main.set_minimum_size', { width: 520, height: 600 }, sender)).toMatchObject({
      ok: false, error: { code: 'WINDOW_NOT_FOUND' }
    })
    expect(handle('window.main.reset_minimum_size', undefined, sender)).toMatchObject({
      ok: false, error: { code: 'WINDOW_NOT_FOUND' }
    })
    expect(window.setMinimumSize).not.toHaveBeenCalled()
    expect(window.getSize).not.toHaveBeenCalled()
    expect(window.setSize).not.toHaveBeenCalled()
    expect(window.isMaximized).not.toHaveBeenCalled()
    if (kind === 'missing sender' || kind === 'destroyed sender') expect(fromWebContents).not.toHaveBeenCalled()
  })

  it('returns the source cold-main init-data shape, without fabricated identity or navigation', () => {
    const sender = webContents()
    fromWebContents.mockReturnValue(browserWindow())
    // MainWindowInitData is navigation/tab-attach, not a wrapper containing
    // windowType, sessionId or initial tabs. With no supplied command it is null.
    expect(handle('window.get_init_data', undefined, sender)).toEqual({ ok: true, data: null })
    expect(fromWebContents).toHaveBeenCalledWith(sender)
  })

  it.each([
    [{ width: 520, height: 600 }, [520, 600]],
    [{ width: 960, height: 800 }, [960, 800]],
    [{ width: -1, height: 0 }, [520, 600]],
    [{ width: 519.9, height: 599.1 }, [520, 600]],
    [{ width: 700.2, height: 800.8 }, [701, 801]]
  ])('validates/clamps %j and delegates the actual native setter', (input, expected) => {
    const sender = webContents()
    const window = browserWindow()
    fromWebContents.mockReturnValue(window)
    expect(handle('window.main.set_minimum_size', input, sender)).toEqual({ ok: true, data: undefined })
    expect(window.setMinimumSize).toHaveBeenCalledExactlyOnceWith(...expected)
    expect(fromWebContents).toHaveBeenCalledWith(sender)
  })

  it.each([
    null, undefined, [], {}, { width: 520 }, { width: '520', height: 600 },
    { width: NaN, height: 600 }, { width: 520, height: Infinity },
    { width: -Infinity, height: 600 }, { width: 2 ** 31, height: 600 }
  ])('rejects malformed/non-native size %j before invoking Electron', input => {
    expect(handle('window.main.set_minimum_size', input, webContents())).toMatchObject({
      ok: false, error: { code: 'INVALID_INPUT' }
    })
    expect(fromWebContents).not.toHaveBeenCalled()
  })

  it.each(['window.is_maximized', 'window.get_init_data', 'window.main.reset_minimum_size'])('enforces the source void input for %s', route => {
    expect(handle(route, { windowId: 'forged' }, webContents())).toMatchObject({
      ok: false, error: { code: 'INVALID_INPUT' }
    })
    expect(fromWebContents).not.toHaveBeenCalled()
  })

  it('cannot redirect a size mutation through input or to a previous caller', () => {
    const first = browserWindow()
    const second = browserWindow()
    const firstSender = webContents()
    const secondSender = webContents()
    fromWebContents.mockImplementation((sender: WebContents) => sender === firstSender ? first : second)
    handle('window.main.set_minimum_size', { width: 700, height: 800, windowId: 'other' }, firstSender)
    handle('window.main.set_minimum_size', { width: 800, height: 900 }, secondSender)
    expect(first.setMinimumSize).toHaveBeenCalledExactlyOnceWith(700, 800)
    expect(second.setMinimumSize).toHaveBeenCalledExactlyOnceWith(800, 900)
  })

  it('resets to the explicit source 960 x 600 baseline, not Grimoire startup 960 x 640', () => {
    const window = browserWindow()
    const sender = webContents()
    fromWebContents.mockReturnValue(window)
    handle('window.main.set_minimum_size', { width: 520, height: 600 }, sender)
    window.setMinimumSize.mockClear()
    expect(handle('window.main.reset_minimum_size', undefined, sender)).toEqual({ ok: true, data: undefined })
    expect(window.setMinimumSize).toHaveBeenCalledExactlyOnceWith(960, 600)
    expect(window.getSize).toHaveBeenCalledOnce()
    expect(window.setSize).not.toHaveBeenCalled()
  })

  it('resets even without a preceding compact call and grows only an undersized width', () => {
    const window = browserWindow()
    window.getSize.mockReturnValue([520, 777])
    fromWebContents.mockReturnValue(window)
    expect(handle('window.main.reset_minimum_size', undefined, webContents())).toEqual({ ok: true, data: undefined })
    expect(window.setMinimumSize).toHaveBeenCalledExactlyOnceWith(960, 600)
    expect(window.setSize).toHaveBeenCalledExactlyOnceWith(960, 777)
    expect(window.setMinimumSize.mock.invocationCallOrder[0]).toBeLessThan(window.getSize.mock.invocationCallOrder[0])
  })

  it('matches the source width-only growth rule when height alone is below the minimum', () => {
    const window = browserWindow()
    window.getSize.mockReturnValue([960, 500])
    fromWebContents.mockReturnValue(window)
    handle('window.main.reset_minimum_size', undefined, webContents())
    expect(window.setMinimumSize).toHaveBeenCalledExactlyOnceWith(960, 600)
    expect(window.setSize).not.toHaveBeenCalled()
  })

  it('resets only the sender caller and reports failed resize honestly', () => {
    const first = browserWindow()
    const second = browserWindow()
    second.getSize.mockReturnValue([600, 700])
    second.setSize.mockImplementation(() => { throw new Error('resize failed') })
    const firstSender = webContents()
    const secondSender = webContents()
    fromWebContents.mockImplementation((sender: WebContents) => sender === firstSender ? first : second)
    handle('window.main.reset_minimum_size', undefined, firstSender)
    expect(handle('window.main.reset_minimum_size', undefined, secondSender)).toEqual({
      ok: false, error: { code: 'WINDOW_OPERATION_FAILED', message: 'resize failed' }
    })
    expect(first.setMinimumSize).toHaveBeenCalledExactlyOnceWith(960, 600)
    expect(first.setSize).not.toHaveBeenCalled()
    expect(second.setMinimumSize).toHaveBeenCalledExactlyOnceWith(960, 600)
    expect(second.setSize).toHaveBeenCalledExactlyOnceWith(960, 700)
  })

  it('reports native failure rather than returning a successful void result', () => {
    const window = browserWindow()
    window.setMinimumSize.mockImplementation(() => { throw new Error('native setter failed') })
    fromWebContents.mockReturnValue(window as unknown as BrowserWindow)
    expect(handle('window.main.set_minimum_size', { width: 520, height: 600 }, webContents())).toEqual({
      ok: false, error: { code: 'WINDOW_OPERATION_FAILED', message: 'native setter failed' }
    })
  })
})
