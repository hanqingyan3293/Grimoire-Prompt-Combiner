import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))
import { closeDatabase, getDatabase, initDatabase } from '../database'
import { createTagAlias, createTagRelation, createTagSuggestions, listAssetTagLinks, listTagSuggestions, resolveTagSuggestion, searchTags } from './tag-intelligence.service'

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-tag-intelligence-')) })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

describe('tag intelligence service', () => {
  it('migrates canonical aliases and searches by alias', async () => {
    await initDatabase()
    const db = getDatabase()
    db.run('INSERT INTO categories (id,group_id,en,zh,sort_order) VALUES (?,?,?,?,?)', ['cat', 'default', 'Character', '人物', 1])
    db.run('INSERT INTO subcategories (id,group_id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?,?)', ['sub', 'default', 'cat', 'Face', '脸部', 1])
    db.run('INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)', ['tag_1', 'default', 'sub', '1girl', '单个女孩', 1, 'builtin'])
    db.run("INSERT OR IGNORE INTO tag_aliases (id,tag_id,alias,normalized_alias,language,source,is_builtin) VALUES (?,?,?,?,?,?,?)", ['alias_test', 'tag_1', '少女', '少女', 'zh', 'test', 1])
    const results = searchTags(db, '少女')
    expect(results[0]?.tag.id).toBe('tag_1')
    expect(results[0]?.matchedBy).toBe('alias')
  })

  it('creates relations, suggestions and accepted asset links', async () => {
    await initDatabase()
    const db = getDatabase()
    db.run('INSERT INTO categories (id,group_id,en,zh,sort_order) VALUES (?,?,?,?,?)', ['cat', 'default', 'Character', '人物', 1])
    db.run('INSERT INTO subcategories (id,group_id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?,?)', ['sub', 'default', 'cat', 'Face', '脸部', 1])
    db.run('INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)', ['tag_1', 'default', 'sub', '1girl', '单个女孩', 1, 'builtin'])
    db.run('INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)', ['tag_2', 'default', 'sub', 'solo', '单人', 2, 'builtin'])
    expect(createTagAlias(db, { tagId: 'tag_1', alias: 'girl one' }).tagId).toBe('tag_1')
    expect(createTagRelation(db, { sourceTagId: 'tag_1', targetTagId: 'tag_2', relationType: 'implication' }).targetTagId).toBe('tag_2')
    const suggestions = createTagSuggestions(db, { assetType: 'image', assetKey: 'image:1', source: 'wd14', values: [{ value: '1girl', confidence: 0.98 }] })
    expect(listTagSuggestions(db, { status: 'pending' })).toHaveLength(1)
    resolveTagSuggestion(db, { id: suggestions[0].id, action: 'accept' })
    expect(listAssetTagLinks(db, 'image', 'image:1')).toMatchObject([{ tagId: 'tag_1', source: 'wd14', status: 'accepted' }])
  })
})
