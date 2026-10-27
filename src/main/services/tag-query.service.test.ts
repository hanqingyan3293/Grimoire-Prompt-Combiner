import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))
import { closeDatabase, getDatabase, initDatabase } from '../database'
import { expandTagDescendants, expandTagRelations, listTagDescendants, searchTagsAdvanced } from './tag-query.service'

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-tag-query-')) })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

async function seed() {
  await initDatabase()
  const db = getDatabase()
  db.run('INSERT INTO categories (id,group_id,en,zh,sort_order) VALUES (?,?,?,?,?)', ['cat', 'default', 'Character', '人物', 1])
  db.run('INSERT INTO subcategories (id,group_id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?,?)', ['sub', 'default', 'cat', 'Face', '脸部', 1])
  const insertTag = (id: string, en: string, zh: string, order: number) => {
    db.run('INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)', [id, 'default', 'sub', en, zh, order, 'builtin'])
    db.run('INSERT INTO tag_metadata (tag_id,namespace,normalized_key,description,color,is_active,source) VALUES (?,?,?,?,?,?,?)', [id, '', en, '', '', 1, 'builtin'])
  }
  insertTag('t_girl', '1girl', '单个女孩', 1)
  insertTag('t_solo', 'solo', '单人', 2)
  insertTag('t_smile', 'smile', '微笑', 3)
  insertTag('t_face', 'face', '脸', 4)
  insertTag('t_x', 'expression', '表情', 5)
  insertTag('t_blocked', 'blocked', '屏蔽', 6)
  db.run("INSERT OR IGNORE INTO tag_aliases (id,tag_id,alias,normalized_alias,language,source,is_builtin) VALUES (?,?,?,?,?,?,?)", ['alias_girl_zh', 't_girl', '少女', '少女', 'zh', 'test', 1])
  const insertRelation = (id: string, source: string, target: string, type: string, enabled = 1) =>
    db.run('INSERT INTO tag_relations (id,source_tag_id,target_tag_id,relation_type,confidence,source,enabled) VALUES (?,?,?,?,?,?,?)', [id, source, target, type, 1, 'test', enabled])
  // Chain girl -> solo -> face -> smile -> x with a cycle edge back to girl;
  // the blocked tag is only reachable through a disabled edge.
  insertRelation('rel_smile_x', 't_smile', 't_x', 'parent')
  insertRelation('rel_girl_solo', 't_girl', 't_solo', 'implication')
  insertRelation('rel_solo_face', 't_solo', 't_face', 'implication')
  insertRelation('rel_face_smile', 't_face', 't_smile', 'implication')
  insertRelation('rel_x_girl', 't_x', 't_girl', 'implication')
  insertRelation('rel_girl_blocked', 't_girl', 't_blocked', 'implication', 0)
  return db
}

describe('tag query service', () => {
  it('searches canonically, by alias and fuzzy without row amplification', async () => {
    const db = await seed()
    const canonical = searchTagsAdvanced(db, { query: '1girl' })
    expect(canonical[0]?.tag.id).toBe('t_girl')
    expect(canonical[0]?.matchedBy).toBe('canonical')
    expect(canonical.filter(result => result.tag.id === 't_girl')).toHaveLength(1)

    const byAlias = searchTagsAdvanced(db, { query: '少女' })
    expect(byAlias[0]?.tag.id).toBe('t_girl')
    expect(byAlias[0]?.matchedBy).toBe('alias')

    const fuzzy = searchTagsAdvanced(db, { query: 'sm' })
    expect(fuzzy.some(result => result.tag.id === 't_smile' && result.matchedBy === 'fuzzy')).toBe(true)
  })

  it('supports prefix mode, namespace filters and usage sorting', async () => {
    const db = await seed()
    expect(searchTagsAdvanced(db, { query: 'ile', mode: 'prefix' })).toHaveLength(0)
    expect(searchTagsAdvanced(db, { query: 'sm', mode: 'prefix' }).map(result => result.tag.id)).toEqual(['t_smile'])

    db.run("UPDATE tag_metadata SET namespace='character' WHERE tag_id='t_girl'")
    const namespaced = searchTagsAdvanced(db, { query: '', namespace: 'character' })
    expect(namespaced.map(result => result.tag.id)).toEqual(['t_girl'])

    db.run('INSERT INTO tag_usage (tag_id,count,last_used) VALUES (?,?,?)', ['t_solo', 5, '2026-01-01T00:00:00.000Z'])
    db.run('INSERT INTO tag_usage (tag_id,count,last_used) VALUES (?,?,?)', ['t_smile', 1, '2026-01-01T00:00:00.000Z'])
    const byUsage = searchTagsAdvanced(db, { query: '', sort: 'usage' })
    expect(byUsage.slice(0, 2).map(result => result.tag.id)).toEqual(['t_solo', 't_smile'])
    expect(byUsage[0]?.usageCount).toBe(5)
  })

  it('expands relations forward with depth caps, cycles and disabled edges handled', async () => {
    const db = await seed()
    const closure = expandTagRelations(db, ['t_girl'])
    const ids = closure.map(entry => entry.tag.id)
    expect(ids).toEqual(expect.arrayContaining(['t_girl', 't_solo', 't_face', 't_smile', 't_x']))
    expect(ids).not.toContain('t_blocked')
    expect(closure.find(entry => entry.tag.id === 't_girl')?.depth).toBe(0)
    expect(closure.find(entry => entry.tag.id === 't_solo')?.depth).toBe(1)

    const capped = expandTagRelations(db, ['t_girl'], { maxDepth: 1 })
    expect(capped.map(entry => entry.tag.id).sort()).toEqual(['t_girl', 't_solo'])
  })

  it('expands descendants in the reverse direction', async () => {
    const db = await seed()
    const descendants = listTagDescendants(db, 't_x')
    expect(descendants.map(entry => entry.tag.id)).toEqual(['t_x', 't_smile', 't_face', 't_solo', 't_girl'])
    const faceDescendants = expandTagDescendants(db, ['t_x', 't_face']).map(entry => entry.tag.id)
    expect(faceDescendants.sort()).toEqual(['t_face', 't_girl', 't_smile', 't_solo', 't_x'].sort())
    expect(listTagDescendants(db, '')).toEqual([])
  })
})