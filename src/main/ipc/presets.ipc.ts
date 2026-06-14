// 魔导书 Grimoire v7 — 预设 IPC 处理器
import { ipcMain } from 'electron'
import { getDatabase, saveDatabase } from '../database'
import { IPC_CHANNELS } from '../../shared/types'
import crypto from 'crypto'

export function registerPresetsIPC(): void {
  ipcMain.handle(IPC_CHANNELS.PRESETS_LIST, async () => {
    const db = getDatabase()
    const result = db.exec('SELECT * FROM presets ORDER BY updated_at DESC')
    return (result[0]?.values || []).map(r => ({
      id: r[0], name: r[1], data: JSON.parse(r[2] as string),
      created_at: r[3], updated_at: r[4],
    }))
  })

  ipcMain.handle(IPC_CHANNELS.PRESETS_SAVE, async (_event, data: {
    id?: string; name: string; data: object
  }) => {
    const db = getDatabase()
    const id = data.id || 'preset_' + crypto.randomUUID().slice(0, 8)
    const now = new Date().toISOString()
    const jsonData = JSON.stringify(data.data)
    
    const existing = db.exec('SELECT id FROM presets WHERE id=?', [id])
    if (existing[0]?.values?.length) {
      db.run('UPDATE presets SET name=?, data=?, updated_at=? WHERE id=?',
        [data.name, jsonData, now, id])
    } else {
      db.run('INSERT INTO presets (id, name, data, created_at, updated_at) VALUES (?,?,?,?,?)',
        [id, data.name, jsonData, now, now])
    }
    saveDatabase()
    return { id, name: data.name }
  })

  ipcMain.handle(IPC_CHANNELS.PRESETS_DELETE, async (_event, id: string) => {
    const db = getDatabase()
    db.run('DELETE FROM presets WHERE id=?', [id])
    saveDatabase()
    return true
  })
}
