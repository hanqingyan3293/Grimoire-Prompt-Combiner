import type { LegacyDatabase } from './sqlite.compat'
import type { PromptAssetCategory, PromptAssetItem, PromptAssetPage, PromptAssetQuery, PromptAssetSourceFilter } from '../../shared/prompt-asset-types'
import type { PresetData } from '../../shared/types'
import { requireText } from './input-validation'
import crypto from 'crypto'
import { saveDatabase } from '../database'
import { compareOrderKeysEmptyLast, evenlySpacedKeys, hasRoomBetween, orderKeyBetween } from './resource-order'
import { createTagSuggestions } from './tag-intelligence.service'

const SOURCES = new Set<PromptAssetSourceFilter>(['all', 'asset', 'history', 'preset', 'favorite'])

const UNIFIED_QUERY = `
WITH unified AS (
  SELECT
    'asset:' || id AS id, id AS source_ref, 'asset' AS source, name, prompt,
    trim(source || CASE WHEN chapter <> '' THEN ' · ' || chapter ELSE '' END || CASE WHEN section <> '' THEN ' / ' || section ELSE '' END || CASE WHEN subsection <> '' THEN ' / ' || subsection ELSE '' END) AS detail,
    coalesce(nullif(section, ''), nullif(chapter, ''), source) AS group_name,
    __CATEGORY_IDS__ AS category_ids,
    NULL AS payload_json, created_at, nsfw, variant_count,
    -- The asset branch reports its STORED visibility. Omitting it here (the first version did)
    -- made the projection fall back to 'global' for every row, so a prompt the user restricted
    -- was reported as globally visible while the write side stored 'restricted' correctly.
    visibility
  FROM prompt_assets
  UNION ALL
  SELECT
    'history:' || id, id, 'history', substr(replace(prompt, char(10), ' '), 1, 80), prompt,
    '正面 ' || positive_count || ' · 负面 ' || negative_count, '历史', NULL, NULL, created_at, 0, 0,
    'global'
  FROM history
  UNION ALL
  SELECT
    'preset:' || p.id, p.id, 'preset', p.name,
    coalesce((SELECT group_concat(t.en, ', ') FROM json_each(p.data, '$.positive') j JOIN tags t ON t.id = json_extract(j.value, '$.tag_id')), '') ||
    CASE WHEN EXISTS (SELECT 1 FROM json_each(p.data, '$.negative')) THEN char(10) || '--neg ' || coalesce((SELECT group_concat(t.en, ', ') FROM json_each(p.data, '$.negative') j JOIN tags t ON t.id = json_extract(j.value, '$.tag_id')), '') ELSE '' END,
    '提示词预设', '预设', NULL, p.data, p.updated_at, 0, 0,
    'global'
  FROM presets p
  WHERE json_valid(p.data)
  UNION ALL
  SELECT
    'favorite:' || t.id, t.id, 'favorite', coalesce(nullif(t.zh, ''), t.en), t.en,
    trim(coalesce(c.zh, '') || CASE WHEN s.zh IS NOT NULL AND s.zh <> '' THEN ' / ' || s.zh ELSE '' END),
    '收藏', NULL, json_object('tagId', t.id), f.created_at, 0, 0,
    'global'
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
        visibility: String(row.visibility || 'global') as 'global' | 'restricted',
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

export function createPromptAsset(db: LegacyDatabase, input: unknown, visibility: 'global' | 'restricted' = 'global'): PromptAssetItem {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('提示词资产参数无效')
  const value = input as Record<string, unknown>
  const name = requireText(value.name ?? '', '资产名称', 500)
  const prompt = requireText(value.prompt ?? '', '资产提示词', 100_000)
  const detail = requireText(value.detail ?? '', '资产详情', 2_000)
  const sourceId = typeof value.sourceId === 'string' && value.sourceId.trim() ? value.sourceId.trim().slice(0, 500) : `asset-${crypto.randomUUID()}`
  const id = `asset:${crypto.randomUUID()}`
  const now = new Date().toISOString()
  db.run('INSERT INTO prompt_assets (id, source_id, source, name, prompt, chapter, section, subsection, nsfw, variant_count, source_fingerprint, created_at, updated_at, visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, sourceId, 'asset', name, prompt, detail, '', '', value.nsfw === true ? 1 : 0, Number.isInteger(value.variantCount) ? Math.max(0, Number(value.variantCount)) : 0, crypto.createHash('sha256').update(`${sourceId}:${name}:${prompt}`).digest('hex'), now, now, visibility])
  const hasSuggestionTable = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='tag_suggestions'")[0]?.values?.length
  if (hasSuggestionTable) {
    const values = prompt.replace(/\r/g, '').split(/[,\n]/).map(item => item.trim()).filter(Boolean).map(item => ({ value: item.replace(/^\((.*):[0-9]+(?:\.[0-9]+)?\)$/, '$1').trim() })).filter(item => item.value && item.value !== '--neg')
    // Readers (PromptAssetsPanel) look up links by `prompt:` + asset id; the
    // bare id written here before v21 could never be read back.
    if (values.length) createTagSuggestions(db, { assetType: 'prompt', assetKey: 'prompt:' + id, source: 'parsed', values })
  }
  saveDatabase()
  return { id, sourceRef: sourceId, source: 'asset', name, prompt, detail, createdAt: now, nsfw: value.nsfw === true, variantCount: Number.isInteger(value.variantCount) ? Math.max(0, Number(value.variantCount)) : 0 }
}

export function deletePromptAsset(db: LegacyDatabase, sourceId: unknown): boolean {
  const id = requireText(sourceId ?? '', '提示词资产 ID', 500)
  // Refuse imported rows: they are not the user's to delete, and `source='asset'` cannot tell
  // them apart from user rows. See `isImportedPromptRow`.
  const rowId = db.exec('SELECT id FROM prompt_assets WHERE source_id=?', [id])[0]?.values?.[0]?.[0]
  if (rowId !== undefined && isImportedPromptRow(String(rowId))) return false
  const result = db.run("DELETE FROM prompt_assets WHERE source='asset' AND source_id=?", [id])
  return Number(result.changes) > 0
}

/**
 * True when a row came from an import/seed pack rather than from this app's own user actions.
 *
 * `source='asset'` does NOT distinguish them — every imported row carries it too (all 1,742 in
 * the live library do) — so the id is used instead, and the marker is the `builtin_` prefix
 * that importers assign (`createPromptAsset` mints `asset:<uuid>`; the canvas store uses a
 * nanoid). Testing the INVERSE (an `asset:` prefix as "user-created") was tried first and was
 * wrong: it classified canvas-created rows as non-user rows and broke their deletion, which an
 * existing test caught. Imported rows are the anomaly, so that is what gets detected.
 */
export function isImportedPromptRow(id: string): boolean {
  return id.startsWith('builtin_')
}

/**
 * Updates a user-created prompt asset's name and/or prompt text.
 *
 * Mirrors `PromptService.update` in the source in the parts that apply here: only the
 * supplied fields change, and the row is re-read afterwards so the caller gets the stored
 * state rather than the value it sent. `visibility` IS stored now (v29) and IS projected by
 * `UNIFIED_QUERY`, so the source's `restricted` state round-trips. The source's
 * `expectedBindings` concurrent-modification guard is still not implemented — it protects a
 * transition that this adapter does not expose.
 *
 * Scoped to `source='asset'`: built-in and imported rows are not user-owned, and the source
 * likewise only lets a user edit prompts they created.
 *
 * Returns `null` when the row does not exist or is not editable, so the caller can answer a
 * real 404/403 instead of an empty success.
 */
export function updatePromptAsset(db: LegacyDatabase, idValue: unknown, patch: { name?: unknown; prompt?: unknown }): PromptAssetItem | null {
  const id = requireText(idValue ?? '', '提示词资产 ID', 500)
  const row = db.exec("SELECT id, source_id, source, name, prompt, chapter, created_at, nsfw, variant_count FROM prompt_assets WHERE id=?", [id])[0]?.values?.[0]
  if (!row) return null
  // `source='asset'` is NOT a user-created discriminator: every imported/built-in row also
  // carries it (all 1,742 on this machine do). The real marker is the id the service itself
  // mints — `createPromptAsset` writes `asset:<uuid>` while imports keep `builtin_<hex>` /
  // their original id. Checking `source` alone let a built-in prompt be edited, which a live
  // probe caught (`builtinEdit: 200`).
  if (isImportedPromptRow(id)) return null

  const sets: string[] = []
  const params: unknown[] = []
  if (patch.name !== undefined) {
    sets.push('name=?')
    params.push(requireText(patch.name, '资产名称', 500))
  }
  if (patch.prompt !== undefined) {
    // The source caps prompt content at 100,000 characters (`PromptContentSchema`); the
    // same bound is enforced here so a save cannot store something the client would then
    // refuse to render.
    sets.push('prompt=?')
    params.push(requireText(patch.prompt, '资产提示词', 100_000))
  }
  if (sets.length === 0) {
    // Nothing to change: answer the current row rather than issuing an empty UPDATE.
    return {
      id: String(row[0]), sourceRef: String(row[1]), source: 'asset',
      name: String(row[3] || ''), prompt: String(row[4] || ''), detail: String(row[5] || ''),
      createdAt: String(row[6] || ''), nsfw: Number(row[7]) === 1, variantCount: Number(row[8]) || 0
    }
  }

  const now = new Date().toISOString()
  sets.push('updated_at=?')
  params.push(now)
  // `source_fingerprint` is derived from the mutable fields in `createPromptAsset`; leaving
  // it stale after an edit would make the same fingerprint describe two different prompts,
  // which is exactly what the column exists to prevent.
  const nextName = patch.name !== undefined ? String(requireText(patch.name, '资产名称', 500)) : String(row[3] || '')
  const nextPrompt = patch.prompt !== undefined ? String(requireText(patch.prompt, '资产提示词', 100_000)) : String(row[4] || '')
  sets.push('source_fingerprint=?')
  params.push(crypto.createHash('sha256').update(`${String(row[1])}:${nextName}:${nextPrompt}`).digest('hex'))

  db.run(`UPDATE prompt_assets SET ${sets.join(', ')} WHERE id=?`, [...params, id])
  // `db.run` does not persist on its own — see the same note on the delete path.
  saveDatabase()

  return {
    id: String(row[0]), sourceRef: String(row[1]), source: 'asset',
    name: nextName, prompt: nextPrompt, detail: String(row[5] || ''),
    createdAt: String(row[6] || ''), nsfw: Number(row[7]) === 1, variantCount: Number(row[8]) || 0
  }
}

/**
 * Current order of the user's editable prompt assets, honouring the shared order keys.
 *
 * Follows the SAME precedence the session/assistant rails use (see `orderedResourceEntries`)
 * so a prompt list sorted here matches how Grimoire's other ordered collections behave:
 * pinned first, then fractional order keys with un-keyed rows last, then recency, then id.
 * A prompt has no pin concept in the source schema, so that term is always 0 — kept in the
 * comparator rather than dropped, so the two implementations stay recognisably the same
 * ordering and a future pinned-prompts feature does not silently sort differently.
 */
export function orderedPromptAssetIds(db: LegacyDatabase): string[] {
  const rows = db.exec(`
    SELECT a.id, COALESCE(r.order_key,''), COALESCE(r.last_activity_at, a.updated_at)
    FROM prompt_assets a
    LEFT JOIN cherry_resource_state r ON r.entity_type='prompt' AND r.entity_id=a.id
    WHERE a.source='asset'
  `)[0]?.values || []
  return rows
    .map(row => ({ id: String(row[0]), key: String(row[1] || ''), activity: String(row[2] || '') }))
    .sort((a, b) =>
      compareOrderKeysEmptyLast(a.key, b.key) ||
      (a.activity < b.activity ? 1 : a.activity > b.activity ? -1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(entry => entry.id)
}

/** Reads one prompt's order key from the shared resource-state projection. */
function readPromptOrderKey(db: LegacyDatabase, id: string): string | null {
  const value = db.exec("SELECT order_key FROM cherry_resource_state WHERE entity_type='prompt' AND entity_id=?", [id])[0]?.values?.[0]?.[0]
  const key = value === undefined || value === null ? '' : String(value)
  return key === '' ? null : key
}

/**
 * Writes a prompt's order key, creating the projection row if the asset has none yet.
 *
 * Assets created before this route existed have no `cherry_resource_state` row at all, so an
 * UPDATE alone would silently affect zero rows and the reorder would appear to succeed while
 * changing nothing — the "reported clean while broken" shape.
 */
function writePromptOrderKey(db: LegacyDatabase, id: string, orderKey: string): void {
  const now = new Date().toISOString()
  const existing = db.exec("SELECT entity_id FROM cherry_resource_state WHERE entity_type='prompt' AND entity_id=?", [id])[0]?.values?.length
  if (existing) {
    db.run("UPDATE cherry_resource_state SET order_key=?, updated_at=? WHERE entity_type='prompt' AND entity_id=?", [orderKey, now, id])
  } else {
    db.run(
      'INSERT INTO cherry_resource_state (entity_type,entity_id,archived,deleted_at,pinned,order_key,group_id,owner_id,last_activity_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      ['prompt', id, 0, null, 0, orderKey, null, null, now, now, now]
    )
  }
}

/** The `before` / `after` / `position` anchor the source `OrderRequestSchema` accepts. */
export type PromptOrderAnchor = { before: string } | { after: string } | { position: 'first' | 'last' }

/**
 * Moves one prompt relative to an anchor, using fractional order keys.
 *
 * Mirrors `PromptService.reorder`, which delegates to the same `applyMoves` helper the other
 * ordered resources use. The anchor semantics match exactly: `before`/`after` name another
 * prompt, `position` moves to an end. An unknown anchor id throws rather than falling back
 * to the end — the source's `assertPromptsExistTx` does the same, and a silent fallback would
 * make a stale client's move look applied.
 *
 * Returns the new order key. Callers persist via `saveDatabase()`.
 */
export function reorderPromptAsset(db: LegacyDatabase, id: string, anchor: PromptOrderAnchor): string {
  // Keys are seeded for the WHOLE collection before the anchor is resolved.
  //
  // Without this, a move against a neighbour that has no key yet produced the wrong order:
  // unkeyed rows sort last (`compareOrderKeysEmptyLast`), so "put B before A" computed A's
  // previous as nothing and appended B — the list came back unchanged or reversed. Verified:
  // `expected [a,b] to deeply equal [b,a]` failed here before this seeding. Seeding first
  // makes every row's position concrete, which is also what the source's `applyMoves` assumes
  // (it operates on a fully-keyed table).
  const existing = orderedPromptAssetIds(db)
  const missing = existing.filter(candidate => readPromptOrderKey(db, candidate) === null)
  if (missing.length > 0) {
    const keys = evenlySpacedKeys(existing.length)
    existing.forEach((candidate, index) => writePromptOrderKey(db, candidate, keys[index]))
  }

  const ordered = orderedPromptAssetIds(db).filter(candidate => candidate !== id)
  let previousId: string | null = null
  let nextId: string | null = null

  if ('position' in anchor) {
    if (anchor.position === 'last') previousId = ordered.length ? ordered[ordered.length - 1] : null
    else nextId = ordered.length ? ordered[0] : null
  } else {
    const anchorId = 'before' in anchor ? anchor.before : anchor.after
    const anchorIndex = ordered.indexOf(anchorId)
    if (anchorIndex === -1) throw new Error('ORDER_ANCHOR_NOT_FOUND: 排序锚点不存在')
    if ('before' in anchor) {
      previousId = anchorIndex > 0 ? ordered[anchorIndex - 1] : null
      nextId = ordered[anchorIndex]
    } else {
      previousId = ordered[anchorIndex]
      nextId = anchorIndex + 1 < ordered.length ? ordered[anchorIndex + 1] : null
    }
  }

  let previousKey = previousId ? readPromptOrderKey(db, previousId) : null
  let nextKey = nextId ? readPromptOrderKey(db, nextId) : null

  if (!hasRoomBetween(previousKey, nextKey)) {
    // Rebalance the whole collection with evenly spaced keys, exactly as the other ordered
    // resources do when the gap between neighbours is exhausted.
    const ids = orderedPromptAssetIds(db)
    const keys = evenlySpacedKeys(ids.length)
    ids.forEach((candidate, index) => writePromptOrderKey(db, candidate, keys[index]))
    previousKey = previousId ? readPromptOrderKey(db, previousId) : null
    nextKey = nextId ? readPromptOrderKey(db, nextId) : null
    if (!hasRoomBetween(previousKey, nextKey)) throw new Error('ORDER_REBALANCE_FAILED: 无法为该位置分配排序键')
  }

  const orderKey = orderKeyBetween(previousKey, nextKey)
  writePromptOrderKey(db, id, orderKey)
  return orderKey
}
