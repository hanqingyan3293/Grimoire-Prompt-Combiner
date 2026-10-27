// 魔导书 Grimoire v7 — 图库组合查询服务
// Combined gallery queries over media_assets ⋈ image_refs with an inlined
// asset_tag_links subquery keyed by asset_ref_id (schema v22), so tag
// filtering, sorting and pagination stay a single statement per page — no
// per-item N+1 lookups. Filter semantics for tagFilter mirror
// tag-asset-query.service (accepted links, any/all/none, descendant
// expansion via implication closure when includeImplied is set);
// excludeTagIds adds an independent NOT IN exclusion that is never
// expanded by includeImplied.
import type { LegacyDatabase } from './sqlite.compat'
import { expandTagDescendants } from './tag-query.service'

export interface GalleryQuery {
  search?: string                    // 命中 media_assets.title 或 image_refs.original_name（LIKE，参数化）
  sourceKinds?: string[]             // media_assets.source_kind IN (...)
  favorite?: boolean
  minRating?: number                 // media_assets.rating >= ?
  tagFilter?: { tagIds: string[]; logic?: 'any' | 'all' | 'none'; includeImplied?: boolean; excludeTagIds?: string[] }  // includeImplied 时先经 expandTagDescendants 展开 tagIds（不含 excludeTagIds）
  sort?: 'updated' | 'created' | 'rating' | 'name'   // 白名单外回退 'updated'
  order?: 'asc' | 'desc'
}

export interface GalleryQueryPage { limit?: number; offset?: number }   // limit 默认 200，上限 1000

export interface GalleryItem {
  mediaId: string; imageRefId: number; title: string; originalName: string
  sourceKind: string; favorite: boolean; rating: number; available: boolean
  width: number | null; height: number | null
  createdAt: string; updatedAt: string
}

// ORDER BY 白名单：任何未列出的 sort 值都回退到 updated。
const SORT_COLUMNS: Record<'updated' | 'created' | 'rating' | 'name', string> = {
  updated: 'm.updated_at',
  created: 'm.created_at',
  rating: 'm.rating',
  name: 'r.original_name',
}

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 1000

const SELECT_COLUMNS = 'm.id,m.image_ref_id,m.title,r.original_name,m.source_kind,m.favorite,m.rating,r.available,r.width,r.height,m.created_at,m.updated_at'
const FROM_MAIN = 'FROM media_assets m JOIN image_refs r ON r.id=m.image_ref_id'

function uniqueIds(values: unknown[]): string[] {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))]
}

function normalizeLimit(value: unknown): number {
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(value ?? DEFAULT_LIMIT) || DEFAULT_LIMIT)))
}

function normalizeOffset(value: unknown): number {
  return Math.max(0, Math.floor(Number(value || 0)))
}

interface BuiltGallerySql {
  sql: string
  countSql: string
  params: unknown[]
  limit: number
  offset: number
  forceEmpty: boolean
}

function buildGallerySql(db: LegacyDatabase, query: GalleryQuery, page: GalleryQueryPage): BuiltGallerySql {
  // JOIN 参数必须排在 WHERE 参数之前（文本顺序），因此分开收集。
  const joinClauses: string[] = []
  const joinParams: unknown[] = []
  const whereClauses: string[] = []
  const whereParams: unknown[] = []
  let forceEmpty = false

  const search = String(query.search || '').trim().toLowerCase()
  if (search) {
    whereClauses.push('(lower(m.title) LIKE ? OR lower(r.original_name) LIKE ?)')
    const pattern = '%' + search + '%'
    whereParams.push(pattern, pattern)
  }

  const sourceKinds = uniqueIds(query.sourceKinds || [])
  if (sourceKinds.length) {
    whereClauses.push(`m.source_kind IN (${sourceKinds.map(() => '?').join(',')})`)
    whereParams.push(...sourceKinds)
  }

  if (query.favorite !== undefined) {
    whereClauses.push('m.favorite=?')
    whereParams.push(query.favorite ? 1 : 0)
  }

  if (query.minRating !== undefined) {
    whereClauses.push('m.rating>=?')
    whereParams.push(Math.max(0, Math.min(5, Math.floor(Number(query.minRating) || 0))))
  }

  const tagFilter = query.tagFilter
  if (tagFilter) {
    const logic = tagFilter.logic === 'all' || tagFilter.logic === 'none' ? tagFilter.logic : 'any'
    let ids = uniqueIds(tagFilter.tagIds || [])
    if (tagFilter.includeImplied && ids.length) {
      ids = uniqueIds([...ids, ...expandTagDescendants(db, ids).map(entry => entry.tag.id)])
    }
    // excludeTagIds 与 include tagIds 互不依赖：独立追加 NOT IN 排除子查询，两者可同时生效；
    // includeImplied 只展开 tagIds，不展开 excludeTagIds。
    const excludeIds = uniqueIds(tagFilter.excludeTagIds || [])
    if (excludeIds.length) {
      whereClauses.push(`r.id NOT IN (SELECT DISTINCT asset_ref_id FROM asset_tag_links WHERE asset_type='image' AND status='accepted' AND asset_ref_id IS NOT NULL AND tag_id IN (${excludeIds.map(() => '?').join(',')}))`)
      whereParams.push(...excludeIds)
    }
    if (logic === 'none') {
      // 'none' 语义与 tag-asset-query 一致：不看匹配计数，只排除命中集合；空 tagIds 时不过滤。
      // 与 excludeTagIds 并存时两条排除子查询冗余但语义一致，不特判。
      if (ids.length) {
        whereClauses.push(`r.id NOT IN (SELECT DISTINCT asset_ref_id FROM asset_tag_links WHERE asset_type='image' AND status='accepted' AND asset_ref_id IS NOT NULL AND tag_id IN (${ids.map(() => '?').join(',')}))`)
        whereParams.push(...ids)
      }
    } else if (ids.length) {
      const placeholders = ids.map(() => '?').join(',')
      const having = logic === 'all' ? ' HAVING COUNT(DISTINCT tag_id) = ?' : ''
      joinClauses.push(`JOIN (SELECT asset_ref_id AS ref, COUNT(DISTINCT tag_id) AS matched FROM asset_tag_links WHERE asset_type='image' AND status='accepted' AND asset_ref_id IS NOT NULL AND tag_id IN (${placeholders}) GROUP BY asset_ref_id${having}) k ON k.ref = r.id`)
      joinParams.push(...ids)
      if (logic === 'all') joinParams.push(ids.length)
    } else if (!excludeIds.length) {
      // 'any'/'all' 且既无 include 也无 exclude 时与 tag-asset-query 一致：不返回任何行；
      // 仅有 excludeTagIds 时按排除过滤（exclude 独立生效，不依赖 tagIds）。
      forceEmpty = true
    }
  }

  const sortKey = query.sort === 'created' || query.sort === 'rating' || query.sort === 'name' ? query.sort : 'updated'
  const orderSql = query.order === 'asc' ? 'ASC' : 'DESC'

  const from = FROM_MAIN + (joinClauses.length ? ' ' + joinClauses.join(' ') : '')
  const where = whereClauses.length ? ' WHERE ' + whereClauses.join(' AND ') : ''
  const params = [...joinParams, ...whereParams]

  return {
    sql: `SELECT ${SELECT_COLUMNS} ${from}${where} ORDER BY ${SORT_COLUMNS[sortKey]} ${orderSql}, m.id ASC LIMIT ? OFFSET ?`,
    countSql: `SELECT COUNT(*) ${from}${where}`,
    params,
    limit: normalizeLimit(page.limit),
    offset: normalizeOffset(page.offset),
    forceEmpty,
  }
}

function toGalleryItem(row: unknown[]): GalleryItem {
  return {
    mediaId: String(row[0] || ''),
    imageRefId: Number(row[1] || 0),
    title: String(row[2] || ''),
    originalName: String(row[3] || ''),
    sourceKind: String(row[4] || ''),
    favorite: Number(row[5]) === 1,
    rating: Number(row[6] || 0),
    available: Number(row[7]) === 1,
    width: row[8] == null ? null : Number(row[8]),
    height: row[9] == null ? null : Number(row[9]),
    createdAt: String(row[10] || ''),
    updatedAt: String(row[11] || ''),
  }
}

export function queryGallery(db: LegacyDatabase, query: GalleryQuery, page: GalleryQueryPage = {}): { items: GalleryItem[]; total: number } {
  const built = buildGallerySql(db, query, page)
  if (built.forceEmpty) return { items: [], total: 0 }
  const totalRow = db.exec(built.countSql, built.params)[0]?.values?.[0]
  const rows = db.exec(built.sql, [...built.params, built.limit, built.offset])[0]?.values || []
  return { items: rows.map(toGalleryItem), total: Number(totalRow?.[0] || 0) }
}

export function countGallery(db: LegacyDatabase, query: GalleryQuery): number {
  const built = buildGallerySql(db, query, {})
  if (built.forceEmpty) return 0
  const row = db.exec(built.countSql, built.params)[0]?.values?.[0]
  return Number(row?.[0] || 0)
}

// ids 提供时返回其数量（去重）；否则返回 countGallery(query)。
export function previewMediaBatch(db: LegacyDatabase, input: { ids?: string[]; query?: GalleryQuery }): { assets: number } {
  if (Array.isArray(input.ids)) return { assets: uniqueIds(input.ids).length }
  return { assets: countGallery(db, input.query || {}) }
}