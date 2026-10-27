import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''

vi.mock('electron', () => ({ app: { getPath: (name: string) => (name === 'exe' ? path.join(testRoot, 'Grimoire.exe') : testRoot) } }))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { CHERRY_GENERAL_PREFRENCES, cherryPreferenceWiring, isCherryDeveloperModeEnabled, readCherryPreference } from './cherry-preference-consumers'

beforeEach(async () => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-prefs-'))
  await initDatabase()
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(testRoot, { recursive: true, force: true })
})

describe('Cherry preference wiring registry (M3)', () => {
  it('describes every general-page key exactly once', () => {
    const keys = CHERRY_GENERAL_PREFRENCES.map(item => item.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of ['app.launch_on_boot', 'app.proxy.mode', 'chat.retry.max_attempts', 'app.developer_mode.enabled']) {
      expect(keys).toContain(key)
    }
  })

  it('never claims a key is wired without naming its consumer', () => {
    for (const item of CHERRY_GENERAL_PREFRENCES) expect(item.note.length).toBeGreaterThan(4)
    const report = cherryPreferenceWiring()
    expect(report.total).toBe(CHERRY_GENERAL_PREFRENCES.length)
    expect(report.wired).toBe(CHERRY_GENERAL_PREFRENCES.filter(item => item.wired).length)
    expect(report.wired).toBeGreaterThan(0)
  })

  it('reads JSON-encoded compat preferences and survives raw values', () => {
    expect(readCherryPreference('app.developer_mode.enabled')).toBeUndefined()
    getDatabase().run('INSERT INTO settings (key,value) VALUES (?,?)', ['cherry_pref.app.developer_mode.enabled', 'true'])
    expect(readCherryPreference('app.developer_mode.enabled')).toBe(true)
    getDatabase().run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', ['cherry_pref.app.developer_mode.enabled', 'plain-text'])
    expect(readCherryPreference('app.developer_mode.enabled')).toBe('plain-text')
  })

  it('treats developer mode as enabled until the user turns it off', () => {
    expect(isCherryDeveloperModeEnabled()).toBe(false)
    getDatabase().run('INSERT INTO settings (key,value) VALUES (?,?)', ['cherry_pref.app.developer_mode.enabled', 'true'])
    expect(isCherryDeveloperModeEnabled()).toBe(true)
    getDatabase().run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', ['cherry_pref.app.developer_mode.enabled', 'false'])
    expect(isCherryDeveloperModeEnabled()).toBe(false)
  })
})
