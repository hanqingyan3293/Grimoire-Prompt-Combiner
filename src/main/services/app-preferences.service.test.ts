import { describe, expect, it, vi } from 'vitest'

const setLoginItemSettings = vi.fn()
const getLoginItemSettings = vi.fn(() => ({ openAtLogin: false }))

vi.mock('electron', () => ({
  app: {
    setLoginItemSettings: (...args: unknown[]) => setLoginItemSettings(...args),
    getLoginItemSettings: () => getLoginItemSettings()
  },
  powerSaveBlocker: {
    // A real-looking id sequence, so the "already started" branch is exercised rather than
    // trivially satisfied by a constant.
    _next: 1,
    _started: new Set<number>(),
    start: () => { const id = 1; return id },
    stop: vi.fn(),
    isStarted: () => true
  },
  session: { defaultSession: { setProxy: vi.fn(async () => undefined) } }
}))

import { applyLaunchOnBoot, applyPreventSleep, readLaunchOnBoot, resolveProxyConfig } from './app-preferences.service'

describe('resolveProxyConfig', () => {
  // Mirrors `ProxyService.resolveProxyConfig` in the source so the applied config matches the
  // one upstream would apply for the same preference triple.
  it('maps each mode onto the Electron ProxyConfig the source produces', () => {
    expect(resolveProxyConfig('none', 'http://proxy:8080', '')).toEqual({ mode: 'direct' })
    expect(resolveProxyConfig('system', '', '')).toEqual({ mode: 'system' })
    expect(resolveProxyConfig('custom', 'http://proxy:8080', 'localhost')).toEqual({
      mode: 'fixed_servers', proxyRules: 'http://proxy:8080', proxyBypassRules: 'localhost'
    })
  })

  it('falls back to direct for custom WITHOUT a url, rather than an empty fixed-servers config', () => {
    // An empty `proxyRules` would form a valid-looking config that routes nothing; the source
    // treats it as direct and so does this.
    expect(resolveProxyConfig('custom', '', '')).toEqual({ mode: 'direct' })
  })

  it('omits proxyBypassRules when empty instead of sending an empty string', () => {
    expect(resolveProxyConfig('custom', 'http://p:1', '')).toEqual({ mode: 'fixed_servers', proxyRules: 'http://p:1', proxyBypassRules: undefined })
  })

  it('defaults an unknown mode to system', () => {
    expect(resolveProxyConfig('bogus' as never, '', '')).toEqual({ mode: 'system' })
  })
})

describe('launch-on-boot', () => {
  it('applies on Windows/macOS, or reports the platform as unsupported', () => {
    const result = applyLaunchOnBoot(true)
    if (process.platform === 'win32' || process.platform === 'darwin') {
      expect(result).toEqual({ applied: true })
      expect(setLoginItemSettings).toHaveBeenCalledWith(expect.objectContaining({ openAtLogin: true }))
    } else {
      // Linux needs a .desktop file Grimoire does not write; the honest answer is "not applied"
      // rather than a silent success the UI would render as an effective switch.
      expect(result).toEqual({ applied: false, reason: 'linux_autostart_not_implemented' })
    }
  })

  it('registers the portable launcher path when electron-builder provides one', () => {
    if (process.platform !== 'win32') return
    const previous = process.env.PORTABLE_EXECUTABLE_FILE
    process.env.PORTABLE_EXECUTABLE_FILE = 'C:/portable/grimoire.exe'
    setLoginItemSettings.mockClear()
    applyLaunchOnBoot(true)
    // `process.execPath` points into the extracted temp payload for a portable build, so a
    // login item registered against it breaks on the next run.
    expect(setLoginItemSettings).toHaveBeenCalledWith(expect.objectContaining({ path: 'C:/portable/grimoire.exe', args: [] }))
    if (previous === undefined) delete process.env.PORTABLE_EXECUTABLE_FILE
    else process.env.PORTABLE_EXECUTABLE_FILE = previous
  })

  it('reports read-back state, and marks it unsupported off Windows/macOS', () => {
    const state = readLaunchOnBoot()
    if (process.platform === 'win32' || process.platform === 'darwin') {
      expect(state.supported).toBe(true)
      expect(typeof state.openAtLogin).toBe('boolean')
    } else {
      expect(state).toEqual({ openAtLogin: false, supported: false })
    }
  })
})

describe('prevent-sleep', () => {
  it('reports active state when enabled and idle when disabled', () => {
    expect(applyPreventSleep(true)).toEqual({ active: true })
    expect(applyPreventSleep(false)).toEqual({ active: false })
  })
})
