// 魔导书 Grimoire v7 — 感知哈希索引与相似图查询服务（schema v30）
// 编排 perceptual-hash.core 的纯函数：把 image_refs 里尚未建立感知哈希的图片
// 分批索引进 image_perceptual_hashes，并支持以某图为查询返回相似图列表。
// hash 通道按 dhash(0.7) + 颜色直方图(0.3) 的综合距离排序；clip 通道在
// image_embeddings 有可比数据时走 cosine 相似度，否则如实回落 hash 并在
// 返回的 method 字段标注实际使用的通道。
import fs from 'fs'
import { getDatabase, saveDatabase } from '../database'
import type { LegacyDatabase } from './sqlite.compat'
import type { PerceptualHashRecord } from './perceptual-hash.core'
import { combinedDistance, computePerceptualHash } from './perceptual-hash.core'

const DEFAULT_BATCH_SIZE = 16
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 1000
// 综合距离上限：SDIS 的相似检索阈值语义（低于阈值才算相似），默认 0.35
const DEFAULT_MAX_DISTANCE = 0.35
const MAX_HASH_FILE_BYTES = 64 * 1024 * 1024

// dhash 固定为 64 位 / 16 个十六进制字符；DB 中损坏的行被跳过而不是让整次查询抛错
const DHASH_PATTERN = /^[0-9a-f]{16}$/i

export interface HashIndexOptions {
  batchSize?: number
  onProgress?: (done: number, total: number) => void
}

export interface HashIndexSummary {
  indexed: number
  skipped: number
  failed: number
}

export interface SimilarImageQuery {
  imageRefId: number
  limit?: number
  method?: 'auto' | 'hash' | 'clip'
  maxDistance?: number
}

export interface SimilarImageItem {
  imageRefId: number
  distance: number
  score: number
}

export interface SimilarImageResult {
  method: 'hash' | 'clip'
  items: SimilarImageItem[]
}

interface EmbeddingRecord {
  model: string
  dims: number
  vector: Float32Array
}

// ---------- 索引 ----------

async function readImageBuffer(filePath: string): Promise<Buffer | null> {
  try {
    const stats = await fs.promises.stat(filePath)
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_HASH_FILE_BYTES) return null
    return await fs.promises.readFile(filePath)
  } catch {
    return null
  }
}

/**
 * 为 image_refs 中所有还没有感知哈希行的图片计算 dhash + 颜色直方图。
 * 已有行计入 skipped；文件不可读 / 解码失败（当前仅 PNG 可解码，见 core 注释）
 * 计入 failed 并继续；每批处理后调用 onProgress(done, total) 并落库。
 */
export async function indexPerceptualHashes(
  db: LegacyDatabase = getDatabase(),
  options: HashIndexOptions = {},
): Promise<HashIndexSummary> {
  const batchSize = Math.min(1000, Math.max(1, Math.floor(Number(options.batchSize) || DEFAULT_BATCH_SIZE)))
  // 已有哈希行的图片即“跳过”；用 JOIN 计数，避免把孤立行（理论上不存在）算进去
  const skippedRow = db.exec('SELECT COUNT(*) FROM image_refs r JOIN image_perceptual_hashes h ON h.image_ref_id=r.id')[0]?.values?.[0]?.[0]
  const skipped = Number(skippedRow || 0)
  const candidates = db.exec(
    'SELECT r.id, r.file_path FROM image_refs r LEFT JOIN image_perceptual_hashes h ON h.image_ref_id=r.id WHERE h.image_ref_id IS NULL ORDER BY r.id ASC',
  )[0]?.values || []
  const total = candidates.length
  let indexed = 0
  let failed = 0
  for (let start = 0; start < total; start += batchSize) {
    const batch = candidates.slice(start, start + batchSize)
    for (const row of batch) {
      const imageRefId = Number(row[0])
      const filePath = String(row[1] || '')
      try {
        const buffer = filePath ? await readImageBuffer(filePath) : null
        const hashed = buffer ? computePerceptualHash(buffer) : null
        if (!hashed) {
          failed += 1
          continue
        }
        db.run(
          'INSERT INTO image_perceptual_hashes (image_ref_id,dhash,color_histogram,width,height,computed_at) VALUES (?,?,?,?,?,?)',
          [imageRefId, hashed.dhash, hashed.colorHistogram, hashed.width, hashed.height, new Date().toISOString()],
        )
        indexed += 1
      } catch {
        failed += 1
      }
    }
    saveDatabase()
    options.onProgress?.(Math.min(start + batchSize, total), total)
  }
  return { indexed, skipped, failed }
}

// ---------- 相似图查询 ----------

function readHashRecord(db: LegacyDatabase, imageRefId: number): PerceptualHashRecord | null {
  const row = db.exec('SELECT dhash,color_histogram FROM image_perceptual_hashes WHERE image_ref_id=?', [imageRefId])[0]?.values?.[0]
  if (!row) return null
  const dhash = String(row[0] || '')
  if (!DHASH_PATTERN.test(dhash)) return null
  return { dhash, colorHistogram: String(row[1] || '') }
}

function querySimilarByHash(db: LegacyDatabase, imageRefId: number, limit: number, maxDistance: number): SimilarImageResult {
  const target = readHashRecord(db, imageRefId)
  if (!target) return { method: 'hash', items: [] }
  const rows = db.exec("SELECT image_ref_id,dhash,color_histogram FROM image_perceptual_hashes WHERE dhash<>''")[0]?.values || []
  const items: SimilarImageItem[] = []
  for (const row of rows) {
    const candidateId = Number(row[0])
    if (candidateId === imageRefId) continue
    const dhash = String(row[1] || '')
    if (!DHASH_PATTERN.test(dhash)) continue
    try {
      const distance = combinedDistance(target, { dhash, colorHistogram: String(row[2] || '') })
      if (distance > maxDistance) continue
      items.push({ imageRefId: candidateId, distance, score: 1 - distance })
    } catch {
      // 单行数据损坏（直方图非法/桶数不符）时跳过，不影响整体查询
    }
  }
  items.sort((left, right) => left.distance - right.distance || left.imageRefId - right.imageRefId)
  return { method: 'hash', items: items.slice(0, limit) }
}

// Float32 小端 BLOB → Float32Array（不依赖内存对齐，node:sqlite 返回 Uint8Array）
function blobToFloat32(value: unknown): Float32Array | null {
  if (!(value instanceof Uint8Array)) return null
  const count = Math.floor(value.byteLength / 4)
  if (count <= 0) return null
  const output = new Float32Array(count)
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength)
  for (let index = 0; index < count; index++) output[index] = view.getFloat32(index * 4, true)
  return output
}

function readEmbedding(db: LegacyDatabase, imageRefId: number): EmbeddingRecord | null {
  const row = db.exec('SELECT model,dims,vector FROM image_embeddings WHERE image_ref_id=?', [imageRefId])[0]?.values?.[0]
  if (!row) return null
  const vector = blobToFloat32(row[2])
  if (!vector) return null
  const dims = Number(row[1] || 0)
  return { model: String(row[0] || ''), dims: dims > 0 ? dims : vector.length, vector }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index]
    normA += a[index] * a[index]
    normB += b[index] * b[index]
  }
  if (normA === 0 || normB === 0) return 0
  return Math.min(1, Math.max(-1, dot / (Math.sqrt(normA) * Math.sqrt(normB))))
}

// clip 通道是否可用：目标图有嵌入，且库里存在至少一条同模型同维度的其他嵌入；
// 否则视为“当前没有可比 embedding 数据”（CLIP 索引未建 / 目标未嵌入），由调用方回落 hash。
function hasComparableClipPeers(db: LegacyDatabase, imageRefId: number, target: EmbeddingRecord): boolean {
  const row = db.exec(
    'SELECT COUNT(*) FROM image_embeddings WHERE image_ref_id<>? AND model=? AND dims=?',
    [imageRefId, target.model, target.dims],
  )[0]?.values?.[0]?.[0]
  return Number(row || 0) > 0
}

function querySimilarByClip(db: LegacyDatabase, imageRefId: number, target: EmbeddingRecord, limit: number, maxDistance: number): SimilarImageResult {
  const rows = db.exec('SELECT image_ref_id,model,dims,vector FROM image_embeddings')[0]?.values || []
  const items: SimilarImageItem[] = []
  for (const row of rows) {
    const candidateId = Number(row[0])
    if (candidateId === imageRefId) continue
    // 模型或维度不同（CLIP 模型切换）的嵌入不可比较，直接跳过
    if (String(row[1] || '') !== target.model || Number(row[2] || 0) !== target.dims) continue
    const vector = blobToFloat32(row[3])
    if (!vector || vector.length !== target.vector.length) continue
    const similarity = cosineSimilarity(target.vector, vector)
    const distance = 1 - similarity
    if (distance > maxDistance) continue
    items.push({ imageRefId: candidateId, distance, score: similarity })
  }
  items.sort((left, right) => left.distance - right.distance || left.imageRefId - right.imageRefId)
  return { method: 'clip', items: items.slice(0, limit) }
}

/**
 * 以某图为查询返回相似图列表。
 * method: 'hash' 强制 dhash+直方图；'clip'/'auto' 在目标图有 image_embeddings 行时
 * 走 cosine，没有可比嵌入时回落到 hash 并在返回的 method 中如实标注 'hash'。
 * 结果按距离升序、排除目标图自身，score = 1 - distance（clip 下即 cosine 相似度）。
 */
export async function querySimilarImages(
  db: LegacyDatabase = getDatabase(),
  input: SimilarImageQuery,
): Promise<SimilarImageResult> {
  const imageRefId = Math.floor(Number(input?.imageRefId))
  if (!Number.isFinite(imageRefId) || imageRefId <= 0) throw new Error('imageRefId 无效')
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(input?.limit) || DEFAULT_LIMIT)))
  const rawDistance = Number(input?.maxDistance)
  // hash 距离在 0-1；clip 的 1-cos 理论上到 2，钳制上界留出空间
  const maxDistance = Number.isFinite(rawDistance) ? Math.min(2, Math.max(0, rawDistance)) : DEFAULT_MAX_DISTANCE
  const method = input?.method === 'hash' || input?.method === 'clip' ? input.method : 'auto'

  if (method !== 'hash') {
    const target = readEmbedding(db, imageRefId)
    if (target && hasComparableClipPeers(db, imageRefId, target)) {
      return querySimilarByClip(db, imageRefId, target, limit, maxDistance)
    }
    // 'clip' 请求但当前没有可用的嵌入数据：回落到 hash，返回的 method 如实为 'hash'
  }
  return querySimilarByHash(db, imageRefId, limit, maxDistance)
}
