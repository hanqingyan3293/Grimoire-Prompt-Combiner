import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
const openExternal = vi.fn(async () => {})
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'exe' ? path.join(testRoot, 'Grimoire.exe') : testRoot) },
  // The mock is typed loosely on purpose: the service only needs `openExternal(url)` to exist.
  shell: { openExternal: (url: string) => (openExternal as unknown as (value: string) => Promise<void>)(url) },
  BrowserWindow: class {},
}))
vi.mock('./browser-host.service', () => ({ openBrowserHost: vi.fn(() => ({ id: 'external-links', url: '' })) }))

import { getDatabase, closeDatabase, initDatabase } from '../database'
import { openBrowserHost } from './browser-host.service'
import { resolveOpenTarget } from './open-link.service'

function setPref(value: boolean) {
  getDatabase().run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=?', ['cherry_pref.app.browser.open_links_in_browser', JSON.stringify(value), JSON.stringify(value)])
}

beforeEach(async () => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-openlink-'))
  await initDatabase()
  openExternal.mockClear()
  ;(openBrowserHost as unknown as { mockClear: () => void }).mockClear()
})
afterEach(() => { closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

describe('link routing preference (M3)', () => {
  it('defaults to the system browser and only goes embedded when the preference says so', () => {
    expect(resolveOpenTarget('https://example.com')).toBe('system')
    setPref(true)
    expect(resolveOpenTarget('https://example.com')).toBe('embedded')
    setPref(false)
    expect(resolveOpenTarget('https://example.com')).toBe('system')
  })

  it('never routes a non-web scheme into the embedded browser', () => {
    setPref(true)
    expect(resolveOpenTarget('file:///etc/passwd')).toBe('system')
    expect(resolveOpenTarget('javascript:alert(1)')).toBe('system')
    expect(resolveOpenTarget('not a url')).toBe('system')
  })
})
