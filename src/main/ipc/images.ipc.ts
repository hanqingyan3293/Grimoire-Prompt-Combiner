// 魔导书 Grimoire v7 — 图片 IPC 处理器
import { ipcMain, dialog } from 'electron'
import { getDatabase, saveDatabase } from '../database'
import { IPC_CHANNELS } from '../../shared/types'

export function registerImagesIPC(): void {
  ipcMain.handle(IPC_CHANNELS.IMAGES_LIST, async () => {
    const db = getDatabase()
    const result = db.exec('SELECT * FROM image_refs ORDER BY created_at DESC')
    return (result[0]?.values || []).map(r => ({
      id: r[0], file_path: r[1], created_at: r[2],
    }))
  })

  ipcMain.handle(IPC_CHANNELS.IMAGES_ADD, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
    })
    if (result.canceled || !result.filePaths.length) return null
    
    const db = getDatabase()
    const filePath = result.filePaths[0]
    db.run('INSERT INTO image_refs (file_path) VALUES (?)', [filePath])
    saveDatabase()
    
    const idResult = db.exec('SELECT last_insert_rowid()')
    const id = idResult[0]?.values?.[0]?.[0] as number
    return { id, file_path: filePath }
  })

  ipcMain.handle(IPC_CHANNELS.IMAGES_DELETE, async (_event, id: number) => {
    const db = getDatabase()
    db.run('DELETE FROM image_refs WHERE id=?', [id])
    saveDatabase()
    return true
  })
}
