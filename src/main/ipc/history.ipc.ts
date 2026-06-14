// 魔导书 Grimoire v7 — 历史记录 IPC 处理器
import { ipcMain } from 'electron'
import { getDatabase, saveDatabase } from '../database'
import { IPC_CHANNELS } from '../../shared/types'
import crypto from 'crypto'

export function registerHistoryIPC(): void {
  ipcMain.handle(IPC_CHANNELS.HISTORY_LIST, async () => {
    const db = getDatabase()
    const result = db.exec('SELECT * FROM history ORDER BY created_at DESC LIMIT 200')
    return (result[0]?.values || []).map(r => ({
      id: r[0], prompt: r[1], positive_count: r[2], negative_count: r[3], created_at: r[4],
    }))
  })

  ipcMain.handle(IPC_CHANNELS.HISTORY_ADD, async (_event, data: {
    prompt: string; positive_count: number; negative_count: number
  }) => {
    const db = getDatabase()
    const id = 'hist_' + crypto.randomUUID().slice(0, 8)
    db.run(
      'INSERT INTO history (id, prompt, positive_count, negative_count) VALUES (?,?,?,?)',
      [id, data.prompt, data.positive_count, data.negative_count]
    )
    saveDatabase()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.HISTORY_CLEAR, async () => {
    const db = getDatabase()
    db.run('DELETE FROM history')
    saveDatabase()
    return true
  })
}
