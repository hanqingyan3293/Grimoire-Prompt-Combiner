// 魔导书 Grimoire v7 — tag→asset 反向查询服务
// AND/OR/NONE semantics over accepted asset_tag_links. When includeImplied is
// set, filter tags are expanded along the reverse relation closure so items
// tagged with more specific descendants still match (TagStudio search
// substitution semantics).
import type { LegacyDatabase } from './sqlite.compat'
import { expandTagDescendants } from './tag-query.service'

export interface AssetTagFilter {
  assetType: string
  tagIds: string[]
  logic?: 'any' | 'all' | 'none'
  polarity?: 'neutral' | 'positive' | 'negative' | 'any'
  includeImplied?: boolean
}

export interface AssetQueryPage {
  limit?: number
  offset?: number
}

export interface AssetTagLinkSummary {
  tagId: string
  polarity: string
  weight: number
  confidence: number
  source: string
  status: string
}

function requireText(value: unknown, field: string, max = 500): string {
  const text = String(value || '').trim()
  if (!text || text.length > max) throw new Error(field + '无效')
  return text
}

function uniqueIds(values: unknown[]): string[] {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))]
}

export function queryAssetKeysByTags(
  db: LegacyDatabase,
  filter: AssetTagFilter,
  page: AssetQueryPage = {},
): { keys: Array<{ assetKey: string; matchedCount: number }>; total: number } {
  const assetType = requireText(filter.assetType, '资产类型', 80)
  const logic = filter.logic === 'all' || filter.logic === 'none' ? filter.logic : 'any'
  const polarity = filter.polarity && filter.polarity !== 'any' ? requireText(filter.polarity, '极性', 40) : ''
  const limit = Math.max(1, Math.min(1000, Math.floor(Number(page.limit ?? 200) || 200)))
  const offset = Math.max(0, Math.floor(Number(page.offset || 0)))

  let ids = uniqueIds(filter.tagIds || [])
  if (filter.includeImplied && ids.length) {
    ids = uniqueIds([...ids, ...expandTagDescendants(db, ids).map(entry => entry.tag.id)])
  }

  const baseParams: unknown[] = [assetType]
  let baseWhere = "asset_type=? AND status='accepted'"
  if (polarity) {
    baseWhere += ' AND polarity=?'
    baseParams.push(polarity)
  }

  if (logic === 'none') {
    let sql = `SELECT DISTINCT asset_key FROM asset_tag_links WHERE ${baseWhere}`
    let params = [...baseParams]
    if (ids.length) {
      sql += ` AND asset_key NOT IN (SELECT DISTINCT asset_key FROM asset_tag_links WHERE ${baseWhere} AND tag_id IN (${ids.map(() => '?').join(',')}))`
      params = [...baseParams, ...baseParams, ...ids]
    }
    const totalRow = db.exec(`SELECT COUNT(*) FROM (${sql})`, params)[0]?.values?.[0]
    const rows = db.exec(sql + ' ORDER BY asset_key LIMIT ? OFFSET ?', [...params, limit, offset])[0]?.values || []
    return { keys: rows.map(row => ({ assetKey: String(row[0]), matchedCount: 0 })), total: Number(totalRow?.[0] || 0) }
  }

  if (!ids.length) return { keys: [], total: 0 }

  const params: unknown[] = [...baseParams, ...ids]
  const where = `${baseWhere} AND tag_id IN (${ids.map(() => '?').join(',')})`
  const groupParams = logic === 'all' ? [...params, ids.length] : params
  const having = logic === 'all' ? ' HAVING COUNT(DISTINCT tag_id) = ?' : ''
  const totalRow = db.exec(
    `SELECT COUNT(*) FROM (SELECT asset_key FROM asset_tag_links WHERE ${where} GROUP BY asset_key${having})`,
    groupParams,
  )[0]?.values?.[0]
  const rows = db.exec(
    `SELECT asset_key, COUNT(DISTINCT tag_id) AS matched FROM asset_tag_links WHERE ${where} GROUP BY asset_key${having} ORDER BY asset_key LIMIT ? OFFSET ?`,
    [...groupParams, limit, offset],
  )[0]?.values || []
  return {
    keys: rows.map(row => ({ assetKey: String(row[0]), matchedCount: Number(row[1] || 0) })),
    total: Number(totalRow?.[0] || 0),
  }
}

export function listAssetLinksBatch(
  db: LegacyDatabase,
  assetTypeValue: unknown,
  assetKeysValue: unknown[],
): Array<{ assetKey: string; tagIds: string[]; links: AssetTagLinkSummary[] }> {
  const assetType = requireText(assetTypeValue, '资产类型', 80)
  const assetKeys = uniqueIds(assetKeysValue || [])
  if (!assetKeys.length) return []

  const byKey = new Map<string, AssetTagLinkSummary[]>()
  for (let start = 0; start < assetKeys.length; start += 400) {
    const chunk = assetKeys.slice(start, start + 400)
    const rows = db.exec(
      `SELECT asset_key, tag_id, polarity, weight, confidence, source, status
         FROM asset_tag_links
        WHERE asset_type=? AND asset_key IN (${chunk.map(() => '?').join(',')})
        ORDER BY asset_key, tag_id`,
      [assetType, ...chunk],
    )[0]?.values || []
    for (const row of rows) {
      const key = String(row[0])
      const list = byKey.get(key) || []
      list.push({
        tagId: String(row[1]),
        polarity: String(row[2] || 'neutral'),
        weight: Number(row[3] || 1),
        confidence: Number(row[4] || 1),
        source: String(row[5] || ''),
        status: String(row[6] || 'accepted'),
      })
      byKey.set(key, list)
    }
  }

  return assetKeys.map(assetKey => {
    const links = byKey.get(assetKey) || []
    return {
      assetKey,
      tagIds: [...new Set(links.filter(link => link.status === 'accepted').map(link => link.tagId))],
      links,
    }
  })
}