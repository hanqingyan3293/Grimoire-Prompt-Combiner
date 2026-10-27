// 魔导书 Grimoire v7 — 标签查询服务
// Relation semantics follow the v21 canonical direction: `implication`/`parent`
// edges point from the more specific tag to the more general one. Forward
// closure (expandTagRelations) walks source -> target; descendant expansion
// (expandTagDescendants) walks the reverse direction, so filtering by a general
// tag can include items tagged with its specific descendants.
import type { LegacyDatabase } from './sqlite.compat'
import { getActiveGroupId } from '../ipc/tagGroups.ipc'
import type { TagSearchResult } from '../../shared/tag-intelligence-types'

export interface TagQueryInput {
  query?: string
  limit?: number
  mode?: 'substring' | 'prefix'
  namespace?: string
  sort?: 'score' | 'usage' | 'alpha'
  groupId?: string
  /** 默认 false：禁用标签不出现在结果里；管理视图可显式传 true 查看全部。 */
  includeDisabled?: boolean
}

export interface TagRow {
  id: string
  subcategory_id: string
  en: string
  zh: string
  sort_order: number
  source: string
  created_at: string
}

export interface TagClosureEntry {
  tag: TagRow
  depth: number
}

const RELATION_TYPES = "('implication','parent')"
const DEFAULT_MAX_DEPTH = 8

function normalizeQueryValue(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, ' ')
}

function tagRow(row: unknown[]): TagRow {
  return {
    id: String(row[0]),
    subcategory_id: String(row[1]),
    en: String(row[2] || ''),
    zh: String(row[3] || ''),
    sort_order: Number(row[4] || 0),
    source: String(row[5] || 'builtin'),
    created_at: String(row[6] || ''),
  }
}

function clampMaxDepth(value: unknown): number {
  const depth = Math.floor(Number(value ?? DEFAULT_MAX_DEPTH))
  if (!Number.isFinite(depth)) return DEFAULT_MAX_DEPTH
  return Math.max(1, Math.min(32, depth))
}

function listTagsByIds(db: LegacyDatabase, ids: string[]): TagRow[] {
  if (!ids.length) return []
  const rows: TagRow[] = []
  for (let start = 0; start < ids.length; start += 400) {
    const chunk = ids.slice(start, start + 400)
    const placeholders = chunk.map(() => '?').join(',')
    const result = db.exec(`SELECT id,subcategory_id,en,zh,sort_order,source,created_at FROM tags WHERE id IN (${placeholders})`, chunk)
    for (const row of result[0]?.values || []) rows.push(tagRow(row))
  }
  return rows
}

function runClosure(db: LegacyDatabase, seeds: string[], maxDepth: number, direction: 'forward' | 'reverse'): TagClosureEntry[] {
  if (!seeds.length) return []
  const seedSql = seeds.map(() => 'SELECT ? AS id, 0 AS depth').join(' UNION ALL ')
  const joinClause = direction === 'forward'
    ? `closure JOIN tag_relations r ON r.source_tag_id = closure.id`
    : `closure JOIN tag_relations r ON r.target_tag_id = closure.id`
  const nextColumn = direction === 'forward' ? 'r.target_tag_id' : 'r.source_tag_id'
  const rows = db.exec(
    `WITH RECURSIVE closure(id,depth) AS (
       ${seedSql}
       UNION
       SELECT ${nextColumn}, closure.depth + 1
         FROM ${joinClause}
        WHERE r.enabled=1 AND r.relation_type IN ${RELATION_TYPES} AND closure.depth < ?
     )
     SELECT id, MIN(depth) AS depth FROM closure GROUP BY id ORDER BY depth ASC, id ASC`,
    [...seeds, maxDepth],
  )[0]?.values || []
  const entries = rows.map(row => ({ id: String(row[0]), depth: Number(row[1] || 0) }))
  const byId = new Map(listTagsByIds(db, entries.map(entry => entry.id)).map(tag => [tag.id, tag] as const))
  return entries.flatMap(entry => {
    const tag = byId.get(entry.id)
    return tag ? [{ tag, depth: entry.depth }] : []
  })
}

export function searchTagsAdvanced(db: LegacyDatabase, input: TagQueryInput = {}): TagSearchResult[] {
  const query = normalizeQueryValue(input.query)
  const limit = Math.min(200, Math.max(1, Math.floor(Number(input.limit) || 50)))
  const mode = input.mode === 'prefix' ? 'prefix' : 'substring'
  const namespace = String(input.namespace || '').trim()
  const sort = input.sort === 'usage' || input.sort === 'alpha' ? input.sort : 'score'
  const groupId = String(input.groupId || getActiveGroupId())
  const pattern = mode === 'prefix' ? query + '%' : '%' + query + '%'

  const includeDisabled = input.includeDisabled === true
  const params: unknown[] = [query, query, query, query, query, query, query, query, groupId]
  let sql = `SELECT t.id,t.subcategory_id,t.en,t.zh,t.sort_order,t.source,t.created_at,
      CASE WHEN ?<>'' AND (lower(t.en)=? OR lower(t.zh)=?) THEN 'canonical'
           WHEN EXISTS (SELECT 1 FROM tag_aliases a WHERE a.tag_id=t.id AND a.normalized_alias=?) THEN 'alias'
           ELSE 'fuzzy' END AS matched_by,
      CASE WHEN ?<>'' AND (lower(t.en)=? OR lower(t.zh)=?) THEN 1.0
           WHEN EXISTS (SELECT 1 FROM tag_aliases a WHERE a.tag_id=t.id AND a.normalized_alias=?) THEN 0.9
           ELSE 0.65 END AS score,
      COALESCE(u.count,0) AS usage_count
    FROM tags t
    LEFT JOIN tag_metadata m ON m.tag_id=t.id
    LEFT JOIN tag_usage u ON u.tag_id=t.id
    WHERE t.group_id=?`
  // 禁用标签（tag_metadata.is_active=0）默认不出现在搜索/补全里——元数据编辑器的
  // 「启用该标签」开关由此获得真实语义；显式传 includeDisabled 可绕过（管理视图用）。
  if (!includeDisabled) sql += ' AND COALESCE(m.is_active,1)=1'
  if (namespace) {
    sql += ' AND m.namespace=?'
    params.push(namespace)
  }
  if (query) {
    sql += ' AND (lower(t.en) LIKE ? OR lower(t.zh) LIKE ? OR EXISTS (SELECT 1 FROM tag_aliases a2 WHERE a2.tag_id=t.id AND a2.normalized_alias LIKE ?))'
    params.push(pattern, pattern, pattern)
  }
  if (sort === 'usage') sql += ' ORDER BY usage_count DESC, score DESC, t.sort_order ASC, t.en ASC'
  else if (sort === 'alpha') sql += ' ORDER BY t.en ASC, t.zh ASC'
  else sql += ' ORDER BY score DESC, usage_count DESC, t.sort_order ASC, t.en ASC'
  sql += ' LIMIT ?'
  params.push(limit)

  const rows = db.exec(sql, params)[0]?.values || []
  const results = rows.map(row => ({
    tag: tagRow(row),
    matchedBy: String(row[7]) as TagSearchResult['matchedBy'],
    score: Number(row[8] || 0),
    usageCount: Number(row[9] || 0),
  }))
  // TagStudio 消歧义支持：同名（en 相同）命中来自不同子类时，渲染层需要
  // 分类上下文才能区分它们。这里只读取子类名，不新增列。
  if (results.length > 0) {
    const ids = [...new Set(results.map(item => item.tag.subcategory_id).filter(Boolean))]
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',')
      const subRows = db.exec(`SELECT s.id, s.zh, s.en, c.zh, c.en FROM subcategories s LEFT JOIN categories c ON c.id=s.category_id WHERE s.id IN (${placeholders})`, ids)[0]?.values || []
      const context = new Map(subRows.map(row => [String(row[0]), { subcategoryZh: String(row[1] || ''), subcategoryEn: String(row[2] || ''), categoryZh: String(row[3] || ''), categoryEn: String(row[4] || '') }]))
      return results.map(item => ({ ...item, subcategory: context.get(item.tag.subcategory_id) }))
    }
  }
  return results
}

export function expandTagRelations(db: LegacyDatabase, tagIds: unknown[], options: { maxDepth?: number } = {}): TagClosureEntry[] {
  const seeds = [...new Set((tagIds || []).map(value => String(value || '').trim()).filter(Boolean))]
  return runClosure(db, seeds, clampMaxDepth(options.maxDepth), 'forward')
}

export function expandTagDescendants(db: LegacyDatabase, tagIds: unknown[], options: { maxDepth?: number } = {}): TagClosureEntry[] {
  const seeds = [...new Set((tagIds || []).map(value => String(value || '').trim()).filter(Boolean))]
  return runClosure(db, seeds, clampMaxDepth(options.maxDepth), 'reverse')
}

export function listTagDescendants(db: LegacyDatabase, tagId: unknown, maxDepth = DEFAULT_MAX_DEPTH): TagClosureEntry[] {
  const id = String(tagId || '').trim()
  if (!id) return []
  return expandTagDescendants(db, [id], { maxDepth })
}