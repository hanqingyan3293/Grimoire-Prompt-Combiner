import fs from 'fs'
import path from 'path'
import { getDatabase, getResourceRoot, saveDatabase } from '../database'
import { buildManagedImagePath, inspectImageFile, isPathInside, probeImageDimensions } from './asset.core'

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
export async function registerManagedImage(sourcePath: string, originalName?: string): Promise<ManagedImageRecord> {
  const inspection = await inspectImageFile(sourcePath)
  const db = getDatabase()
  const existing = db.exec(
    "SELECT id, file_path, storage_mode, asset_hash, mime_type, file_size, original_name FROM image_refs WHERE asset_hash=? AND storage_mode='managed' LIMIT 1",
    [inspection.hash]
  )
  const existingRow = existing[0]?.values?.[0]
  if (existingRow) {
    const canonicalPath = buildManagedImagePath(getResourceRoot(), inspection)
    if (!fs.existsSync(canonicalPath)) {
      await fs.promises.mkdir(path.dirname(canonicalPath), { recursive: true })
      await fs.promises.copyFile(sourcePath, canonicalPath)
    }
    const probe = await probeFileDimensions(canonicalPath)
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
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  if (!fs.existsSync(filePath)) await fs.promises.copyFile(sourcePath, filePath)

  const probe = await probeFileDimensions(filePath)
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

/**
 * 删除图片记录并清理其磁盘产物。
 * - **托管副本**：删除 resources/images/ 下的文件与 resources/derivatives/<id>/ 目录
 *   （此前删除只清 DB 行，托管文件永久残留——孤儿累积）。
 * - **外链文件**：绝不触碰用户原文件（storage_mode='external' 时只清库）。
 * - 内容去重：托管路径按 asset_hash 共享，删除前确认没有别的行引用同一路径。
 * DB 行由调用方在文件清理后删除（先删文件再删行，失败时行仍在、可重试）。
 */
export async function deleteImageArtifacts(imageRefId: number): Promise<{ removedFile: boolean; removedDerivatives: boolean }> {
  const db = getDatabase()
  const row = db.exec('SELECT file_path, storage_mode, asset_hash FROM image_refs WHERE id=?', [imageRefId])[0]?.values?.[0]
  if (!row) return { removedFile: false, removedDerivatives: false }
  const filePath = String(row[0] || '')
  const storageMode = String(row[1] || '')
  const assetHash = row[2] == null ? null : String(row[2])
  const result = { removedFile: false, removedDerivatives: false }

  if (storageMode === 'managed' && filePath) {
    try {
      // 同一内容可能被多行共享（registerManagedImage 按 hash 复用）：有别的引用就不删文件。
      const shared = assetHash
        ? (db.exec('SELECT COUNT(*) FROM image_refs WHERE asset_hash=? AND file_path=? AND id<>?', [assetHash, filePath, imageRefId])[0]?.values?.[0]?.[0] as number || 0)
        : (db.exec('SELECT COUNT(*) FROM image_refs WHERE file_path=? AND id<>?', [filePath, imageRefId])[0]?.values?.[0]?.[0] as number || 0)
      if (shared === 0) {
        // 只删托管库内的文件（路径校验，防止手工入库的异常路径误删任意文件）。
        const managedRoot = path.join(getResourceRoot(), 'images')
        const resolved = path.resolve(filePath)
        if (isPathInside(managedRoot, resolved)) {
          await fs.promises.rm(resolved, { force: true })
          result.removedFile = true
        }
      }
    } catch { /* 文件清理失败不阻塞删除（行删除后成为孤儿文件，可另行清理） */ }
  }

  try {
    const derivativeRoot = path.join(getResourceRoot(), 'derivatives', String(imageRefId))
    await fs.promises.rm(derivativeRoot, { recursive: true, force: true })
    result.removedDerivatives = true
  } catch { /* 派生图清理失败不阻塞删除 */ }

  return result
}
