// 魔导书 Grimoire v7 — 图片 IPC 处理器
import { ipcMain, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDatabase, saveDatabase } from '../database'
import { IPC_CHANNELS, type ImageRef } from '../../shared/types'
import { inspectImageFile } from '../services/asset.core'
import { deleteImagesFromLibrary, existingImageRefIds, ImageDeletionError, probeFileDimensions, registerManagedImage } from '../services/image-asset.service'
import { parseMediaMetadata } from '../services/media-metadata.service'
import { requireId } from '../services/input-validation'
import { createImageDerivatives, ensureMediaAsset } from '../services/media.service'

function rowToImage(r: unknown[]): ImageRef {
  return {
    id: Number(r[0]),
    file_path: String(r[1]),
    storage_mode: r[3] === 'managed' ? 'managed' : 'external',
    asset_hash: r[4] ? String(r[4]) : null,
    mime_type: r[5] ? String(r[5]) : null,
    file_size: r[6] === null || r[6] === undefined ? null : Number(r[6]),
    original_name: r[7] ? String(r[7]) : null,
    available: r[8] !== 0,
    created_at: String(r[2]),
  }
}

export function registerImagesIPC(): void {
  ipcMain.handle(IPC_CHANNELS.IMAGES_LIST, async () => {
    const db = getDatabase()
    const result = db.exec('SELECT id, file_path, created_at, storage_mode, asset_hash, mime_type, file_size, original_name, available FROM image_refs ORDER BY created_at DESC')
    return (result[0]?.values || []).map(row => {
      const image = rowToImage(row)
      return { ...image, available: fs.existsSync(image.file_path) }
    })
  })

  // 分页变体：ImagesPanel 用它避免大库全量加载（旧接口保持原样给其他调用方）。
  ipcMain.handle(IPC_CHANNELS.IMAGES_LIST_PAGED, async (_event, input: unknown) => {
    const value = (input || {}) as { limit?: unknown; offset?: unknown }
    const limit = Math.max(1, Math.min(500, Math.floor(Number(value.limit) || 60)))
    const offset = Math.max(0, Math.floor(Number(value.offset) || 0))
    const db = getDatabase()
    const total = Number(db.exec('SELECT COUNT(*) FROM image_refs')[0]?.values?.[0]?.[0] || 0)
    const result = db.exec('SELECT id, file_path, created_at, storage_mode, asset_hash, mime_type, file_size, original_name, available FROM image_refs ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset])
    const items = (result[0]?.values || []).map(row => {
      const image = rowToImage(row)
      return { ...image, available: fs.existsSync(image.file_path) }
    })
    return { items, total, limit, offset }
  })

  ipcMain.handle(IPC_CHANNELS.IMAGES_ADD, async (_event, requestedMode: 'managed' | 'external' = 'managed') => {
    const mode = requestedMode === 'external' ? 'external' : 'managed'
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
    })
    if (result.canceled || !result.filePaths.length) return null
    
    const db = getDatabase()
    const sourcePath = path.resolve(result.filePaths[0])
    const inspection = await inspectImageFile(sourcePath)
    let filePath = sourcePath

    if (mode === 'managed') {
      const registered = await registerManagedImage(sourcePath)
      const media = ensureMediaAsset(registered.id, 'imported-reference', registered.original_name)
      void createImageDerivatives(registered.id)
      void parseMediaMetadata(media.id).catch(error => console.warn('[images] metadata parse failed for ' + media.id, error))
      return registered
    }

    const probe = await probeFileDimensions(filePath)
    db.run('INSERT INTO image_refs (file_path, storage_mode, asset_hash, mime_type, file_size, original_name, available, width, height, file_mtime) VALUES (?,?,?,?,?,?,?,?,?,?)', [filePath, mode, inspection.hash, inspection.mimeType, inspection.size, inspection.originalName, 1, probe.width, probe.height, probe.mtimeMs])
    saveDatabase()
    
    const idResult = db.exec('SELECT last_insert_rowid()')
    const id = idResult[0]?.values?.[0]?.[0] as number
    const externalMedia = ensureMediaAsset(id, 'external-link', inspection.originalName)
    void createImageDerivatives(id)
    void parseMediaMetadata(externalMedia.id).catch(error => console.warn('[images] metadata parse failed for ' + externalMedia.id, error))
    return { id, file_path: filePath, storage_mode: mode }
  })

  ipcMain.handle(IPC_CHANNELS.IMAGES_DELETE, async (_event, id: unknown) => {
    const result = deleteImagesFromLibrary([id])
    if (result.status !== 'completed') throw new ImageDeletionError('IMAGE_CLEANUP_FAILED', result.failures[0]?.message || '图片清理未完成', result)
    return true
  })
  ipcMain.handle(IPC_CHANNELS.IMAGES_DELETE_BATCH, async (_event, input: unknown) => {
    if (!input || typeof input !== 'object' || !Array.isArray((input as { ids?: unknown }).ids)) throw new ImageDeletionError('INVALID_IMAGE_ID', '批量删除需要图片 ID 数组')
    return deleteImagesFromLibrary((input as { ids: unknown[] }).ids)
  })

  ipcMain.handle(IPC_CHANNELS.IMAGES_EXISTING_IDS, async (_event, input: unknown) => {
    if (!input || typeof input !== 'object' || !Array.isArray((input as { ids?: unknown }).ids)) throw new ImageDeletionError('INVALID_IMAGE_ID', '选择校验需要图片 ID 数组')
    return existingImageRefIds((input as { ids: unknown[] }).ids)
  })

  ipcMain.handle(IPC_CHANNELS.IMAGES_IMPORT_DATA, async (_event, dataBase64: unknown, originalName: unknown) => {
    if (typeof dataBase64 !== 'string' || !dataBase64 || dataBase64.length > 140_000_000) throw new Error('图片数据无效或过大')
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'grimoire-image-import-'))
    const tempPath = path.join(tempRoot, 'input')
    try {
      await fs.promises.writeFile(tempPath, Buffer.from(dataBase64, 'base64'))
      const registered = await registerManagedImage(tempPath, typeof originalName === 'string' ? originalName : undefined)
      const importedMedia = ensureMediaAsset(registered.id, 'imported-reference', registered.original_name)
      void createImageDerivatives(registered.id)
      void parseMediaMetadata(importedMedia.id).catch(error => console.warn('[images] metadata parse failed for ' + importedMedia.id, error))
      return registered
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true })
    }
  })

  ipcMain.handle(IPC_CHANNELS.IMAGES_READ_DATA, async (_event, id: unknown) => {
    requireId(String(id), '图片 ID')
    const row = getDatabase().exec('SELECT file_path, mime_type, available FROM image_refs WHERE id=?', [Number(id)])
    const value = row[0]?.values?.[0]
    if (!value || Number(value[2]) === 0 || !fs.existsSync(String(value[0]))) throw new Error('图片文件不可用')
    const mime = typeof value[1] === 'string' && value[1] ? value[1] : 'image/png'
    return `data:${mime};base64,${(await fs.promises.readFile(String(value[0]))).toString('base64')}`
  })
}
