// 魔导书 Grimoire v7 — 图片 IPC 处理器
import { ipcMain, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDatabase, saveDatabase } from '../database'
import { IPC_CHANNELS, type ImageRef } from '../../shared/types'
import { inspectImageFile } from '../services/asset.core'
import { registerManagedImage } from '../services/image-asset.service'
import { requireId } from '../services/input-validation'

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
      return registerManagedImage(sourcePath)
    }

    db.run('INSERT INTO image_refs (file_path, storage_mode, asset_hash, mime_type, file_size, original_name, available) VALUES (?,?,?,?,?,?,?)', [filePath, mode, inspection.hash, inspection.mimeType, inspection.size, inspection.originalName, 1])
    saveDatabase()
    
    const idResult = db.exec('SELECT last_insert_rowid()')
    const id = idResult[0]?.values?.[0]?.[0] as number
    return { id, file_path: filePath, storage_mode: mode }
  })

  ipcMain.handle(IPC_CHANNELS.IMAGES_DELETE, async (_event, id: number) => {
    requireId(String(id), '图片 ID')
    const db = getDatabase()
    db.run('DELETE FROM image_refs WHERE id=?', [id])
    saveDatabase()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.IMAGES_IMPORT_DATA, async (_event, dataBase64: unknown, originalName: unknown) => {
    if (typeof dataBase64 !== 'string' || !dataBase64 || dataBase64.length > 140_000_000) throw new Error('图片数据无效或过大')
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'grimoire-image-import-'))
    const tempPath = path.join(tempRoot, 'input')
    try {
      await fs.promises.writeFile(tempPath, Buffer.from(dataBase64, 'base64'))
      return await registerManagedImage(tempPath, typeof originalName === 'string' ? originalName : undefined)
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true })
    }
  })
}
