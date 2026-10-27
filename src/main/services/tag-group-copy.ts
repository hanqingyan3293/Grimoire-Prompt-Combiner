// 魔导书 Grimoire v7 — 标签组复制/导入服务
// Copies the full tag intelligence surface (categories, subcategories, tags,
// metadata, aliases, relations) into a target group with fresh scoped ids.
// Relations whose endpoints are not both inside the source scope are skipped
// and counted so callers can surface the loss.
import crypto from 'crypto'
import type { LegacyDatabase } from './sqlite.compat'

export interface TagGroupCopyCounts {
  categories: number
  subcategories: number
  tags: number
  metadata: number
  aliases: number
  relations: number
  relationsSkipped: number
}

const genScopedId = (prefix: string) => prefix + crypto.randomUUID().slice(0, 8)

function emptyCounts(): TagGroupCopyCounts {
  return { categories: 0, subcategories: 0, tags: 0, metadata: 0, aliases: 0, relations: 0, relationsSkipped: 0 }
}

function copyRelations(
  db: LegacyDatabase,
  rows: unknown[][],
  tagIdMap: Map<string, string>,
  counts: TagGroupCopyCounts,
): void {
  for (const row of rows) {
    const newSource = tagIdMap.get(String(row[0]))
    const newTarget = tagIdMap.get(String(row[1]))
    if (!newSource || !newTarget) {
      counts.relationsSkipped++
      continue
    }
    db.run(
      'INSERT INTO tag_relations (id,source_tag_id,target_tag_id,relation_type,confidence,source,enabled) VALUES (?,?,?,?,?,?,?)',
      [genScopedId('rel_'), newSource, newTarget, row[2], row[3], row[4], row[5]],
    )
    counts.relations++
  }
}

function insertMetadataAliases(
  db: LegacyDatabase,
  metadata: unknown[][],
  aliases: unknown[][],
  tagIdMap: Map<string, string>,
  counts: TagGroupCopyCounts,
): void {
  for (const row of metadata) {
    const newTagId = tagIdMap.get(String(row[0]))
    if (!newTagId) continue
    db.run(
      'INSERT INTO tag_metadata (tag_id,namespace,normalized_key,description,color,is_active,source) VALUES (?,?,?,?,?,?,?)',
      [newTagId, row[1], row[2], row[3], row[4], row[5], row[6]],
    )
    counts.metadata++
  }
  for (const row of aliases) {
    const newTagId = tagIdMap.get(String(row[0]))
    if (!newTagId) continue
    db.run(
      'INSERT INTO tag_aliases (id,tag_id,alias,normalized_alias,language,source,is_builtin) VALUES (?,?,?,?,?,?,?)',
      [genScopedId('alias_'), newTagId, row[1], row[2], row[3], row[4], row[5]],
    )
    counts.aliases++
  }
}

export function copyTagGroupData(db: LegacyDatabase, fromGroupId: string, toGroupId: string): TagGroupCopyCounts {
  const counts = emptyCounts()
  const cats = db.exec('SELECT id,en,zh,sort_order FROM categories WHERE group_id=?', [fromGroupId])[0]?.values || []
  const subs = db.exec('SELECT id,category_id,en,zh,sort_order FROM subcategories WHERE group_id=?', [fromGroupId])[0]?.values || []
  const tags = db.exec('SELECT id,subcategory_id,en,zh,sort_order,source FROM tags WHERE group_id=?', [fromGroupId])[0]?.values || []
  const catIdMap = new Map<string, string>()
  const subIdMap = new Map<string, string>()
  const tagIdMap = new Map<string, string>()

  for (const row of cats) {
    const newId = genScopedId('cat_')
    catIdMap.set(String(row[0]), newId)
    db.run('INSERT INTO categories (id,group_id,en,zh,sort_order) VALUES (?,?,?,?,?)', [newId, toGroupId, row[1], row[2], row[3]])
    counts.categories++
  }
  for (const row of subs) {
    const newCatId = catIdMap.get(String(row[1]))
    if (!newCatId) continue
    const newId = genScopedId('sub_')
    subIdMap.set(String(row[0]), newId)
    db.run('INSERT INTO subcategories (id,group_id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?,?)', [newId, toGroupId, newCatId, row[2], row[3], row[4]])
    counts.subcategories++
  }
  for (const row of tags) {
    const newSubId = subIdMap.get(String(row[1]))
    if (!newSubId) continue
    const newId = genScopedId('t_')
    tagIdMap.set(String(row[0]), newId)
    db.run('INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)', [newId, toGroupId, newSubId, row[2], row[3], row[4], row[5]])
    counts.tags++
  }

  const metadata = db.exec('SELECT m.tag_id,m.namespace,m.normalized_key,m.description,m.color,m.is_active,m.source FROM tag_metadata m JOIN tags t ON t.id=m.tag_id WHERE t.group_id=?', [fromGroupId])[0]?.values || []
  const aliases = db.exec('SELECT a.tag_id,a.alias,a.normalized_alias,a.language,a.source,a.is_builtin FROM tag_aliases a JOIN tags t ON t.id=a.tag_id WHERE t.group_id=?', [fromGroupId])[0]?.values || []
  const relations = db.exec('SELECT r.source_tag_id,r.target_tag_id,r.relation_type,r.confidence,r.source,r.enabled FROM tag_relations r JOIN tags ts ON ts.id=r.source_tag_id WHERE ts.group_id=?', [fromGroupId])[0]?.values || []
  insertMetadataAliases(db, metadata, aliases, tagIdMap, counts)
  copyRelations(db, relations, tagIdMap, counts)
  return counts
}

export function importTagGroupData(db: LegacyDatabase, data: unknown, toGroupId: string): TagGroupCopyCounts {
  const counts = emptyCounts()
  const payload = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
  const categories = Array.isArray(payload.categories) ? payload.categories as Array<Record<string, unknown>> : []
  const subcategories = Array.isArray(payload.subcategories) ? payload.subcategories as Array<Record<string, unknown>> : []
  const tags = Array.isArray(payload.tags) ? payload.tags as Array<Record<string, unknown>> : []
  const metadata = Array.isArray(payload.metadata) ? payload.metadata as Array<Record<string, unknown>> : []
  const aliases = Array.isArray(payload.aliases) ? payload.aliases as Array<Record<string, unknown>> : []
  const relations = Array.isArray(payload.relations) ? payload.relations as Array<Record<string, unknown>> : []
  const catIdMap = new Map<string, string>()
  const subIdMap = new Map<string, string>()
  const tagIdMap = new Map<string, string>()

  for (const item of categories) {
    const newId = genScopedId('cat_')
    catIdMap.set(String(item.id), newId)
    db.run('INSERT INTO categories (id,group_id,en,zh,sort_order) VALUES (?,?,?,?,?)', [newId, toGroupId, item.en || item.zh, item.zh || item.en, item.sort_order || 0])
    counts.categories++
  }
  for (const item of subcategories) {
    const newCatId = catIdMap.get(String(item.category_id))
    if (!newCatId) continue
    const newId = genScopedId('sub_')
    subIdMap.set(String(item.id), newId)
    db.run('INSERT INTO subcategories (id,group_id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?,?)', [newId, toGroupId, newCatId, item.en || item.zh, item.zh || item.en, item.sort_order || 0])
    counts.subcategories++
  }
  for (const item of tags) {
    const newSubId = subIdMap.get(String(item.subcategory_id))
    if (!newSubId) continue
    const newId = genScopedId('t_')
    tagIdMap.set(String(item.id), newId)
    db.run('INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)', [newId, toGroupId, newSubId, item.en || item.zh, item.zh || item.en, item.sort_order || 0, item.source || 'custom'])
    counts.tags++
  }

  insertMetadataAliases(
    db,
    metadata.map(item => [item.tag_id, item.namespace ?? '', item.normalized_key ?? '', item.description ?? '', item.color ?? '', item.is_active ?? 1, item.source ?? 'imported']),
    aliases.map(item => [item.tag_id, item.alias ?? '', item.normalized_alias ?? '', item.language ?? '', item.source ?? 'imported', item.is_builtin ?? 0]),
    tagIdMap,
    counts,
  )
  copyRelations(
    db,
    relations.map(item => [item.source_tag_id, item.target_tag_id, item.relation_type, item.confidence ?? 1, item.source ?? 'imported', item.enabled ?? 1]),
    tagIdMap,
    counts,
  )
  return counts
}