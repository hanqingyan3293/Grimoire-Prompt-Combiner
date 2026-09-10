import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getDatabase, saveDatabase } from '../database'

const IMPORT_MARKER = 'default_prompt_assets_local_v1'
const CATEGORY_MARKER = 'default_prompt_asset_categories_v6'
const SOURCES = [
  ['banana-prompt-quicker', 'Banana Prompt Quicker'],
  ['davidwu-gpt-image2-prompts', 'DavidWu GPT Image 2'],
  ['freestylefly-gpt-image-2', 'Freestylefly GPT Image 2'],
  ['awesome-gpt-image', 'Awesome GPT Image'],
  ['awesome-gpt4o-image-prompts', 'Awesome GPT-4o'],
  ['youmind-gpt-image-2', 'YouMind GPT Image 2'],
  ['youmind-nano-banana-pro', 'YouMind Nano Banana Pro'],
] as const

type RawPrompt = { id?: unknown; title?: unknown; prompt?: unknown; description?: unknown; detail?: unknown; tags?: unknown; variantCount?: unknown }

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function stableId(sourceId: string, itemId: string): string {
  return ('builtin:' + sourceId + ':' + itemId).slice(0, 500)
}

function readSource(assetDirectory: string, sourceId: string): RawPrompt[] {
  const filePath = path.join(assetDirectory, sourceId + '.json')
  if (!fs.existsSync(filePath)) return []
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown
  return Array.isArray(data) ? data as RawPrompt[] : []
}

export async function importDefaultPromptAssets(assetDirectory: string): Promise<number> {
  const db = getDatabase()
  const marker = db.prepare('SELECT value FROM schema_meta WHERE key=?').get([IMPORT_MARKER]) as { value?: string } | undefined
  if (marker?.value === 'complete') return 0

  const results = SOURCES.map(([sourceId, sourceName]) => ({ sourceId, sourceName, items: readSource(assetDirectory, sourceId) }))
  if (!results.some(result => result.items.length > 0)) return 0
  const insert = db.prepare('INSERT OR IGNORE INTO prompt_assets (id, source_id, source, name, prompt, chapter, section, subsection, nsfw, variant_count, source_fingerprint, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
  let added = 0
  for (const result of results) {
    for (const [index, item] of result.items.entries()) {
      const name = text(item.title)
      const prompt = text(item.prompt)
      if (!name || !prompt) continue
      const itemId = text(item.id) || String(index + 1).padStart(4, '0')
      const sourceRef = stableId(result.sourceId, itemId)
      const detail = text(item.description) || text(item.detail) || result.sourceName
      const tags = Array.isArray(item.tags) ? item.tags.map(text).filter(Boolean) : []
      const now = new Date().toISOString()
      const fingerprint = crypto.createHash('sha256').update(sourceRef + ':' + name + ':' + prompt).digest('hex')
      const inserted = insert.run([
        'builtin_' + crypto.createHash('sha256').update(sourceRef).digest('hex').slice(0, 24),
        sourceRef, 'asset', name, prompt, detail, result.sourceName, tags.join(' / '), '', 0,
        Number.isInteger(item.variantCount) ? Math.max(0, Number(item.variantCount)) : 0,
        fingerprint, now, now,
      ])
      added += Number(inserted.changes || 0)
    }
  }
  db.run('INSERT OR REPLACE INTO schema_meta (key,value) VALUES (?,?)', [IMPORT_MARKER, 'complete'])
  saveDatabase()
  return added
}

export function seedDefaultPromptAssetCategories(): number {
  const db = getDatabase()
  const marker = db.prepare('SELECT value FROM schema_meta WHERE key=?').get([CATEGORY_MARKER]) as { value?: string } | undefined
  if (marker?.value === 'complete') return 0
  const assetDirectory = assetDirectoryForMigration()
  const sourceData = SOURCES.map(([sourceId]) => ({ sourceId, items: readSource(assetDirectory, sourceId) }))
  if (!sourceData.some(source => source.items.length > 0)) return 0
  const sourceRows = db.prepare("SELECT id, source_id FROM prompt_assets WHERE source='asset' AND source_id LIKE 'builtin:%'").all([])
  db.run('DELETE FROM prompt_asset_category_links WHERE category_id IN (SELECT id FROM prompt_asset_categories WHERE is_builtin=1)')
  db.run('DELETE FROM prompt_asset_categories WHERE is_builtin=1')
  const sourceByAssetId = new Map(sourceRows.map(row => [String(row.source_id), String(row.id)]))
  const tagBySourceRef = new Map<string, string[]>()
  for (const { sourceId, items } of sourceData) {
    for (const [index, item] of items.entries()) {
      const itemId = text(item.id) || String(index + 1).padStart(4, '0')
      const ref = stableId(sourceId, itemId)
      const tags = Array.isArray(item.tags) ? item.tags.map(text).filter(Boolean) : []
      tagBySourceRef.set(ref, tags)
    }
  }
  const cache = new Map<string, string>()
  const now = new Date().toISOString()
  const ensure = (name: string, parentId: string | null): string => {
    const key = (parentId || 'root') + ':' + name
    const cached = cache.get(key)
    if (cached) return cached
    const existing = db.prepare('SELECT id FROM prompt_asset_categories WHERE parent_id IS ? AND source_scope=? AND name=?').get([parentId, 'asset', name]) as { id?: string } | undefined
    const id = existing?.id || 'builtin_cat_' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 24)
    if (!existing) db.run('INSERT OR IGNORE INTO prompt_asset_categories (id,parent_id,name,source_scope,sort_order,is_builtin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', [id, parentId, name, 'asset', 0, 1, now, now])
    cache.set(key, id)
    return id
  }
  let linked = 0
  for (const [sourceRef, assetId] of sourceByAssetId) {
    const sourceId = sourceRef.split(':')[1] || 'builtin'
    const sourceName = SOURCES.find(([id]) => id === sourceId)?.[1] || sourceId
    const root = ensure(sourceName, null)
    const tags = tagBySourceRef.get(sourceRef) || []
    for (const tag of (tags.length ? tags : ["未分类"])) {
      const category = tag === '未分类' ? root : ensure(tag, root)
      const result = db.run('INSERT OR IGNORE INTO prompt_asset_category_links (asset_id,category_id,created_at) VALUES (?,?,?)', [assetId, category, now])
      linked += Number(result.changes || 0)
    }
  }
  db.run("DELETE FROM schema_meta WHERE key IN ('default_prompt_asset_categories_v3','default_prompt_asset_categories_v4','default_prompt_asset_categories_v5')")
  db.run('INSERT OR REPLACE INTO schema_meta (key,value) VALUES (?,?)', [CATEGORY_MARKER, 'complete'])
  saveDatabase()
  return linked
}

function assetDirectoryForMigration() {
  const candidates = [
    path.join(process.cwd(), 'data/default-prompt-assets'),
    path.join(__dirname, '../../../../data/default-prompt-assets'),
    path.join(process.resourcesPath, 'data/default-prompt-assets'),
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0]
}
