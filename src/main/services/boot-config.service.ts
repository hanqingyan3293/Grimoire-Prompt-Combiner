import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// Boot-time preferences (M3).
//
// A few source preferences only mean something BEFORE Electron is ready
// (`BootConfig.app.disable_hardware_acceleration`). The compat shim stores them in the settings
// table, so they are read straight from SQLite here — `whenReady` is too late for the GPU switch,
// and saying the switch works while never applying it would be a dead control.
export function readBootPreference(databasePath: string, key: string): unknown {
  if (!fs.existsSync(databasePath)) return undefined
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(databasePath, { readOnly: true })
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get('cherry_pref.' + key) as { value?: unknown } | undefined
    if (typeof row?.value !== 'string') return undefined
    try { return JSON.parse(row.value) } catch { return row.value }
  } catch {
    // A locked/corrupt database must never stop the app from starting; the default applies.
    return undefined
  } finally {
    try { db?.close() } catch {}
  }
}

export interface BootConfigResult { readonly disableHardwareAcceleration: boolean; readonly source: 'preference' | 'default' }

/**
 * Resolve boot flags. `apply` is injected so this stays testable without Electron: the caller
 * passes `() => app.disableHardwareAcceleration()`, tests pass a spy.
 */
export function applyBootConfig(options: { databasePath: string; apply?: () => void }): BootConfigResult {
  const value = readBootPreference(options.databasePath, 'BootConfig.app.disable_hardware_acceleration')
  if (value === true) {
    options.apply?.()
    return { disableHardwareAcceleration: true, source: 'preference' }
  }
  return { disableHardwareAcceleration: false, source: value === false ? 'preference' : 'default' }
}

export function defaultDatabasePathFor(userDataDirectory: string): string {
  return path.join(userDataDirectory, 'grimoire.db')
}
