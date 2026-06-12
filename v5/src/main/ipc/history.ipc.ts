import { ipcMain } from 'electron'
import { getDatabase, saveDatabase } from '../database'

export function registerHistoryIPC(): void {
  const db = () => getDatabase()

  ipcMain.handle('history:getAll', async (_e, limit: number = 50) => {
    const r = db().exec(`SELECT * FROM history ORDER BY created_at DESC LIMIT ?`, [limit])
    return { items: (r[0]?.values ?? []).map((h: any) => ({
      id: h[0], prompt: h[1], data: JSON.parse(h[2]), created_at: h[3]
    }))}
  })

  ipcMain.handle('history:add', async (_e, data: any) => {
    const id = `hist_${Date.now()}`
    db().run(`INSERT INTO history (id, prompt, data) VALUES (?, ?, ?)`,
      [id, data.prompt, JSON.stringify(data)])
    saveDatabase()
    return { ok: true }
  })

  ipcMain.handle('history:delete', async (_e, id: string) => {
    db().run(`DELETE FROM history WHERE id = ?`, [id])
    saveDatabase()
    return { ok: true }
  })

  ipcMain.handle('history:clear', async () => {
    db().run(`DELETE FROM history`)
    saveDatabase()
    return { ok: true }
  })

  ipcMain.handle('snapshots:getAll', async () => {
    const r = db().exec(`SELECT * FROM snapshots ORDER BY created_at DESC`)
    return { snapshots: (r[0]?.values ?? []).map((s: any) => ({
      id: s[0], name: s[1], data: JSON.parse(s[2]), created_at: s[3]
    }))}
  })

  ipcMain.handle('snapshots:save', async (_e, data: any) => {
    const id = `snap_${Date.now()}`
    db().run(`INSERT INTO snapshots (id, name, data) VALUES (?, ?, ?)`,
      [id, data.name, JSON.stringify(data.data)])
    saveDatabase()
    return { ok: true }
  })

  ipcMain.handle('snapshots:delete', async (_e, id: string) => {
    db().run(`DELETE FROM snapshots WHERE id = ?`, [id])
    saveDatabase()
    return { ok: true }
  })
}
