import type { LegacyDatabase } from './sqlite.compat'
import type { PromptAssetCategory, PromptAssetItem, PromptAssetPage, PromptAssetQuery, PromptAssetSourceFilter } from '../../shared/prompt-asset-types'
import type { PresetData } from '../../shared/types'
import { requireText } from './input-validation'
import crypto from 'crypto'
import { saveDatabase } from '../database'
import { compareOrderKeysEmptyLast, evenlySpacedKeys, hasRoomBetween, orderKeyBetween } from './resource-order'
import { createTagSuggestions } from './tag-intelligence.service'
import { localAssetCoverUrl } from './default-prompt-assets.service'

const SOURCES = new Set<PromptAssetSourceFilter>(['all', 'asset', 'history', 'preset', 'favorite'])

const UNIFIED_QUERY = `
WITH unified AS (
  SELECT
    'asset:' || id AS id, id AS source_ref, 'asset' AS source, name, prompt,
    source_id AS asset_source_id,
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
    'history:' || id, id, 'history', substr(replace(prompt, char(10), ' '), 1, 80), prompt, NULL,
    '正面 ' || positive_count || ' · 负面 ' || negative_count, '历史', NULL, NULL, created_at, 0, 0,
    'global'
  FROM history
  UNION ALL
  SELECT
    'preset:' || p.id, p.id, 'preset', p.name,
    coalesce((SELECT group_concat(t.en, ', ') FROM json_each(p.data, '$.positive') j JOIN tags t ON t.id = json_extract(j.value, '$.tag_id')), '') ||
    CASE WHEN EXISTS (SELECT 1 FROM json_each(p.data, '$.negative')) THEN char(10) || '--neg ' || coalesce((SELECT group_concat(t.en, ', ') FROM json_each(p.data, '$.negative') j JOIN tags t ON t.id = json_extract(j.value, '$.tag_id')), '') ELSE '' END,
    NULL,
    '提示词预设', '预设', NULL, p.data, p.updated_at, 0, 0,
    'global'
  FROM presets p
  WHERE json_valid(p.data)
  UNION ALL
  SELECT
    'favorite:' || t.id, t.id, 'favorite', coalesce(nullif(t.zh, ''), t.en), t.en, NULL,
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
      const sourceRef = String(row.source_ref)
      return {
        id: String(row.id),
        sourceRef,
        source,
        name: String(row.name || ''),
        prompt: String(row.prompt || ''),
        detail: String(row.detail || ''),
        coverUrl: source === 'asset' ? localAssetCoverUrl(String(row.asset_source_id || '')) : undefined,
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

export type PromptAssetVisibility = 'global' | 'restricted'

export type PromptAssetBindingTarget = {
  type: 'assistant' | 'agent'
  id: string
}

/** A validation or concurrent-modification failure the DataApi adapter maps to 4xx. */
export class PromptAssetUpdateError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(code + ': ' + message)
    this.name = 'PromptAssetUpdateError'
  }
}

function promptVisibility(value: unknown): PromptAssetVisibility {
  if (value === 'global' || value === 'restricted') return value
  throw new PromptAssetUpdateError(400, 'INVALID_VISIBILITY', '提示词可见性必须是 global 或 restricted')
}

function promptBindingTargets(value: unknown): PromptAssetBindingTarget[] {
  if (!Array.isArray(value)) {
    throw new PromptAssetUpdateError(400, 'INVALID_EXPECTED_BINDINGS', 'expectedBindings 必须是绑定目标数组')
  }
  return value.map(target => {
    const record = target && typeof target === 'object' && !Array.isArray(target) ? target as Record<string, unknown> : null
    if (!record || (record.type !== 'assistant' && record.type !== 'agent') || typeof record.id !== 'string' || record.id.length === 0) {
      throw new PromptAssetUpdateError(400, 'INVALID_EXPECTED_BINDINGS', 'expectedBindings 的每一项都需要 type 与 id')
    }
    return { type: record.type, id: record.id }
  })
}

function bindingTargetKey(target: PromptAssetBindingTarget): string {
  return target.type + ':' + target.id
}

/**
 * The stored-id forms a binding row may use for one prompt.
 *
 * Bindings are written from the source-visible id, while this service is called with the
 * stored row id. The list projection is `'asset:' || id`, so a user-created row can be
 * addressed as `asset:<uuid>` (create response) or `asset:asset:<uuid>` (list); a binding
 * made through either path must be counted and cleared for the same prompt.
 */
function promptIdForms(id: string): string[] {
  const forms = new Set<string>([id, 'asset:' + id])
  if (id.startsWith('asset:')) forms.add(id.slice('asset:'.length))
  return [...forms]
}

function readPromptBindingTargets(db: LegacyDatabase, id: string): PromptAssetBindingTarget[] {
  const forms = promptIdForms(id)
  const rows = db.exec(
    'SELECT target_type, target_id FROM cherry_prompt_bindings WHERE prompt_id IN (' + forms.map(() => '?').join(',') + ')',
    forms
  )[0]?.values || []
  return rows.map(row => ({ type: String(row[0]) as PromptAssetBindingTarget['type'], id: String(row[1]) }))
}

function clearPromptBindings(db: LegacyDatabase, id: string): void {
  const forms = promptIdForms(id)
  db.run(
    'DELETE FROM cherry_prompt_bindings WHERE prompt_id IN (' + forms.map(() => '?').join(',') + ')',
    forms
  )
}

function promptAssetFromRow(row: Record<string, unknown>): PromptAssetItem {
  return {
    id: String(row.id), sourceRef: String(row.source_id), source: 'asset',
    name: String(row.name || ''), prompt: String(row.prompt || ''), detail: String(row.chapter || ''),
    createdAt: String(row.created_at || ''),
    visibility: row.visibility === 'restricted' ? 'restricted' : 'global',
    nsfw: Number(row.nsfw) === 1, variantCount: Number(row.variant_count) || 0
  }
}

export function createPromptAsset(db: LegacyDatabase, input: unknown, visibility: PromptAssetVisibility = 'global'): PromptAssetItem {
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
  return { id, sourceRef: sourceId, source: 'asset', name, prompt, detail, createdAt: now, visibility, nsfw: value.nsfw === true, variantCount: Number.isInteger(value.variantCount) ? Math.max(0, Number(value.variantCount)) : 0 }
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

export type PromptAssetUpdatePatch = {
  name?: unknown
  prompt?: unknown
  visibility?: unknown
  expectedBindings?: unknown
}

/**
 * Updates a user-created prompt asset's name, prompt text, and/or visibility.
 *
 * Ports `PromptService.update` (source lines 336-393) onto Grimoire's v29 columns:
 *
 *  - only supplied fields change, and the stored row is re-read before returning, so the
 *    caller receives the stored DTO (including `visibility`) rather than its own input;
 *  - making a `restricted` prompt `global` requires the `expectedBindings` snapshot when the
 *    prompt currently has bindings, and any mismatch is a concurrent-modification conflict;
 *  - a successful restricted→global transition clears the prompt's bindings, because a
 *    global prompt is visible everywhere and the edges no longer describe anything;
 *  - updating to/staying `restricted` leaves existing bindings untouched and never invents
 *    targets. The source has no implicit target for a restricted prompt.
 *
 * The guard, visibility write, binding clear, and re-read run in one write transaction, so a
 * failure cannot leave a global row with stale bindings or a restricted row with cleared ones.
 *
 * Scoped to `source='asset'`: built-in and imported rows are not user-owned, and the source
 * likewise only lets a user edit prompts they created. Returns `null` for a missing or
 * non-editable row so the caller can answer a real 404/403 instead of an empty success.
 */
export function updatePromptAsset(db: LegacyDatabase, idValue: unknown, patch: PromptAssetUpdatePatch): PromptAssetItem | null {
  const id = requireText(idValue ?? '', '提示词资产 ID', 500)
  const nextVisibility = patch.visibility === undefined ? undefined : promptVisibility(patch.visibility)
  let expectedKeys: string[] | undefined
  if (patch.expectedBindings !== undefined) {
    if (nextVisibility !== 'global') {
      throw new PromptAssetUpdateError(400, 'INVALID_EXPECTED_BINDINGS', 'expectedBindings 只能在把提示词设为 global 时提供')
    }
    expectedKeys = promptBindingTargets(patch.expectedBindings).map(bindingTargetKey).sort()
  }
  const nextName = patch.name === undefined ? undefined : requireText(patch.name, '资产名称', 500)
  // The source caps prompt content at 100,000 characters (`PromptContentSchema`); the same
  // bound is enforced here so a save cannot store something the client would refuse to render.
  const nextPrompt = patch.prompt === undefined ? undefined : requireText(patch.prompt, '资产提示词', 100_000)

  db.exec('BEGIN IMMEDIATE')
  try {
    const row = db.prepare('SELECT id, source_id, source, name, prompt, chapter, created_at, nsfw, variant_count, visibility FROM prompt_assets WHERE id=?').get([id])
    if (!row) {
      db.exec('ROLLBACK')
      return null
    }
    // `source='asset'` is NOT a user-created discriminator: every imported/built-in row also
    // carries it (all 1,742 on this machine do). The real marker is the id the service itself
    // mints — `createPromptAsset` writes `asset:<uuid>` while imports keep `builtin_<hex>` /
    // their original id. Checking `source` alone let a built-in prompt be edited, which a live
    // probe caught (`builtinEdit: 200`).
    // The id prefix catches imported rows that carry `source='asset'`; the source check also
    // catches legacy index rows, which are imported too even though their ids look generic.
    if (String(row.source) !== 'asset' || isImportedPromptRow(id)) {
      db.exec('ROLLBACK')
      return null
    }

    const storedVisibility: PromptAssetVisibility = row.visibility === 'restricted' ? 'restricted' : 'global'
    const makingGlobal = storedVisibility === 'restricted' && nextVisibility === 'global'
    if (makingGlobal) {
      // The two accepted prompt-id forms can each hold the same logical edge; the source
      // snapshot is a set of targets, so compare (and later clear) in target space.
      const actualKeys = [...new Set(readPromptBindingTargets(db, id).map(bindingTargetKey))].sort()
      const exactSnapshot = expectedKeys !== undefined &&
        expectedKeys.length === actualKeys.length &&
        expectedKeys.every((key, index) => key === actualKeys[index])
      if ((actualKeys.length > 0 && expectedKeys === undefined) || (expectedKeys !== undefined && !exactSnapshot)) {
        throw new PromptAssetUpdateError(409, 'PROMPT_BINDINGS_CONFLICT', '提示词绑定已变化，请刷新后重试')
      }
    }

    const sets: string[] = []
    const params: unknown[] = []
    if (nextName !== undefined) { sets.push('name=?'); params.push(nextName) }
    if (nextPrompt !== undefined) { sets.push('prompt=?'); params.push(nextPrompt) }
    if (nextVisibility !== undefined) { sets.push('visibility=?'); params.push(nextVisibility) }
    if (sets.length === 0) {
      // Nothing to change: answer the current stored row rather than issuing an empty UPDATE.
      db.exec('COMMIT')
      return promptAssetFromRow(row)
    }

    sets.push('updated_at=?')
    params.push(new Date().toISOString())
    // `source_fingerprint` is derived from the mutable fields in `createPromptAsset`; leaving
    // it stale after an edit would make the same fingerprint describe two different prompts.
    const storedName = nextName ?? String(row.name || '')
    const storedPrompt = nextPrompt ?? String(row.prompt || '')
    sets.push('source_fingerprint=?')
    params.push(crypto.createHash('sha256').update(`${String(row.source_id)}:${storedName}:${storedPrompt}`).digest('hex'))

    db.run(`UPDATE prompt_assets SET ${sets.join(', ')} WHERE id=?`, [...params, id])
    if (makingGlobal) clearPromptBindings(db, id)

    const stored = db.prepare('SELECT id, source_id, name, prompt, chapter, created_at, nsfw, variant_count, visibility FROM prompt_assets WHERE id=?').get([id])
    if (!stored) throw new Error('提示词更新后不存在')
    db.exec('COMMIT')
    return promptAssetFromRow(stored)
  } catch (error) {
    try { db.exec('ROLLBACK') } catch {}
    throw error
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
