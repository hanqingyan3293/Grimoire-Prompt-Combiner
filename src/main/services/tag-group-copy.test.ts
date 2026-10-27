import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))
import { closeDatabase, getDatabase, initDatabase } from '../database'
import { copyTagGroupData, importTagGroupData } from './tag-group-copy'

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-tag-group-copy-')) })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

function seedGroup(db: ReturnType<typeof getDatabase>, groupId: string, tagIds: Array<[string, string]>) {
  db.run('INSERT INTO categories (id,group_id,en,zh,sort_order) VALUES (?,?,?,?,?)', ['cat_' + groupId, groupId, 'Character', '人物', 1])
  db.run('INSERT INTO subcategories (id,group_id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?,?)', ['sub_' + groupId, groupId, 'cat_' + groupId, 'Face', '脸部', 1])
  for (const [tagId, en] of tagIds) {
    db.run('INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)', [tagId, groupId, 'sub_' + groupId, en, en, 1, 'builtin'])
    db.run('INSERT INTO tag_metadata (tag_id,namespace,normalized_key,description,color,is_active,source) VALUES (?,?,?,?,?,?,?)', [tagId, '', en, '', '', 1, 'builtin'])
  }
}

async function seed() {
  await initDatabase()
  const db = getDatabase()
  seedGroup(db, 'default', [['t_a', '1girl'], ['t_b', 'solo']])
  seedGroup(db, 'grp_other', [['t_c', 'other']])
  db.run('INSERT INTO tag_aliases (id,tag_id,alias,normalized_alias,language,source,is_builtin) VALUES (?,?,?,?,?,?,?)', ['alias_a', 't_a', '少女', '少女', 'zh', 'test', 1])
  db.run('INSERT INTO tag_relations (id,source_tag_id,target_tag_id,relation_type,confidence,source,enabled) VALUES (?,?,?,?,?,?,?)', ['rel_ab', 't_a', 't_b', 'implication', 1, 'test', 1])
  db.run('INSERT INTO tag_relations (id,source_tag_id,target_tag_id,relation_type,confidence,source,enabled) VALUES (?,?,?,?,?,?,?)', ['rel_ac', 't_a', 't_c', 'implication', 1, 'test', 1])
  return db
}

describe('tag group copy service', () => {
  it('copies metadata, aliases and relations with a fresh id map', async () => {
    const db = await seed()
    const counts = copyTagGroupData(db, 'default', 'grp_new')
    expect(counts).toEqual({ categories: 1, subcategories: 1, tags: 2, metadata: 2, aliases: 1, relations: 1, relationsSkipped: 1 })

    const newTags = db.exec("SELECT id,en FROM tags WHERE group_id='grp_new'")[0].values
    expect(newTags.map(row => row[1]).sort()).toEqual(['1girl', 'solo'])
    const newTagAId = String(newTags.find(row => row[1] === '1girl')?.[0])
    const alias = db.exec('SELECT tag_id,alias,is_builtin FROM tag_aliases WHERE tag_id=?', [newTagAId])[0].values
    expect(alias).toEqual([[newTagAId, '少女', 1]])
    expect(db.exec('SELECT COUNT(*) FROM tag_metadata WHERE tag_id IN (SELECT id FROM tags WHERE group_id=?)', ['grp_new'])[0].values[0][0]).toBe(2)
    const relation = db.exec("SELECT source_tag_id,target_tag_id FROM tag_relations WHERE id NOT IN ('rel_ab','rel_ac')")[0].values
    expect(relation.length).toBe(1)
    expect(relation[0][0]).toBe(newTagAId)
    expect(String(relation[0][1])).not.toBe('t_c')
  })

  it('imports export payloads with and without the extended arrays', async () => {
    const db = await seed()
    const fullPayload = {
      categories: [{ id: 'old_cat', en: 'Scene', zh: '场景', sort_order: 1 }],
      subcategories: [{ id: 'old_sub', category_id: 'old_cat', en: 'Place', zh: '地点', sort_order: 1 }],
      tags: [
        { id: 'old_t1', subcategory_id: 'old_sub', en: 'beach', zh: '海滩', sort_order: 1, source: 'custom' },
        { id: 'old_t2', subcategory_id: 'old_sub', en: 'ocean', zh: '海洋', sort_order: 2, source: 'custom' },
      ],
      metadata: [{ tag_id: 'old_t1', namespace: 'scene', normalized_key: 'beach', description: '海边', color: '#88ccff', is_active: 1, source: 'custom' }],
      aliases: [{ tag_id: 'old_t2', alias: 'sea', normalized_alias: 'sea', language: 'en', source: 'custom', is_builtin: 0 }],
      relations: [
        { source_tag_id: 'old_t1', target_tag_id: 'old_t2', relation_type: 'related', confidence: 0.5, source: 'custom', enabled: 1 },
        { source_tag_id: 'old_t1', target_tag_id: 'missing', relation_type: 'related', confidence: 1, source: 'custom', enabled: 1 },
      ],
    }
    const counts = importTagGroupData(db, fullPayload, 'grp_import')
    expect(counts).toEqual({ categories: 1, subcategories: 1, tags: 2, metadata: 1, aliases: 1, relations: 1, relationsSkipped: 1 })
    expect(db.exec("SELECT namespace,color FROM tag_metadata WHERE tag_id IN (SELECT id FROM tags WHERE group_id='grp_import' AND en='beach')")[0].values[0]).toEqual(['scene', '#88ccff'])
    expect(db.exec("SELECT relation_type FROM tag_relations WHERE id NOT IN ('rel_ab','rel_ac') AND relation_type='related'")[0].values.length).toBe(1)

    const legacyCounts = importTagGroupData(db, { categories: [{ id: 'c2', en: 'A', zh: '甲' }], subcategories: [], tags: [] }, 'grp_legacy')
    expect(legacyCounts.metadata).toBe(0)
    expect(legacyCounts.aliases).toBe(0)
    expect(legacyCounts.relations).toBe(0)
    expect(legacyCounts.categories).toBe(1)
  })
})