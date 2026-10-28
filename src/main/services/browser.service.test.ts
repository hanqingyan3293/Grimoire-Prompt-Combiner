import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({ app: { getPath: (name: string) => (name === 'exe' ? path.join(testRoot, 'Grimoire.exe') : testRoot) } }))

import { closeDatabase, initDatabase } from '../database'
import { clearBrowserHistory, deleteBrowserVisit, listBrowserHistory, recordBrowserVisit } from './browser-history.service'
import { clearBrowserData, type ClearableSession } from './browser-data.service'

beforeEach(async () => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-browser-'))
  await initDatabase()
})
afterEach(() => { closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

describe('browser history (M3)', () => {
  it('records visits, de-duplicates the same URL and lists newest first', () => {
    recordBrowserVisit({ url: 'https://example.com/a', title: 'A', visitedAt: '2026-10-27T01:00:00.000Z' })
    recordBrowserVisit({ url: 'https://example.com/b', title: 'B', visitedAt: '2026-10-27T02:00:00.000Z' })
    recordBrowserVisit({ url: 'https://example.com/a', title: 'A2', visitedAt: '2026-10-27T03:00:00.000Z' })
    const visits = listBrowserHistory()
    expect(visits).toHaveLength(2)
    expect(visits[0].url).toBe('https://example.com/a')
    expect(visits[0].title).toBe('A2')
  })

  it('searches by url or title and honours the limit', () => {
    recordBrowserVisit({ url: 'https://example.com/docs', title: '文档', visitedAt: '2026-10-27T01:00:00.000Z' })
    recordBrowserVisit({ url: 'https://other.test/docs', title: 'other', visitedAt: '2026-10-27T02:00:00.000Z' })
    expect(listBrowserHistory({ query: '文档' })).toHaveLength(1)
    expect(listBrowserHistory({ query: 'docs' })).toHaveLength(2)
    expect(listBrowserHistory({ limit: 1 })).toHaveLength(1)
  })

  it('refuses non-web urls instead of storing local paths', () => {
    expect(() => recordBrowserVisit({ url: 'file:///etc/passwd' })).toThrow(/unsupported protocol/)
    expect(() => recordBrowserVisit({ url: 'not a url' })).toThrow(/not a url/)
    expect(listBrowserHistory()).toHaveLength(0)
  })

  it('deletes one visit and clears everything', () => {
    const first = recordBrowserVisit({ url: 'https://example.com/a' })
    recordBrowserVisit({ url: 'https://example.com/b' })
    expect(deleteBrowserVisit(first.id)).toBe(true)
    expect(deleteBrowserVisit(999999)).toBe(false)
    expect(listBrowserHistory()).toHaveLength(1)
    expect(clearBrowserHistory()).toBe(1)
    expect(listBrowserHistory()).toHaveLength(0)
  })
})

describe('browser data clearing (M3)', () => {
  function session(overrides?: Partial<ClearableSession>): ClearableSession {
    return {
      clearCache: vi.fn(async () => {}),
      clearStorageData: vi.fn(async () => {}),
      clearAuthCache: vi.fn(async () => {}),
      ...overrides,
    }
  }

  it('only clears the scopes it was asked for', async () => {
    const target = session()
    const result = await clearBrowserData(target, ['cache'])
    expect(result.cleared).toEqual(['cache'])
    expect(target.clearCache).toHaveBeenCalled()
    expect(target.clearStorageData).not.toHaveBeenCalled()
  })

  it('maps cookies and storage to distinct clearStorageData calls', async () => {
    const target = session()
    await clearBrowserData(target, ['cookies', 'storage'])
    const calls = (target.clearStorageData as unknown as { mock: { calls: Array<[{ storages: string[] }]> } }).mock.calls
    expect(calls[0][0].storages).toEqual(['cookies'])
    expect(calls[1][0].storages).toContain('localstorage')
  })

  it('reports a failing scope instead of pretending it was cleared', async () => {
    const target = session({ clearCache: vi.fn(async () => { throw new Error('disk busy') }) })
    const result = await clearBrowserData(target, ['cache', 'cookies'])
    expect(result.cleared).toEqual(['cookies'])
    expect(result.failed).toEqual([{ scope: 'cache', message: 'disk busy' }])
  })

  it('reports auth clearing as unsupported when the platform has no such API', async () => {
    const target = session({ clearAuthCache: undefined })
    const result = await clearBrowserData(target, ['auth'])
    expect(result.cleared).toEqual([])
    expect(result.failed[0].scope).toBe('auth')
  })
})
