// 魔导书 Grimoire — 标签元数据编辑服务（Wave F）
// 面向前缀字段编辑器的读写层：操作 schema v30 已就位的 tag_metadata 表
// （tag_id PK, namespace, normalized_key, description, color, is_active, source）。
// 不引入 normalized_key 的新语义——该列由标签情报同步流程维护，本服务只在
// 缺失行插入时写入空串默认值，更新时从不改写。
import type { LegacyDatabase } from './sqlite.compat'
import { saveDatabase } from '../database'

export interface TagMetadataRecord {
  tagId: string
  namespace: string
  description: string
  color: string
  isActive: boolean
  source: string
}

export interface TagMetadataInput {
  tagId: string
  namespace?: string
  description?: string
  color?: string
  isActive?: boolean
}

const MAX_NAMESPACE_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 2000
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const LIST_QUERY_CHUNK_SIZE = 400

function rowToRecord(row: unknown[]): TagMetadataRecord {
  return {
    tagId: String(row[0]),
    namespace: String(row[1] || ''),
    description: String(row[2] || ''),
    color: String(row[3] || ''),
    isActive: Number(row[4]) === 1,
    source: String(row[5] || ''),
  }
}

function selectColumns(): string {
  return 'tag_id,namespace,description,color,is_active,source'
}

/** 校验 #RRGGBB 或空串（空串表示清除颜色）。 */
function normalizeColor(value: unknown): string {
  const color = String(value ?? '').trim()
  if (!color) return ''
  if (!COLOR_PATTERN.test(color)) throw new Error('标签颜色无效，格式应为 #RRGGBB')
  return color
}

function normalizeNamespace(value: unknown): string {
  const namespace = String(value ?? '').trim()
  if (namespace.length > MAX_NAMESPACE_LENGTH) throw new Error(`标签命名空间不能超过 ${MAX_NAMESPACE_LENGTH} 个字符`)
  return namespace
}

function normalizeDescription(value: unknown): string {
  const description = String(value ?? '').trim()
  if (description.length > MAX_DESCRIPTION_LENGTH) throw new Error(`标签描述不能超过 ${MAX_DESCRIPTION_LENGTH} 个字符`)
  return description
}

function tagExists(db: LegacyDatabase, tagId: string): boolean {
  return Boolean(db.exec('SELECT id FROM tags WHERE id=?', [tagId])[0]?.values?.[0])
}

/** 读取单个标签元数据；标签不存在或没有元数据行时返回 null。 */
export function getTagMetadata(db: LegacyDatabase, tagId: string): TagMetadataRecord | null {
  const id = String(tagId || '').trim()
  if (!id) return null
  const row = db.exec(`SELECT ${selectColumns()} FROM tag_metadata WHERE tag_id=?`, [id])[0]?.values?.[0]
  return row ? rowToRecord(row) : null
}

/**
 * 平铺批量读取，结果与入参**一一对应**（含重复 ID 与空 ID）：有行则返回记录，
 * 无行返回 null。不使用 Map 形式以免调用方丢失顺序语义。
 */
export function listTagMetadata(db: LegacyDatabase, tagIds: string[]): Array<TagMetadataRecord | null> {
  const ids = Array.isArray(tagIds) ? tagIds.map(value => String(value ?? '').trim()) : []
  const found = new Map<string, TagMetadataRecord>()
  const unique = [...new Set(ids.filter(Boolean))]
  for (let start = 0; start < unique.length; start += LIST_QUERY_CHUNK_SIZE) {
    const chunk = unique.slice(start, start + LIST_QUERY_CHUNK_SIZE)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = db.exec(`SELECT ${selectColumns()} FROM tag_metadata WHERE tag_id IN (${placeholders})`, chunk)[0]?.values || []
    for (const row of rows) {
      const record = rowToRecord(row)
      found.set(record.tagId, record)
    }
  }
  return ids.map(id => found.get(id) ?? null)
}

/**
 * Upsert 标签元数据。tagId 必须已存在于 tags 表，否则抛「标签不存在」。
 * 未提供的字段沿用现有行的值；提供的空串表示清除该字段。
 * 更新现有行时不改写 normalized_key 与 source（由标签情报同步流程维护）；
 * 插入缺失行时 normalized_key 为空串、source 为 'manual'。
 */
export function saveTagMetadata(db: LegacyDatabase, input: TagMetadataInput): TagMetadataRecord {
  const tagId = String(input?.tagId ?? '').trim()
  if (!tagId) throw new Error('标签 ID 无效')
  if (!tagExists(db, tagId)) throw new Error('标签不存在')

  const current = getTagMetadata(db, tagId)

  const namespace = input.namespace === undefined ? (current?.namespace ?? '') : normalizeNamespace(input.namespace)
  const description = input.description === undefined ? (current?.description ?? '') : normalizeDescription(input.description)
  const color = input.color === undefined ? (current?.color ?? '') : normalizeColor(input.color)
  let isActive = current?.isActive ?? true
  if (input.isActive !== undefined) {
    if (typeof input.isActive !== 'boolean') throw new Error('标签启用状态无效')
    isActive = input.isActive
  }

  // normalized_key 与 source 刻意不在 DO UPDATE 集合中：本服务不拥有这两列的语义。
  db.run(
    `INSERT INTO tag_metadata (tag_id, namespace, normalized_key, description, color, is_active, source)
     VALUES (?, ?, '', ?, ?, ?, ?)
     ON CONFLICT(tag_id) DO UPDATE SET
       namespace=excluded.namespace,
       description=excluded.description,
       color=excluded.color,
       is_active=excluded.is_active`,
    [tagId, namespace, description, color, isActive ? 1 : 0, 'manual'],
  )
  saveDatabase()

  const saved = getTagMetadata(db, tagId)
  if (!saved) throw new Error('标签元数据保存失败')
  return saved
}
