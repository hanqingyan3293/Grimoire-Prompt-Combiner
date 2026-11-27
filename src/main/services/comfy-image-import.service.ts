import fs from 'fs'
import os from 'os'
import path from 'path'
import { getDatabase } from '../database'
import type { ComfyTaskImageResult, TaskRecord } from '../../shared/task-types'
import type { ComfyResultImage } from '../../shared/types'
import { ComfyUIError, type ComfyReadOptions } from './comfy-client'
import { TaskRepositoryError } from './task-repository'
import { registerManagedImage } from './image-asset.service'
import { createImageDerivatives, createMediaRelation, ensureMediaAsset } from './media.service'
import { logEvent } from './logger.service'

export interface ComfyImportResult {
  imageIds: number[]
  warnings: string[]
  imageResults: ComfyTaskImageResult[]
}

export class ComfyImageImportError extends ComfyUIError {
  constructor(message: string, retryable: boolean, readonly result: ComfyImportResult) {
    super('COMFY_IMAGE_IMPORT_ERROR', message, retryable)
  }
}

interface DownloadClient { downloadImage(image: ComfyResultImage, options?: ComfyReadOptions): Promise<Buffer> }
interface SourceLedger { version: 1; keys: string[]; legacyFilename?: string }
const SOURCE_LEDGER_PREFIX = 'comfy-source-v1:'

function sourceKey(image: ComfyResultImage): string {
  return JSON.stringify([image.type, image.subfolder, image.filename])
}

function sourceLedger(raw: string): SourceLedger {
  if (!raw.startsWith(SOURCE_LEDGER_PREFIX)) return { version: 1, keys: [], legacyFilename: raw }
  let value: unknown
  try { value = JSON.parse(raw.slice(SOURCE_LEDGER_PREFIX.length)) } catch { throw new ComfyUIError('COMFY_IMAGE_IMPORT_ERROR', '任务图片来源记录损坏，保留原记录', false) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ComfyUIError('COMFY_IMAGE_IMPORT_ERROR', '任务图片来源记录无效', false)
  const record = value as Record<string, unknown>
  if (record.version !== 1 || !Array.isArray(record.keys) || record.keys.some(key => typeof key !== 'string')) throw new ComfyUIError('COMFY_IMAGE_IMPORT_ERROR', '任务图片来源版本或身份无效', false)
  return { version: 1, keys: record.keys as string[], ...(typeof record.legacyFilename === 'string' ? { legacyFilename: record.legacyFilename } : {}) }
}

function existingTaskImage(taskId: string, image: ComfyResultImage, outputs: ComfyResultImage[]): number | null {
  const key = sourceKey(image)
  const legacyUnambiguous = outputs.filter(output => output.filename === image.filename).length === 1
  const rows = getDatabase().exec('SELECT t.image_id,t.source_filename,r.file_path,r.available FROM task_image_refs t JOIN image_refs r ON r.id=t.image_id WHERE t.task_id=?', [taskId])[0]?.values || []
  const ids = new Set<number>()
  for (const row of rows) {
    const raw = String(row[1])
    const ledger = sourceLedger(raw)
    const matches = ledger.keys.includes(key) || (legacyUnambiguous && ledger.legacyFilename === image.filename)
    if (matches && Number(row[3]) !== 0 && fs.existsSync(String(row[2]))) ids.add(Number(row[0]))
  }
  if (ids.size > 1) throw new ComfyUIError('COMFY_IMAGE_IMPORT_ERROR', '任务图片来源指向多个图片引用，保留原记录', false)
  return [...ids][0] ?? null
}

/** Keep one canonical (task,image) row, with all source identities sharing its hash. */
function linkTaskImage(taskId: string, imageId: number, image: ComfyResultImage, checkpoint: () => TaskRecord): void {
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    checkpoint()
    const row = db.exec('SELECT source_filename FROM task_image_refs WHERE task_id=? AND image_id=?', [taskId, imageId])[0]?.values?.[0]
    const ledger = row ? sourceLedger(String(row[0])) : { version: 1 as const, keys: [] as string[] }
    const key = sourceKey(image)
    if (!ledger.keys.includes(key)) ledger.keys.push(key)
    const raw = SOURCE_LEDGER_PREFIX + JSON.stringify(ledger)
    ensureMediaAsset(imageId, 'generated-comfy', image.filename)
    createMediaRelation({ sourceType: 'image', sourceKey: 'image:' + imageId, relationType: 'generated-from', targetType: 'task', targetKey: taskId })
    if (row) {
      const result = db.run('UPDATE task_image_refs SET source_filename=? WHERE task_id=? AND image_id=? AND source_filename IS ?', [raw, taskId, imageId, row[0]])
      if (Number(result.changes) !== 1) throw new TaskRepositoryError('TASK_STATE_CONFLICT', '任务图片来源记录已变化')
    } else db.run('INSERT INTO task_image_refs (task_id,image_id,source_filename) VALUES (?,?,?)', [taskId, imageId, raw])
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch (rollbackError) { console.debug('[tasks] image import rollback settled', rollbackError instanceof Error ? rollbackError.message : String(rollbackError)) }
    throw error
  }
}

function syncImportedIds(result: ComfyImportResult): void {
  result.imageIds = [...new Set(result.imageResults.flatMap(item => item.status === 'imported' && item.imageId !== null ? [item.imageId] : []))]
}

/** IO is outside short SQL transactions; only transient reads enter persisted task backoff. */
export async function importComfyImages(taskId: string, images: ComfyResultImage[], client: DownloadClient, checkpoint: () => TaskRecord, options: ComfyReadOptions = {}): Promise<ComfyImportResult> {
  // Untouched outputs are pending, not failed or silently absent on interruption.
  const result: ComfyImportResult = { imageIds: [], warnings: [], imageResults: images.map(image => ({ filename: image.filename, subfolder: image.subfolder, type: image.type, status: 'pending', imageId: null, errorCode: null, errorMessage: null })) }
  const check = () => { options.signal?.throwIfAborted(); return checkpoint() }
  const task = check()
  const canRetry = task.retry_count < task.max_retries
  // Load this identity's real committed links before any IO suspension. A
  // resumed attempt stopped in mkdtemp must not erase earlier imported facts.
  for (const [index, image] of images.slice(0, 64).entries()) {
    const imageId = existingTaskImage(taskId, image, images)
    if (imageId !== null) Object.assign(result.imageResults[index], { status: 'imported', imageId })
  }
  syncImportedIds(result)
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'grimoire-comfy-'))
  let pending = false
  try {
    for (const [index, image] of images.entries()) {
      const item = result.imageResults[index]
      try {
        check()
        if (index >= 64) throw new ComfyUIError('COMFY_IMAGE_IMPORT_ERROR', '超过单任务64张导入上限，该图片未导入', false)
        let imageId = existingTaskImage(taskId, image, images)
        if (imageId === null) {
          item.status = 'pending'
          item.imageId = null
          syncImportedIds(result)
          const data = await client.downloadImage(image, options)
          check()
          const tempPath = path.join(tempRoot, `${index}.image`)
          await fs.promises.writeFile(tempPath, data)
          check()
          imageId = (await registerManagedImage(tempPath, image.filename, () => { check() })).id
          check()
        }
        item.imageId = imageId
        linkTaskImage(taskId, imageId, image, check)
        item.status = 'imported'
        syncImportedIds(result)
        void createImageDerivatives(imageId).catch(error => {
          logEvent('warn', 'task-runner', 'ComfyUI image derivative was not created', { taskId, phase: 'asset-derivative', context: error instanceof Error ? error.message : String(error), errorCode: 'COMFY_IMAGE_DERIVATIVE_ERROR', retryable: false })
        })
      } catch (error) {
        check()
        item.status = 'failed'
        const message = error instanceof Error ? error.message : String(error)
        item.errorCode = error instanceof ComfyUIError ? error.code : 'COMFY_IMAGE_IMPORT_ERROR'
        item.errorMessage = message
        if (error instanceof ComfyUIError && error.retryable && canRetry) {
          item.status = 'pending'
          pending = true
        }
        syncImportedIds(result)
        result.warnings.push(`${image.subfolder ? image.subfolder + '/' : ''}${image.filename}: ${message}`)
        logEvent('warn', 'task-runner', 'ComfyUI image import incomplete', { taskId, phase: 'asset-import', context: message, errorCode: item.errorCode, retryable: item.status === 'pending' })
      }
    }
  } catch (error) {
    syncImportedIds(result)
    // A checkpoint/read interruption must carry the images already committed
    // by this attempt; it is not an ordinary per-image failure or retry.
    const interrupted = new ComfyImageImportError(error instanceof Error ? error.message : String(error), false, result)
    interrupted.cause = error
    if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) interrupted.name = 'AbortError'
    throw interrupted
  } finally {
    try { await fs.promises.rm(tempRoot, { recursive: true, force: true }) } catch (error) {
      const message = '临时下载目录清理失败，已登记图片保持不变：' + (error instanceof Error ? error.message : String(error))
      result.warnings.push(message)
      // Preserve this attempt's committed image/relationship facts even when
      // cleanup fails; never fall back to a previous pending output snapshot.
      throw new ComfyImageImportError(message, false, result)
    }
  }
  if (pending) throw new ComfyImageImportError('部分图片暂未取回，将按原 prompt 身份恢复下载：' + result.warnings.join('; ').slice(0, 1200), true, result)
  return result
}
