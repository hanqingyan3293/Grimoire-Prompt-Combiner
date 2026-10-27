// CLIP 嵌入索引（schema v30 image_embeddings 的唯一写入方）。
// 从 image_refs 读取还没嵌入的图，批量交给 clipWorker 计算向量后写入 BLOB；
// 模型/维度随行存储，供 similarity.service 判定「同模型同维度才可比」。
import fs from 'fs'
import { getDatabase, saveDatabase } from '../database'
import type { LegacyDatabase } from './sqlite.compat'
import { clipWorker } from './clip-worker'

const DEFAULT_BATCH_SIZE = 8

export interface ClipIndexResult {
  indexed: number
  skipped: number
  failed: number
}

function float32ToBlob(vector: Float32Array): Uint8Array {
  // 显式小端写入：BLOB 读取端按小端解析（与 clip-worker 的 base64 解码一致）。
  const buffer = new Uint8Array(vector.length * 4)
  const view = new DataView(buffer.buffer)
  for (let index = 0; index < vector.length; index += 1) view.setFloat32(index * 4, vector[index], true)
  return buffer
}

/**
 * 为缺失或模型不符的图片建立 CLIP 嵌入。
 * - 已有同模型同维度嵌入的行跳过；
 * - 文件缺失/不可读计入 failed 并继续；
 * - 每批结束回调进度；模型名取自第一次成功的嵌入（同一次索引内保持一致）。
 */
export async function indexClipEmbeddings(
  db: LegacyDatabase,
  options: { batchSize?: number; model?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<ClipIndexResult> {
  const batchSize = Math.min(32, Math.max(1, Math.floor(Number(options.batchSize) || DEFAULT_BATCH_SIZE)))
  const rows = db.exec('SELECT id, file_path, available FROM image_refs ORDER BY id')[0]?.values || []
  const candidates: Array<{ id: number; path: string }> = []
  for (const row of rows) {
    const id = Number(row[0])
    const filePath = String(row[1] || '')
    if (!Number.isInteger(id) || Number(row[2]) === 0 || !filePath || !fs.existsSync(filePath)) continue
    candidates.push({ id, path: filePath })
  }

  let indexed = 0
  let skipped = 0
  let failed = 0
  let modelName = options.model || ''
  const total = candidates.length

  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize)
    for (const entry of batch) {
      // 已嵌入且模型未变则跳过（模型名未知时无法比对，按需重算）。
      const existing = db.exec('SELECT model FROM image_embeddings WHERE image_ref_id=?', [entry.id])[0]?.values?.[0]
      if (existing && (!modelName || String(existing[0]) === modelName)) { skipped += 1; continue }
      try {
        const embedding = await clipWorker.embed([entry.path], modelName || undefined)
        if (!embedding || embedding.dims <= 0 || embedding.vectors.length === 0) { failed += 1; continue }
        modelName = modelName || embedding.model
        const vector = embedding.vectors[0]
        db.run(
          'INSERT INTO image_embeddings (image_ref_id, model, dims, vector, source, computed_at) VALUES (?,?,?,?,?,?) ON CONFLICT(image_ref_id) DO UPDATE SET model=excluded.model, dims=excluded.dims, vector=excluded.vector, computed_at=excluded.computed_at',
          [entry.id, embedding.model || modelName, embedding.dims, float32ToBlob(vector), 'clip-sidecar', new Date().toISOString()],
        )
        saveDatabase()
        indexed += 1
      } catch {
        failed += 1
      }
    }
    options.onProgress?.(Math.min(offset + batch.length, total), total)
  }

  return { indexed, skipped, failed }
}
