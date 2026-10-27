import fs from 'fs'
import path from 'path'
import { getDatabase } from '../database'
import { createImageDerivatives } from './media.service'

/**
 * 缩略图/预览派生图服务。
 *
 * - requestDerivatives：串行队列请求生成派生图。同一 imageRefId 去重；已有 thumbnail 派生行时跳过；
 *   任务失败不向调用方抛出（队列继续执行），失败的 imageRefId 由下一次请求重试。
 * - readThumbnails：批量读取派生图为 data URL（缺派生行/文件缺失/读取失败/超过 8MB 均为 null）。
 * - ensureThumbnails：请求后等待该 imageRefId 的队列任务完成（无任务时立即返回）。
 *
 * 队列通过内部 promise 链实现：前一个任务 settle 后才执行下一个。
 */

const CHUNK_SIZE = 400
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

// entries：当前“排队 + 执行中”的任务（imageRefId → 该任务 settle 时兑现的 promise），用于去重与等待。
// queueTail：内部 promise 链的队尾，新任务挂到队尾之后串行执行。
const entries = new Map<number, Promise<void>>()
let queueTail: Promise<void> = Promise.resolve()
let queuedCount = 0
let runningCount = 0
let failedCount = 0

function normalizeImageRefId(value: number): number | null {
  const id = Math.trunc(Number(value))
  return Number.isFinite(id) ? id : null
}

function hasThumbnailDerivative(imageRefId: number): boolean {
  const result = getDatabase().exec("SELECT 1 FROM image_derivatives WHERE image_ref_id=? AND kind='thumbnail' LIMIT 1", [imageRefId])
  return (result[0]?.values?.length || 0) > 0
}

export function requestDerivatives(imageRefId: number): void {
  try {
    const id = normalizeImageRefId(imageRefId)
    if (id === null) return
    if (entries.has(id)) return
    if (hasThumbnailDerivative(id)) return

    let settle: () => void = () => {}
    const entry = new Promise<void>((resolve) => { settle = resolve })
    entries.set(id, entry)
    queuedCount += 1
    queueTail = queueTail
      .then(async () => {
        queuedCount -= 1
        runningCount += 1
        try {
          await createImageDerivatives(id)
        } catch {
          failedCount += 1
        } finally {
          runningCount -= 1
          entries.delete(id)
          settle()
        }
      })
      .catch(() => { failedCount += 1 }) // 兜底：链上出现意外错误也不阻断后续任务
  } catch {
    // 请求入口绝不向调用方抛出；未生成成功的派生图留待下一次请求重试。
  }
}

/** 当前排队 + 执行中的任务数（测试与控制用）。 */
export function pendingDerivativeCount(): number {
  return entries.size
}

/** 队列统计：queued 排队中、running 执行中（串行队列下为 0 或 1）、failed 累计失败数。 */
export function derivativeQueueStats(): { queued: number; running: number; failed: number } {
  return { queued: queuedCount, running: runningCount, failed: failedCount }
}

/** 等待队列清空（测试用）：包含等待期间新入队的任务。 */
export async function drainDerivativeQueue(): Promise<void> {
  await queueTail
  while (entries.size > 0) {
    await queueTail
  }
}

/** 便捷入口：请求派生图并等待该 imageRefId 的队列任务完成；已跳过或已在运行/排队时等待对应任务。 */
export async function ensureThumbnails(imageRefId: number): Promise<void> {
  const id = normalizeImageRefId(imageRefId)
  if (id === null) return
  requestDerivatives(id)
  const entry = entries.get(id)
  if (entry) await entry
}

function mimeForFile(filePath: string): string {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

async function readFileAsDataUrl(filePath: string): Promise<string | null> {
  try {
    const stats = await fs.promises.stat(filePath)
    if (!stats.isFile() || stats.size > MAX_IMAGE_BYTES) return null
    const data = await fs.promises.readFile(filePath)
    return 'data:' + mimeForFile(filePath) + ';base64,' + data.toString('base64')
  } catch {
    return null
  }
}

export async function readThumbnails(ids: number[], kind: 'thumbnail' | 'preview' = 'thumbnail'): Promise<Record<number, string | null>> {
  const result: Record<number, string | null> = {}
  const requested: number[] = []
  for (const value of ids || []) {
    const id = normalizeImageRefId(value)
    if (id === null || Object.prototype.hasOwnProperty.call(result, id)) continue
    result[id] = null
    requested.push(id)
  }
  const filePaths = new Map<number, string>()
  if (requested.length > 0) {
    const db = getDatabase()
    for (let offset = 0; offset < requested.length; offset += CHUNK_SIZE) {
      const chunk = requested.slice(offset, offset + CHUNK_SIZE)
      const placeholders = chunk.map(() => '?').join(',')
      const rows = db.exec(
        'SELECT d.image_ref_id,d.file_path FROM image_derivatives d JOIN image_refs r ON r.id=d.image_ref_id WHERE d.kind=? AND d.image_ref_id IN (' + placeholders + ')',
        [kind, ...chunk]
      )[0]?.values || []
      for (const row of rows) {
        const id = normalizeImageRefId(Number(row[0]))
        const filePath = String(row[1] || '')
        if (id !== null && filePath) filePaths.set(id, filePath)
      }
    }
  }
  for (const id of requested) {
    const filePath = filePaths.get(id)
    if (filePath) result[id] = await readFileAsDataUrl(filePath)
  }
  return result
}