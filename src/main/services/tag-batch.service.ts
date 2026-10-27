// 魔导书 Grimoire v7 — 资产标签批量操作（dry-run 预览 / 分块执行）
// BDTM-style batch suite over the tag→asset query: add / remove / replace with
// dry-run previews and chunked execution. BDTM's position options apply to
// ordered tag files; asset_tag_links stores no order, so position is
// intentionally unsupported here (prompt-side ordering lives in the composer).
import type { LegacyDatabase } from './sqlite.compat'
import { queryAssetKeysByTags, type AssetTagFilter } from './tag-asset-query.service'
import { batchAssignAssetTags, batchRemoveAssetTags } from './tag-intelligence.service'

export type TagBatchOperation =
  | { type: 'add'; tagIds: string[] }
  | { type: 'remove'; tagIds: string[] }
  | { type: 'replace'; fromTagId: string; toTagId: string }

export interface TagBatchInput {
  filter: AssetTagFilter
  operation: TagBatchOperation
  /** Restrict to assets that currently have zero accepted tags of this type. */
  onlyEmpty?: boolean
  sampleLimit?: number
  chunkSize?: number
}

export interface TagBatchPreview {
  total: number
  sample: string[]
  /** Estimated link writes: add = total × tagIds, remove/replace = total. */
  operationCount: number
}

export interface TagBatchResult {
  total: number
  applied: number
  tagsTouched: string[]
}

const KEY_SCAN_CAP = 50_000

function requireIds(values: unknown): string[] {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))]
}

function collectMatchedKeys(db: LegacyDatabase, filter: AssetTagFilter): string[] {
  const keys: string[] = []
  let offset = 0
  while (keys.length < KEY_SCAN_CAP) {
    const page = queryAssetKeysByTags(db, filter, { limit: 800, offset })
    keys.push(...page.keys.map(entry => entry.assetKey))
    if (page.keys.length === 0 || keys.length >= page.total) break
    offset += page.keys.length
  }
  return keys
}

/** Registry keys for an asset type; used as the base scope for onlyEmpty. */
function collectRegistryKeys(db: LegacyDatabase, assetType: string): string[] {
  if (assetType === 'image') {
    return (db.exec('SELECT id FROM image_refs')[0]?.values || []).map(row => 'image:' + String(row[0]))
  }
  if (assetType === 'prompt') {
    return (db.exec("SELECT id FROM prompt_assets WHERE source='asset'")[0]?.values || []).map(row => 'prompt:' + String(row[0]))
  }
  return []
}

/**
 * onlyEmpty targets assets that carry no accepted links, which by definition
 * cannot match a tag filter; its base scope is therefore the asset registry
 * (image_refs / prompt_assets). A tag filter is still applied as an
 * intersection when provided.
 */
function collectBaseKeys(db: LegacyDatabase, filter: AssetTagFilter, onlyEmpty: boolean): string[] {
  if (!onlyEmpty) return collectMatchedKeys(db, filter)
  let keys = collectRegistryKeys(db, filter.assetType)
  if (filter.tagIds?.length) {
    const matched = new Set(collectMatchedKeys(db, filter))
    keys = keys.filter(key => matched.has(key))
  }
  return keys
}

function filterEmptyKeys(db: LegacyDatabase, assetType: string, keys: string[]): string[] {
  if (!keys.length) return []
  const withAny = new Set<string>()
  for (let start = 0; start < keys.length; start += 400) {
    const chunk = keys.slice(start, start + 400)
    const rows = db.exec(
      `SELECT DISTINCT asset_key FROM asset_tag_links WHERE asset_type=? AND status='accepted' AND asset_key IN (${chunk.map(() => '?').join(',')})`,
      [assetType, ...chunk],
    )[0]?.values || []
    for (const row of rows) withAny.add(String(row[0]))
  }
  return keys.filter(key => !withAny.has(key))
}

function validateOperation(operation: TagBatchOperation): { tagIds: string[]; replaceTo?: string } {
  if (operation.type === 'add' || operation.type === 'remove') {
    const tagIds = requireIds(operation.tagIds)
    if (!tagIds.length) throw new Error('批量操作需要至少一个标签')
    return { tagIds }
  }
  const fromTagId = String(operation.fromTagId || '').trim()
  const toTagId = String(operation.toTagId || '').trim()
  if (!fromTagId || !toTagId) throw new Error('替换操作需要源标签和目标标签')
  if (fromTagId === toTagId) throw new Error('替换操作的源标签和目标标签不能相同')
  return { tagIds: [fromTagId], replaceTo: toTagId }
}

export function previewTagBatch(db: LegacyDatabase, input: TagBatchInput): TagBatchPreview {
  const { tagIds } = validateOperation(input.operation)
  let keys = collectBaseKeys(db, input.filter, Boolean(input.onlyEmpty))
  if (input.onlyEmpty) keys = filterEmptyKeys(db, input.filter.assetType, keys)
  const sampleLimit = Math.max(1, Math.min(50, Math.floor(Number(input.sampleLimit) || 10)))
  const operationCount = input.operation.type === 'add' ? keys.length * tagIds.length : keys.length
  return { total: keys.length, sample: keys.slice(0, sampleLimit), operationCount }
}

export function applyTagBatch(db: LegacyDatabase, input: TagBatchInput): TagBatchResult {
  const { tagIds, replaceTo } = validateOperation(input.operation)
  const assetType = input.filter.assetType
  let keys = collectBaseKeys(db, input.filter, Boolean(input.onlyEmpty))
  if (input.onlyEmpty) keys = filterEmptyKeys(db, assetType, keys)
  const chunkSize = Math.max(1, Math.min(2000, Math.floor(Number(input.chunkSize) || 500)))
  let applied = 0
  for (let start = 0; start < keys.length; start += chunkSize) {
    const chunk = keys.slice(start, start + chunkSize)
    if (input.operation.type === 'add') {
      batchAssignAssetTags(db, { assetType, assetKeys: chunk, tagIds, source: 'batch' })
    } else if (input.operation.type === 'remove') {
      batchRemoveAssetTags(db, { assetType, assetKeys: chunk, tagIds })
    } else {
      // Replace keeps the exclusive semantics: assign the target first, then
      // drop the source link.
      batchAssignAssetTags(db, { assetType, assetKeys: chunk, tagIds: [replaceTo!], source: 'batch' })
      batchRemoveAssetTags(db, { assetType, assetKeys: chunk, tagIds })
    }
    applied += chunk.length
  }
  return {
    total: keys.length,
    applied,
    tagsTouched: input.operation.type === 'replace' ? [tagIds[0], replaceTo!] : tagIds,
  }
}