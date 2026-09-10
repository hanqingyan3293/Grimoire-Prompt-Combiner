import type { LegacyDatabase } from './sqlite.compat'
import type { PromptAssetCategory, PromptAssetItem, PromptAssetPage, PromptAssetQuery, PromptAssetSourceFilter } from '../../shared/prompt-asset-types'
import type { PresetData } from '../../shared/types'
import { requireText } from './input-validation'
import crypto from 'crypto'
import { saveDatabase } from '../database'

const SOURCES = new Set<PromptAssetSourceFilter>(['all', 'asset', 'history', 'preset', 'favorite'])

const UNIFIED_QUERY = `
WITH unified AS (
  SELECT
    'asset:' || id AS id, id AS source_ref, 'asset' AS source, name, prompt,
    trim(source || CASE WHEN chapter <> '' THEN ' · ' || chapter ELSE '' END || CASE WHEN section <> '' THEN ' / ' || section ELSE '' END || CASE WHEN subsection <> '' THEN ' / ' || subsection ELSE '' END) AS detail,
    coalesce(nullif(section, ''), nullif(chapter, ''), source) AS group_name,
    __CATEGORY_IDS__ AS category_ids,
    NULL AS payload_json, created_at, nsfw, variant_count
  FROM prompt_assets
  UNION ALL
  SELECT
    'history:' || id, id, 'history', substr(replace(prompt, char(10), ' '), 1, 80), prompt,
    '正面 ' || positive_count || ' · 负面 ' || negative_count, '历史', NULL, NULL, created_at, 0, 0
  FROM history
  UNION ALL
  SELECT
    'preset:' || p.id, p.id, 'preset', p.name,
    coalesce((SELECT group_concat(t.en, ', ') FROM json_each(p.data, '$.positive') j JOIN tags t ON t.id = json_extract(j.value, '$.tag_id')), '') ||
    CASE WHEN EXISTS (SELECT 1 FROM json_each(p.data, '$.negative')) THEN char(10) || '--neg ' || coalesce((SELECT group_concat(t.en, ', ') FROM json_each(p.data, '$.negative') j JOIN tags t ON t.id = json_extract(j.value, '$.tag_id')), '') ELSE '' END,
    '提示词预设', '预设', NULL, p.data, p.updated_at, 0, 0
  FROM presets p
  WHERE json_valid(p.data)
  UNION ALL
  SELECT
    'favorite:' || t.id, t.id, 'favorite', coalesce(nullif(t.zh, ''), t.en), t.en,
    trim(coalesce(c.zh, '') || CASE WHEN s.zh IS NOT NULL AND s.zh <> '' THEN ' / ' || s.zh ELSE '' END),
    '收藏', NULL, json_object('tagId', t.id), f.created_at, 0, 0
  FROM favorites f
  JOIN tags t ON t.id = f.tag_id
  LEFT JOIN subcategories s ON s.id = t.subcategory_id
  LEFT JOIN categories c ON c.id = s.category_id
)
`

function boundedInteger(value: unknown, fallback: number, min: number, max: number, field: string): number {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(field + ' 超出允许范围')
  return value
}

export function validatePromptAssetQuery(value: unknown): Required<PromptAssetQuery> {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const query = requireText(input.query ?? '', '搜索关键词', 200)
  const source = (input.source ?? 'all') as PromptAssetSourceFilter
  if (!SOURCES.has(source)) throw new Error('资产来源无效')
  return {
    query,
    source,
    limit: boundedInteger(input.limit, 40, 1, 100, '每页数量'),
    offset: boundedInteger(input.offset, 0, 0, 1_000_000, '分页位置'),
  }
}

function escapeLike(value: string): string {
  const escape = String.fromCharCode(92)
  return Array.from(value, character => character === escape || character === '%' || character === '_' ? escape + character : character).join('')
}

function parsePresetData(value: unknown): PresetData | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const parsed = JSON.parse(value) as PresetData
    if (!Array.isArray(parsed.positive) || !Array.isArray(parsed.negative)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function queryPromptAssets(db: LegacyDatabase, input: unknown): PromptAssetPage {
  const options = validatePromptAssetQuery(input)
  const pattern = '%' + escapeLike(options.query.toLowerCase()) + '%'
  const where = `WHERE (? = 'all' OR source = ?) AND (? = '' OR lower(name) LIKE ? ESCAPE char(92) OR lower(prompt) LIKE ? ESCAPE char(92) OR lower(detail) LIKE ? ESCAPE char(92))`
  const parameters = [options.source, options.source, options.query, pattern, pattern, pattern]
  const categoryTable = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='prompt_asset_category_links'")[0]?.values?.length ? '(SELECT group_concat(category_id) FROM prompt_asset_category_links l WHERE l.asset_id = prompt_assets.id)' : 'NULL'
  const unifiedQuery = UNIFIED_QUERY.replace('__CATEGORY_IDS__', categoryTable)
  const countStatement = db.prepare(unifiedQuery + `SELECT count(*) AS total FROM unified ${where}`)
  const listStatement = db.prepare(unifiedQuery + `SELECT * FROM unified ${where} ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`)
  try {
    const total = Number(countStatement.get(parameters)?.total || 0)
    const rows = listStatement.all([...parameters, options.limit, options.offset])
    const items: PromptAssetItem[] = rows.map(row => {
      const source = String(row.source) as PromptAssetItem['source']
      const payload = typeof row.payload_json === 'string' ? row.payload_json : ''
      return {
        id: String(row.id),
        sourceRef: String(row.source_ref),
        source,
        name: String(row.name || ''),
        prompt: String(row.prompt || ''),
        detail: String(row.detail || ''),
        group: String(row.group_name || row.detail || source),
        categoryIds: typeof row.category_ids === 'string' && row.category_ids ? String(row.category_ids).split(',').filter(Boolean) : [],
        createdAt: String(row.created_at || ''),
        nsfw: Number(row.nsfw) === 1,
        variantCount: Number(row.variant_count) || 0,
        presetData: source === 'preset' ? parsePresetData(payload) : undefined,
        tagId: source === 'favorite' && payload ? String((JSON.parse(payload) as { tagId?: string }).tagId || '') : undefined,
      }
    })
    return { items, total, limit: options.limit, offset: options.offset }
  } finally {
    countStatement.free()
    listStatement.free()
  }
}

export function listPromptAssetCategories(db: LegacyDatabase): PromptAssetCategory[] {
  const table = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='prompt_asset_categories'")[0]
  if (!table?.values?.length) return []
  const rows = db.prepare('SELECT id, parent_id, name, source_scope, sort_order, is_builtin FROM prompt_asset_categories ORDER BY source_scope, sort_order, name').all([])
  return rows.map(row => ({ id: String(row.id), parentId: row.parent_id ? String(row.parent_id) : null, name: String(row.name), sourceScope: String(row.source_scope) as PromptAssetSourceFilter as PromptAssetCategory['sourceScope'], sortOrder: Number(row.sort_order) || 0, isBuiltin: Number(row.is_builtin) === 1 }))
}

export function createPromptAssetCategory(db: LegacyDatabase, input: unknown): PromptAssetCategory {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const name = requireText(value.name ?? '', '分类名称', 100)
  const sourceScope = (typeof value.sourceScope === 'string' ? value.sourceScope : 'asset') as PromptAssetCategory['sourceScope']
  const parentId = typeof value.parentId === 'string' && value.parentId ? value.parentId : null
  const id = 'cat_' + crypto.randomUUID()
  const now = new Date().toISOString()
  db.run('INSERT INTO prompt_asset_categories (id,parent_id,name,source_scope,sort_order,is_builtin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', [id, parentId, name, sourceScope, 0, 0, now, now])
  saveDatabase()
  return { id, parentId, name, sourceScope, sortOrder: 0, isBuiltin: false }
}

export function renamePromptAssetCategory(db: LegacyDatabase, input: unknown): boolean {
  const value = input as Record<string, unknown>
  const id = requireText(value.id ?? '', '分类 ID', 200)
  const name = requireText(value.name ?? '', '分类名称', 100)
  const result = db.run('UPDATE prompt_asset_categories SET name=?, updated_at=? WHERE id=? AND is_builtin=0', [name, new Date().toISOString(), id])
  if (Number(result.changes)) saveDatabase()
  return Number(result.changes) > 0
}

export function deletePromptAssetCategory(db: LegacyDatabase, idValue: unknown): boolean {
  const id = requireText(idValue ?? '', '分类 ID', 200)
  const result = db.run('DELETE FROM prompt_asset_categories WHERE id=? AND is_builtin=0', [id])
  if (Number(result.changes)) saveDatabase()
  return Number(result.changes) > 0
}

export function movePromptAssetCategory(db: LegacyDatabase, input: unknown): boolean {
  const value = input as Record<string, unknown>
  const id = requireText(value.id ?? '', '分类 ID', 200)
  const parentId = typeof value.parentId === 'string' && value.parentId ? value.parentId : null
  const category = db.prepare('SELECT id, is_builtin FROM prompt_asset_categories WHERE id=?').get([id]) as { id?: string; is_builtin?: number } | undefined
  if (!category || Number(category.is_builtin) === 1) return false
  if (parentId === id) throw new Error('分类不能移动到自身')
  if (parentId) {
    const parent = db.prepare('SELECT id FROM prompt_asset_categories WHERE id=?').get([parentId])
    if (!parent) throw new Error('目标父分类不存在')
  }
  const result = db.run('UPDATE prompt_asset_categories SET parent_id=?, updated_at=? WHERE id=? AND is_builtin=0', [parentId, new Date().toISOString(), id])
  if (Number(result.changes)) saveDatabase()
  return Number(result.changes) > 0
}

export function assignPromptAssetCategory(db: LegacyDatabase, input: unknown): boolean {
  const value = input as Record<string, unknown>
  const assetId = requireText(value.assetId ?? '', '资产 ID', 500)
  const categoryId = requireText(value.categoryId ?? '', '分类 ID', 200)
  const now = new Date().toISOString()
  db.run('DELETE FROM prompt_asset_category_links WHERE asset_id=?', [assetId])
  db.run('INSERT OR IGNORE INTO prompt_asset_category_links (asset_id, category_id, created_at) VALUES (?,?,?)', [assetId, categoryId, now])
  saveDatabase()
  return true
}

export function createPromptAsset(db: LegacyDatabase, input: unknown): PromptAssetItem {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('提示词资产参数无效')
  const value = input as Record<string, unknown>
  const name = requireText(value.name ?? '', '资产名称', 500)
  const prompt = requireText(value.prompt ?? '', '资产提示词', 100_000)
  const detail = requireText(value.detail ?? '', '资产详情', 2_000)
  const sourceId = typeof value.sourceId === 'string' && value.sourceId.trim() ? value.sourceId.trim().slice(0, 500) : `asset-${crypto.randomUUID()}`
  const id = `asset:${crypto.randomUUID()}`
  const now = new Date().toISOString()
  db.run('INSERT INTO prompt_assets (id, source_id, source, name, prompt, chapter, section, subsection, nsfw, variant_count, source_fingerprint, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, sourceId, 'asset', name, prompt, detail, '', '', value.nsfw === true ? 1 : 0, Number.isInteger(value.variantCount) ? Math.max(0, Number(value.variantCount)) : 0, crypto.createHash('sha256').update(`${sourceId}:${name}:${prompt}`).digest('hex'), now, now])
  saveDatabase()
  return { id, sourceRef: sourceId, source: 'asset', name, prompt, detail, createdAt: now, nsfw: value.nsfw === true, variantCount: Number.isInteger(value.variantCount) ? Math.max(0, Number(value.variantCount)) : 0 }
}

export function deletePromptAsset(db: LegacyDatabase, sourceId: unknown): boolean {
  const id = requireText(sourceId ?? '', '提示词资产 ID', 500)
  const result = db.run("DELETE FROM prompt_assets WHERE source='asset' AND source_id=?", [id])
  return Number(result.changes) > 0
}
