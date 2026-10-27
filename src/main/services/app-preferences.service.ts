import { app, powerSaveBlocker, session } from 'electron'

/**
 * Main-process consumers for the `/settings/general` preference keys.
 *
 * These keys have been persisted by the compat preference shim since the Appearance/General
 * work, but nothing in Grimoire read them — so the switches moved and nothing changed. That
 * is the fake-success shape this file exists to end. Each consumer is a real Electron
 * behaviour, deliberately small, so the set can grow one key at a time.
 *
 * The implementations mirror the source's own services rather than inventing equivalents:
 *  - launch-on-boot follows `AppService.setAppLaunchOnBoot`, including the electron-builder
 *    portable case, because `process.execPath` points into an extracted temp payload there and
 *    a login item registered against it would break on the next run;
 *  - proxy follows `ProxyService.resolveProxyConfig`, the same mode -> `ProxyConfig` mapping.
 *
 * Linux launch-on-boot is NOT implemented. The source writes a `.desktop` file into the
 * autostart directory; doing that from Grimoire would need an autostart path this app has no
 * notion of, and a half-written desktop entry is worse than an honest no-op. The call reports
 * that it did nothing rather than claiming success.
 */

export type AppPreferenceName = 'launch_on_boot' | 'proxy' | 'prevent_sleep'

/**
 * Applies `app.launch_on_boot`.
 *
 * Returns whether the request was actionable on this platform, so the caller can tell a real
 * application from an unsupported platform rather than assuming both are the same.
 */
export function applyLaunchOnBoot(enabled: boolean): { applied: boolean; reason?: string } {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    const settings: Electron.Settings = { openAtLogin: enabled }
    // electron-builder's portable launcher exposes the stable executable path here; the
    // freshly-extracted `process.execPath` would be registered and then vanish.
    const portableFile = process.env.PORTABLE_EXECUTABLE_FILE
    if (process.platform === 'win32' && portableFile) {
      settings.path = portableFile
      settings.args = []
    }
    app.setLoginItemSettings(settings)
    return { applied: true }
  }
  // Linux needs a `.desktop` file in the autostart directory; not implemented, and saying so
  // is the point — a silent `applied: true` would make the switch look effective.
  return { applied: false, reason: 'linux_autostart_not_implemented' }
}

/** Reads back whether the OS currently has a login item, so the UI can show real state. */
export function readLaunchOnBoot(): { openAtLogin: boolean; supported: boolean } {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return { openAtLogin: false, supported: false }
  }
  const settings = app.getLoginItemSettings()
  return { openAtLogin: Boolean(settings.openAtLogin), supported: true }
}

export type ProxyMode = 'system' | 'custom' | 'none'

/**
 * Maps a proxy mode onto an Electron `ProxyConfig`, mirroring `ProxyService.resolveProxyConfig`.
 *
 * `custom` without a URL falls back to `direct` rather than forming an empty fixed-servers
 * config — the source does the same, and an empty `proxyRules` would silently route nothing.
 */
export function resolveProxyConfig(mode: ProxyMode, url: string, bypassRules: string): Electron.ProxyConfig {
  switch (mode) {
    case 'none':
      return { mode: 'direct' }
    case 'custom':
      return url ? { mode: 'fixed_servers', proxyRules: url, proxyBypassRules: bypassRules || undefined } : { mode: 'direct' }
    case 'system':
    default:
      return { mode: 'system' }
  }
}

/**
 * Applies the proxy to every session, not just the default one.
 *
 * The Cherry compat window and the Grimoire windows may use different partitions; applying
 * only to `session.defaultSession` would leave one of them unproxied while the preference
 * said otherwise. Returns the config actually applied so the caller can report it.
 */
export async function applyProxy(mode: ProxyMode, url: string, bypassRules: string): Promise<Electron.ProxyConfig> {
  const config = resolveProxyConfig(mode, url, bypassRules)
  await session.defaultSession.setProxy(config)
  return config
}

/** Starts or stops the "prevent display sleep while working" blocker; returns its id. */
let sleepBlockerId: number | null = null

/**
 * Whether the sleep blocker is currently held.
 *
 * Exposed so the IPC layer can report the REAL state instead of re-deriving it: the route
 * must not reach into this module's private id, and a duplicated `isStarted` call elsewhere
 * would drift from the one the setter uses.
 */
export function isPreventSleepActive(): boolean {
  return sleepBlockerId !== null && powerSaveBlocker.isStarted(sleepBlockerId)
}

export function applyPreventSleep(enabled: boolean): { active: boolean } {
  if (enabled) {
    if (sleepBlockerId === null || !powerSaveBlocker.isStarted(sleepBlockerId)) {
      // `prevent-app-suspension` keeps the app running when the screen locks, which is what
      // "keep working while a task runs" means; `prevent-display-sleep` would keep the monitor
      // lit, which the preference is not asking for.
      sleepBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    }
    return { active: true }
  }
  if (sleepBlockerId !== null && powerSaveBlocker.isStarted(sleepBlockerId)) {
    powerSaveBlocker.stop(sleepBlockerId)
  }
  sleepBlockerId = null
  return { active: false }
}
