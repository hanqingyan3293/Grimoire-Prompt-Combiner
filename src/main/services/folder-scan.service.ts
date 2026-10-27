// 文件夹扫描导入（SD Image Sorter gallery-import 语义）：
// 扫描目录列出图片（不导入），用户勾选后再按托管/外链两种模式导入。
// 路径比较在 Windows 下大小写不敏感（存库路径与扫描路径要能匹配上）。
import fs from 'fs'
import path from 'path'
import { getDatabase, saveDatabase } from '../database'
import type { LegacyDatabase } from './sqlite.compat'
import { registerManagedImage } from './image-asset.service'
import { ensureMediaAsset } from './media.service'
import { parseMediaMetadata } from './media-metadata.service'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
const MAX_SCAN_FILES = 20_000

export interface ScannedFileEntry {
  filePath: string
  fileName: string
  size: number
  alreadyImported: boolean
}

export interface FolderImportResult {
  imported: number
  skipped: number
  failed: number
  imageIds: number[]
}

/** 归一化路径用于比较：绝对路径 + Windows 下小写。 */
function normalizeForCompare(filePath: string): string {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function collectKnownPaths(db: LegacyDatabase): Set<string> {
  const rows = db.exec('SELECT file_path FROM image_refs')[0]?.values || []
  const known = new Set<string>()
  for (const row of rows) {
    const filePath = String(row[0] || '')
    if (filePath) known.add(normalizeForCompare(filePath))
  }
  return known
}

/**
 * 扫描目录下的图片文件。返回未导入者在前、按文件名升序；
 * 目录不存在/不是目录抛清晰错误；文件数超上限截断并如实计数。
 */
export async function scanImageDirectory(
  db: LegacyDatabase,
  input: { directory: string; recursive?: boolean },
): Promise<{ directory: string; entries: ScannedFileEntry[]; total: number }> {
  const directory = String(input.directory || '').trim()
  if (!directory) throw new Error('扫描目录无效')
  let stats: fs.Stats
  try {
    stats = await fs.promises.stat(directory)
  } catch {
    throw new Error('扫描目录不存在或不可访问')
  }
  if (!stats.isDirectory()) throw new Error('扫描路径不是目录')

  const known = collectKnownPaths(db)
  const entries: ScannedFileEntry[] = []
  const walk = async (current: string): Promise<void> => {
    if (entries.length >= MAX_SCAN_FILES) return
    let dirents: fs.Dirent[]
    try {
      dirents = await fs.promises.readdir(current, { withFileTypes: true })
    } catch {
      return // 单个子目录不可读不中断整次扫描
    }
    for (const dirent of dirents) {
      if (entries.length >= MAX_SCAN_FILES) return
      const full = path.join(current, dirent.name)
      if (dirent.isDirectory()) {
        if (input.recursive) await walk(full)
        continue
      }
      if (!dirent.isFile()) continue
      if (!IMAGE_EXTENSIONS.has(path.extname(dirent.name).toLowerCase())) continue
      let fileStats: fs.Stats
      try { fileStats = await fs.promises.stat(full) } catch { continue }
      entries.push({ filePath: full, fileName: dirent.name, size: fileStats.size, alreadyImported: known.has(normalizeForCompare(full)) })
    }
  }
  await walk(path.resolve(directory))

  entries.sort((a, b) => {
    if (a.alreadyImported !== b.alreadyImported) return a.alreadyImported ? 1 : -1
    return a.fileName.localeCompare(b.fileName)
  })
  return { directory: path.resolve(directory), entries, total: entries.length }
}

/**
 * 按给定路径导入：已存在（同路径行）计入 skipped；
 * managed 复制进托管库（内容相同的自动复用已有记录），external 直接登记文件路径。
 * 单文件失败继续不中断；成功项触发元数据解析（fire-and-forget）。
 */
export async function importScannedFiles(
  db: LegacyDatabase,
  input: { filePaths: string[]; mode?: 'managed' | 'external' },
): Promise<FolderImportResult> {
  const filePaths = Array.isArray(input.filePaths) ? input.filePaths.map(value => String(value || '')).filter(Boolean) : []
  const mode = input.mode === 'external' ? 'external' : 'managed'
  const known = collectKnownPaths(db)
  const result: FolderImportResult = { imported: 0, skipped: 0, failed: 0, imageIds: [] }

  for (const filePath of filePaths) {
    const normalized = normalizeForCompare(filePath)
    if (known.has(normalized)) { result.skipped += 1; continue }
    try {
      if (!fs.existsSync(filePath)) { result.failed += 1; continue }
      let imageId: number
      if (mode === 'managed') {
        const registered = await registerManagedImage(filePath)
        imageId = registered.id
      } else {
        const fileStats = await fs.promises.stat(filePath)
        const ext = path.extname(filePath).slice(1).toLowerCase()
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'bmp' ? 'image/bmp' : 'image/png'
        const insert = db.run(
          'INSERT INTO image_refs (file_path,storage_mode,mime_type,file_size,original_name,available) VALUES (?,?,?,?,?,1)',
          [path.resolve(filePath), 'external', mime, fileStats.size, path.basename(filePath)],
        )
        imageId = Number(insert.lastInsertRowid)
        saveDatabase()
      }
      if (!Number.isInteger(imageId) || imageId <= 0) { result.failed += 1; continue }
      const media = ensureMediaAsset(imageId, 'imported-reference', path.basename(filePath))
      void parseMediaMetadata(media.id).catch(() => { /* 元数据解析失败不阻塞导入 */ })
      known.add(normalized)
      result.imported += 1
      result.imageIds.push(imageId)
    } catch {
      result.failed += 1
    }
  }
  return result
}
