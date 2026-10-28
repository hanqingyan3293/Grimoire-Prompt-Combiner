import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyBootConfig, readBootPreference } from './boot-config.service'

let root = ''
function seed(key: string, value: string) {
  const db = new DatabaseSync(path.join(root, 'grimoire.db'))
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(key, value)
  db.close()
}

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-boot-')) })
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('boot preferences (M3)', () => {
  it('applies the GPU switch only when the stored preference is exactly true', () => {
    const apply = vi.fn()
    expect(applyBootConfig({ databasePath: path.join(root, 'grimoire.db'), apply })).toEqual({ disableHardwareAcceleration: false, source: 'default' })
    expect(apply).not.toHaveBeenCalled()
    seed('cherry_pref.BootConfig.app.disable_hardware_acceleration', 'false')
    expect(applyBootConfig({ databasePath: path.join(root, 'grimoire.db'), apply })).toEqual({ disableHardwareAcceleration: false, source: 'preference' })
    expect(apply).not.toHaveBeenCalled()
    seed('cherry_pref.BootConfig.app.disable_hardware_acceleration', 'true')
    expect(applyBootConfig({ databasePath: path.join(root, 'grimoire.db'), apply })).toEqual({ disableHardwareAcceleration: true, source: 'preference' })
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('never blocks startup on a missing or unreadable database', () => {
    expect(readBootPreference(path.join(root, 'missing.db'), 'BootConfig.app.disable_hardware_acceleration')).toBeUndefined()
    fs.writeFileSync(path.join(root, 'grimoire.db'), 'not a database')
    expect(readBootPreference(path.join(root, 'grimoire.db'), 'BootConfig.app.disable_hardware_acceleration')).toBeUndefined()
  })
})
