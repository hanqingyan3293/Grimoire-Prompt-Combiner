import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserHostError,
  cleanBrowserUrl,
  closeAllBrowserHosts,
  closeBrowserHost,
  getBrowserHost,
  navigateBrowserHost,
  openBrowserHost,
  updateBrowserHostBounds,
  type BrowserViewLike,
  type BrowserWindowLike,
} from './browser-host.service'

function makeView() {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  const view: BrowserViewLike & { setBounds: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> } = {
    setBounds: vi.fn(),
    destroy: vi.fn(),
    webContents: {
      loadURL: vi.fn(async () => {}),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => { listeners.set(event, listener) }),
      close: vi.fn(),
    },
  }
  return { view, listeners }
}

function makeWindow(): BrowserWindowLike & { added: unknown[] } {
  const added: unknown[] = []
  return {
    added,
    contentView: { addChildView: (view: unknown) => added.push(view), removeChildView: vi.fn() },
    getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    isDestroyed: () => false,
  }
}

beforeEach(() => closeAllBrowserHosts())

describe('browser host (M3)', () => {
  it('creates a view in the grimmoire partition, attaches it and loads the url', () => {
    const window = makeWindow()
    const { view } = makeView()
    const createView = vi.fn(() => view)
    const result = openBrowserHost('panel-1', { window, createView, url: 'example.com', bounds: { x: 10, y: 20, width: 400, height: 300 } })
    expect(result.url).toBe('https://example.com/')
    expect(createView).toHaveBeenCalledWith({ partition: 'persist:grimoire-browser' })
    expect(window.added).toContain(view)
    expect(view.setBounds).toHaveBeenCalledWith({ x: 10, y: 20, width: 400, height: 300 })
    expect(view.webContents.loadURL).toHaveBeenCalledWith('https://example.com/')
  })

  it('reports navigation and title changes so history can be recorded', () => {
    const window = makeWindow()
    const { view, listeners } = makeView()
    const onVisit = vi.fn()
    openBrowserHost('panel-2', { window, createView: () => view, url: 'https://example.com/a', bounds: { x: 0, y: 0, width: 400, height: 300 }, onVisit })
    listeners.get('did-navigate')?.({}, 'https://example.com/b')
    expect(onVisit).toHaveBeenCalledWith({ url: 'https://example.com/b', title: '' })
    listeners.get('page-title-updated')?.({}, '标题')
    expect(onVisit).toHaveBeenLastCalledWith({ url: 'https://example.com/b', title: '标题' })
  })

  it('clamps bounds to the window and refuses a view too small to use', () => {
    const window = makeWindow()
    const { view } = makeView()
    openBrowserHost('panel-3', { window, createView: () => view, url: 'https://example.com', bounds: { x: 0, y: 0, width: 400, height: 300 } })
    // Pushed past the edge: the view is pulled back so a usable rectangle still fits.
    expect(updateBrowserHostBounds('panel-3', { x: 1150, y: 790, width: 500, height: 500 }, window)).toEqual({ x: 1120, y: 740, width: 80, height: 60 })
    expect(() => updateBrowserHostBounds('panel-3', { x: 0, y: 0, width: 20, height: 20 }, window)).toThrow(BrowserHostError)
  })

  it('rejects non-web urls and unknown hosts', () => {
    expect(() => cleanBrowserUrl('file:///etc/passwd')).toThrow(/unsupported protocol/)
    expect(() => cleanBrowserUrl('javascript:alert(1)')).toThrow(/unsupported protocol/)
    expect(() => navigateBrowserHost('missing', 'https://example.com')).toThrow(BrowserHostError)
    expect(getBrowserHost('missing')).toBeNull()
  })

  it('closes a host once and releases the view', () => {
    const window = makeWindow()
    const { view } = makeView()
    openBrowserHost('panel-4', { window, createView: () => view, url: 'https://example.com', bounds: { x: 0, y: 0, width: 400, height: 300 } })
    expect(closeBrowserHost('panel-4', window)).toBe(true)
    expect(closeBrowserHost('panel-4', window)).toBe(false)
    expect(view.destroy).toHaveBeenCalledOnce()
    expect(getBrowserHost('panel-4')).toBeNull()
  })
})
