import fs from 'fs'
import path from 'path'
import { getDatabase, getResourceRoot, saveDatabase } from '../database'
import { buildManagedImagePath, inspectImageFile, isPathInside, probeImageDimensions } from './asset.core'
import { assertNovelaiImageRemovable } from './novelai-asset.service'
import type { ImageCleanupResult, ImageCleanupStage, ImageDeleteBatchResult } from '../../shared/image-deletion-types'

/** Best-effort dimension/mtime probe; never throws, missing values stay null. */
export async function probeFileDimensions(filePath: string): Promise<{ width: number | null; height: number | null; mtimeMs: number | null }> {
  try {
    const stats = await fs.promises.stat(filePath)
    const handle = await fs.promises.open(filePath, 'r')
    const header = Buffer.alloc(64 * 1024)
    let read = 0
    try { read = (await handle.read(header, 0, header.length, 0)).bytesRead } finally { await handle.close() }
    const dimensions = probeImageDimensions(header.subarray(0, read))
    return {
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      mtimeMs: Number.isFinite(stats.mtimeMs) ? Math.floor(stats.mtimeMs) : null,
    }
  } catch {
    return { width: null, height: null, mtimeMs: null }
  }
}

export interface ManagedImageRecord {
  id: number
  file_path: string
  storage_mode: 'managed'
  asset_hash: string
  mime_type: string
  file_size: number
  original_name: string
}

/** Validate, hash, deduplicate and persist a local image in the managed library. */
export async function registerManagedImage(sourcePath: string, originalName?: string, checkpoint?: () => void): Promise<ManagedImageRecord> {
  const inspection = await inspectImageFile(sourcePath)
  checkpoint?.()
  const db = getDatabase()
  const existing = db.exec(
    "SELECT id, file_path, storage_mode, asset_hash, mime_type, file_size, original_name FROM image_refs WHERE asset_hash=? AND storage_mode='managed' LIMIT 1",
    [inspection.hash]
  )
  const existingRow = existing[0]?.values?.[0]
  if (existingRow) {
    const canonicalPath = buildManagedImagePath(getResourceRoot(), inspection)
    if (!fs.existsSync(canonicalPath)) {
      checkpoint?.()
      await fs.promises.mkdir(path.dirname(canonicalPath), { recursive: true })
      checkpoint?.()
      await fs.promises.copyFile(sourcePath, canonicalPath)
    }
    checkpoint?.()
    const probe = await probeFileDimensions(canonicalPath)
    checkpoint?.()
    db.run('UPDATE image_refs SET file_path=?, available=1, width=COALESCE(width,?), height=COALESCE(height,?), file_mtime=COALESCE(file_mtime,?) WHERE id=?', [canonicalPath, probe.width, probe.height, probe.mtimeMs, Number(existingRow[0])])
    saveDatabase()
    return {
      id: Number(existingRow[0]),
      file_path: canonicalPath,
      storage_mode: 'managed',
      asset_hash: String(existingRow[3]),
      mime_type: String(existingRow[4]),
      file_size: Number(existingRow[5]),
      original_name: String(existingRow[6] || path.basename(sourcePath)),
    }
  }

  const filePath = buildManagedImagePath(getResourceRoot(), inspection)
  checkpoint?.()
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  checkpoint?.()
  if (!fs.existsSync(filePath)) await fs.promises.copyFile(sourcePath, filePath)
  checkpoint?.()

  const probe = await probeFileDimensions(filePath)
  checkpoint?.()
  db.run(
    'INSERT INTO image_refs (file_path, storage_mode, asset_hash, mime_type, file_size, original_name, available, width, height, file_mtime) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [filePath, 'managed', inspection.hash, inspection.mimeType, inspection.size, safeImageName(originalName || inspection.originalName), 1, probe.width, probe.height, probe.mtimeMs]
  )
  saveDatabase()
  const idResult = db.exec('SELECT last_insert_rowid()')
  const id = Number(idResult[0]?.values?.[0]?.[0])
  return {
    id,
    file_path: filePath,
    storage_mode: 'managed',
    asset_hash: inspection.hash,
    mime_type: inspection.mimeType,
    file_size: inspection.size,
    original_name: safeImageName(originalName || inspection.originalName),
  }
}

function safeImageName(value: string): string {
  return path.basename(value).slice(0, 255) || 'image'
}

export class ImageDeletionError extends Error {
  constructor(readonly code: 'INVALID_IMAGE_ID'|'IMAGE_NOT_FOUND'|'IMAGE_CLEANUP_FAILED'|'IMAGE_DELETE_DB_FAILED', message: string, readonly result?: ImageDeleteBatchResult) {
    super(code + ': ' + message)
    this.name = 'ImageDeletionError'
  }
}

export function requireImageRefId(value: unknown): number {
  const id = typeof value === 'number' ? value : typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN
  if (!Number.isSafeInteger(id) || id <= 0) throw new ImageDeletionError('INVALID_IMAGE_ID', '图片 ID 必须是正整数')
  return id
}

/** Checks the WHOLE batch before a file or row can change. NovelAI uses the exact numeric-string id. */
export function assertImageReferencesRemovable(values: readonly unknown[]): number[] {
  const ids = [...new Set(values.map(requireImageRefId))]
  const db = getDatabase()
  for (const id of ids) {
    if (!db.exec('SELECT id FROM image_refs WHERE id=?', [id])[0]?.values?.length) throw new ImageDeletionError('IMAGE_NOT_FOUND', '图片记录不存在：' + id)
    assertNovelaiImageRemovable(String(id))
  }
  return ids
}

function comparablePath(value: string): string {
  const resolved = fs.existsSync(value) ? fs.realpathSync(value) : path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function lexicalPath(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export type ManagedResourceArea = 'images'|'derivatives'|'ai-attachments'|'wd14-history'
export function assertManagedResourcePath(target: string, area: ManagedResourceArea): void {
  const root = getResourceRoot()
  const logicalArea = path.join(root, area)
  if (!isPathInside(logicalArea, target)) throw new Error('清理目标不在对应托管子目录内')
  const canonicalRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root)
  const expectedArea = path.join(canonicalRoot, area)
  // Trust the canonical RESOURCE root, never a redirected images/derivatives subtree.
  if (fs.existsSync(logicalArea) && lexicalPath(fs.realpathSync(logicalArea)) !== lexicalPath(expectedArea)) throw new Error('托管子目录发生了路径重定向')
  const expectedTarget = path.join(expectedArea, path.relative(logicalArea, target))
  if (fs.existsSync(target) && lexicalPath(fs.realpathSync(target)) !== lexicalPath(expectedTarget)) throw new Error('清理目标发生了路径重定向')
}

export function imageReferencesAtPath(target: string, options: { directory?: boolean; excluding?: readonly number[] } = {}): number[] {
  const canonical = comparablePath(target)
  const logical = lexicalPath(target)
  const excluded = new Set(options.excluding || [])
  const rows = getDatabase().exec('SELECT id,file_path FROM image_refs')[0]?.values || []
  return rows.flatMap(row => {
    const id = Number(row[0])
    if (excluded.has(id)) return []
    const other = comparablePath(String(row[1]))
    const otherLogical = lexicalPath(String(row[1]))
    return other === canonical || otherLogical === logical || (options.directory && (isPathInside(canonical, other) || isPathInside(logical, otherLogical))) ? [id] : []
  })
}

export function existingImageRefIds(values: readonly unknown[]): number[] {
  const ids = [...new Set(values.map(requireImageRefId))]
  return ids.filter(id => Boolean(getDatabase().exec('SELECT id FROM image_refs WHERE id=?', [id])[0]?.values?.length))
}

function rollbackDeletion(): void {
  try { getDatabase().exec('ROLLBACK') } catch (error) {
    // RAISE(ROLLBACK) already ended the transaction. Preserve the original cleanup failure.
    console.debug('[images] rollback was already settled or failed', error instanceof Error ? error.message : String(error))
  }
}

function derivativeArtifacts(directory: string): string[] {
  const files: string[] = []
  const walk = (current: string, depth: number) => {
    if (depth > 32) throw new Error('派生目录超过清理观察深度')
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name)
      files.push(file)
      if (files.length > 4096) throw new Error('派生目录超过清理观察数量')
      if (entry.isDirectory()) walk(file, depth + 1)
    }
  }
  walk(directory, 0)
  return files
}

/** Synchronous short file operations keep reference checks, cleanup and row changes in one write lease. */
function cleanupImageArtifacts(imageRefId: number): ImageCleanupResult {
  const db = getDatabase()
  const row = db.exec('SELECT file_path, storage_mode FROM image_refs WHERE id=?', [imageRefId])[0]?.values?.[0]
  if (!row) throw new ImageDeletionError('IMAGE_NOT_FOUND', '图片记录不存在：' + imageRefId)
  const filePath = String(row[0] || '')
  const stages: ImageCleanupStage[] = []
  const result: ImageCleanupResult = { imageRefId, status: 'completed', removedFile: false, removedDerivatives: false, stages }
  try {
    if (row[1] !== 'managed') stages.push({ stage: 'file', status: 'retained', reason: 'external' })
    else {
      const shared = imageReferencesAtPath(filePath, { excluding: [imageRefId] }).length > 0
      if (shared) stages.push({ stage: 'file', status: 'retained', reason: 'shared' })
      else {
        const resolved = path.resolve(filePath)
        assertManagedResourcePath(resolved, 'images')
        const present = fs.existsSync(resolved)
        fs.rmSync(resolved, { force: true })
        result.removedFile = present
        stages.push({ stage: 'file', status: present ? 'removed' : 'not-found' })
      }
    }
  } catch (error) {
    result.status = 'failed'
    stages.push({ stage: 'file', status: 'failed', code: 'IMAGE_CLEANUP_FAILED', message: error instanceof Error ? error.message : String(error) })
    return result
  }
  const directory = path.join(getResourceRoot(), 'derivatives', String(imageRefId))
  let beforePaths: string[] = []; let attempted = false; let wasPresent = false
  try {
    assertManagedResourcePath(directory, 'derivatives')
    if (imageReferencesAtPath(directory, { directory: true }).length) {
      stages.push({ stage: 'derivatives', status: 'retained', reason: 'shared' })
    } else {
      wasPresent = fs.existsSync(directory)
      beforePaths = wasPresent ? derivativeArtifacts(directory) : []
      attempted = true
      fs.rmSync(directory, { recursive: true, force: true })
      result.removedDerivatives = wasPresent
      stages.push({ stage: 'derivatives', status: wasPresent ? 'removed' : 'not-found' })
    }
  } catch (error) {
    const removedPaths: string[] = []; const indeterminatePaths: string[] = []
    if (attempted) {
      for (const file of beforePaths) {
        const relative = path.relative(directory, file).replaceAll(path.sep, '/')
        try { fs.lstatSync(file) } catch (observationError) {
          if ((observationError as { code?: string }).code === 'ENOENT') removedPaths.push(relative)
          else indeterminatePaths.push(relative)
        }
      }
      try { fs.lstatSync(directory) } catch (observationError) {
        if ((observationError as { code?: string }).code === 'ENOENT') result.removedDerivatives = wasPresent
        else indeterminatePaths.push('.')
      }
    }
    const changed = result.removedFile || result.removedDerivatives || removedPaths.length > 0 || indeterminatePaths.length > 0
    result.status = changed ? 'partial' : 'failed'
    stages.push({ stage: 'derivatives', status: removedPaths.length || indeterminatePaths.length || result.removedDerivatives ? 'partial' : 'failed', removedPaths, indeterminatePaths, code: 'IMAGE_CLEANUP_FAILED', message: error instanceof Error ? error.message : String(error) })
  }
  return result
}

/** Legacy cleanup-only API still guards references and exposes any IO failure instead of swallowing it. */
export async function deleteImageArtifacts(value: number): Promise<ImageCleanupResult> {
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    const [id] = assertImageReferencesRemovable([value])
    const result = cleanupImageArtifacts(id)
    db.exec('COMMIT')
    return result
  } catch (error) {
    rollbackDeletion()
    throw error
  }
}

/** Canonical physical deletion. Preflight is all-or-nothing; IO failures retain affected rows for retry. */
export function deleteImagesFromLibrary(values: readonly unknown[]): ImageDeleteBatchResult {
  const report: ImageDeleteBatchResult = { status: 'completed', deletedIds: [], cleanup: [], failures: [] }
  if (!values.length) return report
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    const ids = assertImageReferencesRemovable(values)
    for (const id of ids) {
      const cleanup = cleanupImageArtifacts(id)
      report.cleanup.push(cleanup)
      if (cleanup.status !== 'completed') {
        report.failures.push({ imageRefId: id, code: 'IMAGE_CLEANUP_FAILED', message: cleanup.stages.find(stage => stage.status === 'failed' || stage.status === 'partial')?.message || '图片文件清理失败' })
        continue
      }
      db.run('DELETE FROM image_refs WHERE id=?', [id])
      report.deletedIds.push(id)
    }
    db.exec('COMMIT')
  } catch (error) {
    rollbackDeletion()
    // Reference/input errors happened before cleanup. Preserve their exact error code and meaning.
    if (!report.cleanup.length) throw error
    report.deletedIds = []
    report.status = report.cleanup.some(item => item.removedFile || item.removedDerivatives || item.status === 'partial') ? 'partial' : 'failed'
    report.failures = report.cleanup.map(item => ({ imageRefId: item.imageRefId, code: 'IMAGE_DELETE_DB_FAILED', message: error instanceof Error ? error.message : String(error) }))
    return report
  }
  if (report.failures.length) report.status = report.deletedIds.length || report.cleanup.some(item => item.status === 'partial') ? 'partial' : 'failed'
  saveDatabase()
  return report
}
