import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))
import { closeDatabase, getDatabase, initDatabase } from '../database'
import { deleteSavedSearch, listSavedSearches, saveSavedSearch } from './saved-search.service'

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-saved-search-')) })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

describe('saved search service', () => {
  it('saves, updates, lists by pin and deletes saved searches', async () => {
    await initDatabase()
    const db = getDatabase()
    const first = saveSavedSearch(db, { name: '今日精选', queryJson: JSON.stringify({ favorite: true }), sortJson: '{}' })
    const second = saveSavedSearch(db, { name: '全部图片', queryJson: '{}', pinned: true })
    expect(first.id).toMatch(/^search_/)

    const listed = listSavedSearches(db)
    expect(listed.map(item => item.name)).toEqual(['全部图片', '今日精选'])

    const updated = saveSavedSearch(db, { id: first.id, name: '今日收藏', queryJson: JSON.stringify({ favorite: true, minRating: 4 }) })
    expect(updated.name).toBe('今日收藏')
    expect(JSON.parse(updated.queryJson).minRating).toBe(4)
    expect(updated.createdAt).toBe(first.createdAt)

    expect(deleteSavedSearch(db, second.id)).toBe(true)
    expect(listSavedSearches(db).map(item => item.name)).toEqual(['今日收藏'])
    expect(deleteSavedSearch(db, 'missing')).toBe(false)
  })

  it('validates name and JSON payloads', async () => {
    await initDatabase()
    const db = getDatabase()
    expect(() => saveSavedSearch(db, { name: '   ' })).toThrow('名称无效')
    expect(() => saveSavedSearch(db, { name: 'x'.repeat(201) })).toThrow('名称无效')
    expect(() => saveSavedSearch(db, { name: 'bad', queryJson: 'not json' })).toThrow('JSON')
    expect(() => saveSavedSearch(db, { name: 'big', queryJson: JSON.stringify({ pad: 'x'.repeat(100_001) }) })).toThrow('过大')
  })
})