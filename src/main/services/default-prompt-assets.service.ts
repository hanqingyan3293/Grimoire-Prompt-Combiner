import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getDatabase, saveDatabase } from '../database'
import { LOCAL_ASSET_HOST, LOCAL_ASSET_SCHEME } from './local-asset-protocol.service'

const IMPORT_MARKER = 'default_prompt_assets_local_v2'
const CATEGORY_MARKER = 'default_prompt_asset_categories_v10'
export const MOSS_SOURCE_ID = 'moss-character'
export const MOSS_SOURCE_NAME = 'MOSS 角色与风格图鉴'
const SOURCES = [
  ['banana-prompt-quicker', '香蕉提示词加速器'],
  ['davidwu-gpt-image2-prompts', 'DavidWu GPT 图像提示词'],
  ['freestylefly-gpt-image-2', '自由飞 GPT 图像提示词'],
  ['awesome-gpt-image', '精选 GPT 图像提示词'],
  ['awesome-gpt4o-image-prompts', '精选 GPT-4o 提示词'],
  ['youmind-gpt-image-2', 'YouMind GPT 图像提示词'],
  ['youmind-nano-banana-pro', 'YouMind Nano Banana Pro 提示词'],
  [MOSS_SOURCE_ID, MOSS_SOURCE_NAME],
] as const

type RawPrompt = { id?: unknown; title?: unknown; prompt?: unknown; description?: unknown; detail?: unknown; tags?: unknown; variantCount?: unknown; coverUrl?: unknown }

/** Browsing shelves, in priority order.
 *
 * The shipped sources carry 568 distinct free-text tags. Using them verbatim as categories produced
 * hundreds of one-asset shelves, and a re-import left shelves with links to assets that no longer
 * existed — the "空类目" the user reported. Tags stay on the card (they are metadata); the tree now
 * groups by something a person browses for. First match wins, so an asset has exactly one primary
 * shelf and the tree cannot grow a leaf per source vocabulary. */
const ASSET_BUCKETS: { label: string; pattern: RegExp }[] = [
  { label: '角色', pattern: /角色|人物|人像|头像|人物设定|character|people|portrait|avatar|cosplay|gender:|hairlength:|hairlength|表情|神态/i },
  { label: '风格', pattern: /风格|画风|艺术|插画|illustration|art\b|anime|漫画|story|3d|paint|sketch|hand-?drawn|watercolou?r|punk|cyber|retro|vintage/i },
  { label: '场景', pattern: /场景|环境|建筑|室内|风光|城市|自然|scene|landscape|environment|architect|interior|travel|background/i },
  { label: '商品电商', pattern: /商品|电商|产品|主图|品牌|包装|product|commerce|e-?commerce|brand|logo|packaging|mockup/i },
  { label: '海报排版', pattern: /海报|排版|字体|封面|缩略图|poster|typograph|thumbnail|cover|banner|layout/i },
  { label: 'UI 界面', pattern: /ui|interface|界面|dashboard|app|web|hud|mock/i },
  { label: '信息图', pattern: /信息图|图表|infographic|chart|diagram|data-?viz|可视化/i },
  { label: '摄影写实', pattern: /摄影|写实|照片|photograph|photoreal|realistic|cinematic|film|镜头/i },
  { label: '生活趣味', pattern: /生活|美食|宠物|动物|有趣|创意|life|food|pet|animal|fun|creative|holiday|festival/i },
]
const ASSET_FALLBACK_BUCKET = '其他'
const PROMPT_COLLECTION_NAME = '提示词资产合集'

function classifyAsset(tags: readonly string[], name: string, prompt: string): string {
  // A tag that already names a shelf wins: sources such as MOSS ship curated 角色/风格 tags, and
  // letting free-text in the prompt override them moved two style entries into 角色.
  for (const tag of tags) {
    const exact = ASSET_BUCKETS.find(bucket => bucket.label === tag)
    if (exact) return exact.label
    if (tag === ASSET_FALLBACK_BUCKET) return ASSET_FALLBACK_BUCKET
  }
  const haystack = [tags.join(' '), name, prompt].join(' ')
  for (const bucket of ASSET_BUCKETS) if (bucket.pattern.test(haystack)) return bucket.label
  return ASSET_FALLBACK_BUCKET
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function stableId(sourceId: string, itemId: string): string {
  return ('builtin:' + sourceId + ':' + itemId).slice(0, 500)
}

/** The display contract for shipped MOSS images; the same URL is resolved by the image protocol. */
export function localAssetCoverUrl(sourceRef: string): string | undefined {
  const match = /^builtin:moss-character:demo-(\d{3})$/.exec(sourceRef)
  return match ? LOCAL_ASSET_SCHEME + '://' + LOCAL_ASSET_HOST + '/moss-character/' + match[1] + '.webp' : undefined
}

/** Packaged assets live in app.asar/dist/main/data; development reads the repository data directory. */
export function defaultPromptAssetRoot(options: { isPackaged: boolean; appPath: string; dirname: string }): string {
  return options.isPackaged
    ? path.join(options.appPath, 'dist', 'main', 'data', 'default-prompt-assets')
    : path.join(options.dirname, '../../../data/default-prompt-assets')
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
      // Column order matters: an extra empty string here (left over from an older schema with a
      // `tags` column) pushed every value one slot right and the import died with
      // "column index out of range" on every startup — silently, because the caller only logs.
      const inserted = insert.run([
        'builtin_' + crypto.createHash('sha256').update(sourceRef).digest('hex').slice(0, 24),
        sourceRef,
        'asset',
        name,
        prompt,
        detail,              // chapter
        result.sourceName,   // section
        tags.join(' / '),    // subsection
        0,                   // nsfw
        Number.isInteger(item.variantCount) ? Math.max(0, Number(item.variantCount)) : 0,
        fingerprint,
        now,
        now,
      ])
      added += Number(inserted.changes || 0)
    }
  }
  db.run('INSERT OR REPLACE INTO schema_meta (key,value) VALUES (?,?)', [IMPORT_MARKER, 'complete'])
  saveDatabase()
  return added
}

export function seedDefaultPromptAssetCategories(assetDirectory = assetDirectoryForMigration()): number {
  const db = getDatabase()
  const marker = db.prepare('SELECT value FROM schema_meta WHERE key=?').get([CATEGORY_MARKER]) as { value?: string } | undefined
  if (marker?.value === 'complete') return 0
  const sourceData = SOURCES.map(([sourceId]) => ({ sourceId, items: readSource(assetDirectory, sourceId) }))
  if (!sourceData.some(source => source.items.length > 0)) return 0
  const sourceRows = db.prepare("SELECT id, source_id FROM prompt_assets WHERE source='asset' AND source_id LIKE 'builtin:%'").all([])
  db.run('DELETE FROM prompt_asset_category_links WHERE category_id IN (SELECT id FROM prompt_asset_categories WHERE is_builtin=1)')
  db.run('DELETE FROM prompt_asset_categories WHERE is_builtin=1')
  const sourceByAssetId = new Map(sourceRows.map(row => [String(row.source_id), String(row.id)]))
  const metaBySourceRef = new Map<string, { tags: string[]; name: string; prompt: string }>()
  for (const { sourceId, items } of sourceData) {
    for (const [index, item] of items.entries()) {
      const itemId = text(item.id) || String(index + 1).padStart(4, '0')
      const ref = stableId(sourceId, itemId)
      const tags = Array.isArray(item.tags) ? item.tags.map(text).filter(Boolean) : []
      metaBySourceRef.set(ref, { tags, name: text(item.title), prompt: text(item.prompt) })
    }
  }
  const cache = new Map<string, string>()
  const now = new Date().toISOString()
  const findCategory = db.prepare('SELECT id FROM prompt_asset_categories WHERE parent_id IS ? AND source_scope=? AND name=?')
  const insertCategory = db.prepare('INSERT OR IGNORE INTO prompt_asset_categories (id,parent_id,name,source_scope,sort_order,is_builtin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
  const insertLink = db.prepare('INSERT OR IGNORE INTO prompt_asset_category_links (asset_id,category_id,created_at) VALUES (?,?,?)')
  const ensure = (name: string, parentId: string | null, order = 0): string => {
    const key = (parentId || 'root') + ':' + name
    const cached = cache.get(key)
    if (cached) return cached
    const existing = findCategory.get([parentId, 'asset', name]) as { id?: string } | undefined
    const id = existing?.id || 'builtin_cat_' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 24)
    if (!existing) insertCategory.run([id, parentId, name, 'asset', order, 1, now, now])
    cache.set(key, id)
    return id
  }
  let linked = 0
  db.run('BEGIN')
  try {
    for (const [sourceRef, assetId] of sourceByAssetId) {
      const sourceId = sourceRef.split(':')[1] || 'builtin'
      const sourceName = SOURCES.find(([id]) => id === sourceId)?.[1] || sourceId
      // One browsable collection instead of one root per upstream source; MOSS stays separate
      // because it is a curated character/style set rather than a prompt dump.
      const rootName = sourceId === MOSS_SOURCE_ID ? MOSS_SOURCE_NAME : PROMPT_COLLECTION_NAME
      const root = ensure(rootName, null)
      const meta = metaBySourceRef.get(sourceRef) || { tags: [], name: '', prompt: '' }
      const bucket = classifyAsset(meta.tags, meta.name, meta.prompt)
      const bucketOrder = ASSET_BUCKETS.findIndex(entry => entry.label === bucket) + 1
      const category = ensure(bucket, root, bucketOrder || ASSET_BUCKETS.length + 1)
      linked += Number(insertLink.run([assetId, category, now]).changes || 0)
      // The source shelf holds every asset of that source, so browsing by source still works and no
      // asset can become unreachable if a future classifier change drops its bucket.
      linked += Number(insertLink.run([assetId, root, now]).changes || 0)
    }
    db.run('COMMIT')
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  } finally {
    findCategory.free()
    insertCategory.free()
    insertLink.free()
  }
  db.run(`DELETE FROM prompt_asset_categories
    WHERE is_builtin=1
      AND NOT EXISTS (SELECT 1 FROM prompt_asset_category_links l WHERE l.category_id = prompt_asset_categories.id)
      AND NOT EXISTS (SELECT 1 FROM prompt_asset_categories child WHERE child.parent_id = prompt_asset_categories.id)`)
  db.run("DELETE FROM schema_meta WHERE key IN ('default_prompt_asset_categories_v3','default_prompt_asset_categories_v4','default_prompt_asset_categories_v5','default_prompt_asset_categories_v6','default_prompt_asset_categories_v7','default_prompt_asset_categories_v8')")
  db.run('INSERT OR REPLACE INTO schema_meta (key,value) VALUES (?,?)', [CATEGORY_MARKER, 'complete'])
  saveDatabase()
  return linked
}

function assetDirectoryForMigration() {
  const candidates = [
    path.join(process.cwd(), 'data/default-prompt-assets'),
    path.join(__dirname, '../../../../data/default-prompt-assets'),
    path.join(process.resourcesPath || '', 'data/default-prompt-assets'),
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0]
}
