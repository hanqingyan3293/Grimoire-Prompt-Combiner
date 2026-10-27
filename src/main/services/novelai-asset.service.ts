import crypto from 'node:crypto'

import { getDatabase, saveDatabase } from '../database'

// NovelAI asset library (M6.4). Assets are reusable prompt material (characters, styles, scenes);
// `novelai_asset_usage` answers 「这块用在哪些图」 and 「这张图用了哪些素材」 without scanning text.
export type NovelaiAssetKind = 'character' | 'style' | 'scene' | 'object' | 'other'

export interface NovelaiAsset {
  id: string
  kind: NovelaiAssetKind
  name: string
  payload: string
  examples: string[]
  createdAt: string
  updatedAt: string
  uses: number
}

export class NovelaiAssetError extends Error {
  constructor(readonly code: 'ASSET_NOT_FOUND' | 'ASSET_IN_USE' | 'INVALID_INPUT', message: string) {
    super(message)
    this.name = 'NovelaiAssetError'
  }
}

const now = (): string => new Date().toISOString()
const assetId = (): string => 'nai_a_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24)
const KINDS: readonly NovelaiAssetKind[] = ['character', 'style', 'scene', 'object', 'other']

function cleanName(value: unknown): string {
  if (typeof value !== 'string') throw new NovelaiAssetError('INVALID_INPUT', 'name must be a string')
  const name = value.trim()
  if (!name || name.length > 120) throw new NovelaiAssetError('INVALID_INPUT', 'name is empty or too long')
  return name
}

function rowToAsset(row: unknown[]): NovelaiAsset {
  let examples: string[] = []
  try { const parsed = JSON.parse(String(row[4])); if (Array.isArray(parsed)) examples = parsed.filter(item => typeof item === 'string') } catch {}
  return {
    id: String(row[0]),
    kind: String(row[1]) as NovelaiAssetKind,
    name: String(row[2]),
    payload: String(row[3]),
    examples,
    createdAt: String(row[5]),
    updatedAt: String(row[6]),
    uses: Number(row[7] ?? 0),
  }
}

const SELECT_ASSET = `SELECT a.id,a.kind,a.name,a.payload,a.examples,a.created_at,a.updated_at,
  (SELECT count(*) FROM novelai_asset_usage u WHERE u.asset_id=a.id) AS uses FROM novelai_asset a`

export function createNovelaiAsset(input: { kind: NovelaiAssetKind; name: string; payload?: string; examples?: string[] }): NovelaiAsset {
  if (!KINDS.includes(input.kind)) throw new NovelaiAssetError('INVALID_INPUT', 'unknown asset kind')
  const name = cleanName(input.name)
  const id = assetId()
  const stamp = now()
  getDatabase().run('INSERT INTO novelai_asset (id,kind,name,payload,examples,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', [
    id, input.kind, name, typeof input.payload === 'string' ? input.payload : '', JSON.stringify(Array.isArray(input.examples) ? input.examples : []), stamp, stamp,
  ])
  saveDatabase()
  return getNovelaiAsset(id)!
}

export function getNovelaiAsset(id: string): NovelaiAsset | null {
  const row = getDatabase().exec(SELECT_ASSET + ' WHERE a.id=?', [id])[0]?.values?.[0]
  return row ? rowToAsset(row) : null
}

export function listNovelaiAssets(kind?: NovelaiAssetKind): NovelaiAsset[] {
  const rows = kind
    ? getDatabase().exec(SELECT_ASSET + ' WHERE a.kind=? ORDER BY a.name ASC, a.id ASC', [kind])[0]?.values ?? []
    : getDatabase().exec(SELECT_ASSET + ' ORDER BY a.kind ASC, a.name ASC, a.id ASC')[0]?.values ?? []
  return rows.map(rowToAsset)
}

export function updateNovelaiAsset(id: string, patch: { name?: string; payload?: string; examples?: string[]; kind?: NovelaiAssetKind }): NovelaiAsset {
  const current = getNovelaiAsset(id)
  if (!current) throw new NovelaiAssetError('ASSET_NOT_FOUND', 'asset not found')
  const kind = patch.kind ?? current.kind
  if (!KINDS.includes(kind)) throw new NovelaiAssetError('INVALID_INPUT', 'unknown asset kind')
  getDatabase().run('UPDATE novelai_asset SET kind=?, name=?, payload=?, examples=?, updated_at=? WHERE id=?', [
    kind,
    patch.name === undefined ? current.name : cleanName(patch.name),
    patch.payload === undefined ? current.payload : String(patch.payload),
    JSON.stringify(patch.examples === undefined ? current.examples : patch.examples),
    now(),
    id,
  ])
  saveDatabase()
  return getNovelaiAsset(id)!
}

/** Removing an asset that still has usages is refused by default: the caller must pass `force`,
 * which also removes the usage rows. Silently deleting usage would break 「这块用在哪些图」. */
export function deleteNovelaiAsset(id: string, options: { force?: boolean } = {}): void {
  const asset = getNovelaiAsset(id)
  if (!asset) throw new NovelaiAssetError('ASSET_NOT_FOUND', 'asset not found')
  if (asset.uses > 0 && !options.force) throw new NovelaiAssetError('ASSET_IN_USE', 'asset is used by ' + asset.uses + ' image(s)')
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.run('DELETE FROM novelai_asset_usage WHERE asset_id=?', [id])
    db.run('DELETE FROM novelai_asset WHERE id=?', [id])
    db.exec('COMMIT')
    saveDatabase()
  } catch (error) {
    try { db.exec('ROLLBACK') } catch {}
    throw error
  }
}

export function recordNovelaiAssetUsage(input: { assetId: string; imageId: string; via?: string }): void {
  const asset = getNovelaiAsset(input.assetId)
  if (!asset) throw new NovelaiAssetError('ASSET_NOT_FOUND', 'asset not found')
  if (typeof input.imageId !== 'string' || !input.imageId) throw new NovelaiAssetError('INVALID_INPUT', 'imageId is required')
  getDatabase().run('INSERT INTO novelai_asset_usage (asset_id,image_id,via,used_at) VALUES (?,?,?,?) ON CONFLICT(asset_id,image_id) DO UPDATE SET used_at=excluded.used_at, via=excluded.via', [
    input.assetId, input.imageId, input.via ?? '', now(),
  ])
  saveDatabase()
}

export function removeNovelaiAssetUsage(assetId: string, imageId: string): void {
  getDatabase().run('DELETE FROM novelai_asset_usage WHERE asset_id=? AND image_id=?', [assetId, imageId])
  saveDatabase()
}

/** 「这块素材用在哪些图」 */
export function listImagesUsingAsset(assetId: string): Array<{ imageId: string; via: string; usedAt: string }> {
  const rows = getDatabase().exec('SELECT image_id, via, used_at FROM novelai_asset_usage WHERE asset_id=? ORDER BY used_at DESC, image_id ASC', [assetId])[0]?.values ?? []
  return rows.map(row => ({ imageId: String(row[0]), via: String(row[1]), usedAt: String(row[2]) }))
}

/** 「这张图用了哪些素材」 */
export function listAssetsUsedByImage(imageId: string): NovelaiAsset[] {
  const ids = (getDatabase().exec('SELECT asset_id FROM novelai_asset_usage WHERE image_id=? ORDER BY used_at DESC', [imageId])[0]?.values ?? []).map(row => String(row[0]))
  return ids.map(id => getNovelaiAsset(id)).filter((asset): asset is NovelaiAsset => asset !== null)
}

export function countNovelaiVersionReferences(imageId: string): number {
  return Number(getDatabase().exec('SELECT count(*) FROM novelai_version_image WHERE image_id=?', [imageId])[0]?.values?.[0]?.[0] ?? 0)
}

/** F8: refuse permanent image deletion while a version still references it. */
export function assertNovelaiImageRemovable(imageId: string): void {
  const references = countNovelaiVersionReferences(imageId)
  if (references > 0) throw new NovelaiAssetError('ASSET_IN_USE', 'image is referenced by ' + references + ' version(s)')
}
