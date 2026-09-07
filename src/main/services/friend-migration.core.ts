import crypto from 'crypto'

export interface FriendPromptEntry {
  sourceId: string
  name: string
  prompt: string
  chapter: string
  section: string
  subsection: string
  nsfw: boolean
  variantCount: number
}

export interface FriendMigrationPlan {
  source: 'suigu-search-index'
  sourceFingerprint: string
  total: number
  additions: FriendPromptEntry[]
  duplicates: FriendPromptEntry[]
  skipped: number
  warnings: string[]
}

export interface FriendLocalSnapshotSummary {
  favoriteNames: string[]
  builderTags: unknown[]
  providerHints: Array<{ kind: 'reverse' | 'chat'; baseUrl: string; model: string; hadApiKey: boolean }> 
  translationConfigured: boolean
  warnings: string[]
}

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return undefined }
}

function entryIdentity(entry: Omit<FriendPromptEntry, 'sourceId'>): string {
  return [entry.chapter, entry.section, entry.subsection, entry.name, entry.prompt]
    .map(value => value.trim().toLocaleLowerCase())
    .join('\u0000')
}

export function normalizeFriendPromptIndex(input: unknown): { entries: FriendPromptEntry[]; skipped: number; warnings: string[] } {
  const parsed = parseJsonValue(input)
  if (!Array.isArray(parsed)) throw new Error('朋友项目提示词索引必须是数组')
  if (parsed.length > 100_000) throw new Error('朋友项目提示词索引超过数量限制')

  const entries: FriendPromptEntry[] = []
  const seen = new Set<string>()
  let skipped = 0
  let duplicateRows = 0

  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') { skipped += 1; continue }
    const row = raw as Record<string, unknown>
    const name = boundedText(row.name, 500)
    const prompt = boundedText(row.tags, 100_000)
    if (!name || !prompt) { skipped += 1; continue }
    const normalized = {
      name,
      prompt,
      chapter: boundedText(row.chapter, 500) || '未分类',
      section: boundedText(row.section, 500),
      subsection: boundedText(row.subsection, 500),
      nsfw: row.nsfw === true,
      variantCount: typeof row.variantCount === 'number' && Number.isFinite(row.variantCount) ? Math.max(0, Math.floor(row.variantCount)) : 0,
    }
    const identity = entryIdentity(normalized)
    if (seen.has(identity)) { duplicateRows += 1; continue }
    seen.add(identity)
    entries.push({
      sourceId: 'suigu_' + crypto.createHash('sha256').update(identity).digest('hex').slice(0, 20),
      ...normalized,
    })
  }

  const warnings: string[] = []
  if (skipped) warnings.push('跳过 ' + skipped + ' 条缺少名称或提示词的记录')
  if (duplicateRows) warnings.push('合并 ' + duplicateRows + ' 条完全重复记录')
  return { entries, skipped, warnings }
}

export function planFriendPromptMigration(input: unknown, existingSourceIds: Iterable<string> = []): FriendMigrationPlan {
  const normalized = normalizeFriendPromptIndex(input)
  const existing = new Set(existingSourceIds)
  const additions: FriendPromptEntry[] = []
  const duplicates: FriendPromptEntry[] = []
  for (const entry of normalized.entries) {
    if (existing.has(entry.sourceId)) duplicates.push(entry)
    else additions.push(entry)
  }
  return {
    source: 'suigu-search-index',
    sourceFingerprint: crypto.createHash('sha256').update(JSON.stringify(normalized.entries.map(entry => entry.sourceId))).digest('hex'),
    total: normalized.entries.length,
    additions,
    duplicates,
    skipped: normalized.skipped,
    warnings: normalized.warnings,
  }
}

export function analyzeFriendLocalSnapshot(input: unknown): FriendLocalSnapshotSummary {
  const parsed = parseJsonValue(input)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('朋友项目本地快照必须是对象')
  const snapshot = parsed as Record<string, unknown>
  const warnings: string[] = []

  const favoritesValue = parseJsonValue(snapshot.grimoire_favorites)
  const favoriteNames = favoritesValue && typeof favoritesValue === 'object' && !Array.isArray(favoritesValue) ? Object.keys(favoritesValue as Record<string, unknown>).filter(name => name.trim()).slice(0, 100_000) : []
  const builderValue = parseJsonValue(snapshot.grimoire_builder_tags)
  const builderTags = Array.isArray(builderValue) ? builderValue.slice(0, 10_000) : []

  const providerHints: FriendLocalSnapshotSummary['providerHints'] = []
  for (const [storageKey, kind] of [['llm_reverse_config', 'reverse'], ['llm_chat_config', 'chat']] as const) {
    const value = parseJsonValue(snapshot[storageKey])
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const config = value as Record<string, unknown>
    providerHints.push({ kind, baseUrl: boundedText(config.base_url, 2048), model: boundedText(config.model, 300), hadApiKey: Boolean(boundedText(config.api_key, 4096)) })
  }
  if (providerHints.some(hint => hint.hadApiKey)) warnings.push('检测到旧 API Key；迁移计划只记录曾配置，不会复制明文密钥')

  return {
    favoriteNames,
    builderTags,
    providerHints,
    translationConfigured: parseJsonValue(snapshot.translate_config) !== undefined,
    warnings,
  }
}
