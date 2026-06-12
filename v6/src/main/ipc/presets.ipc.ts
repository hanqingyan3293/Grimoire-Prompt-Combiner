import { ipcMain } from 'electron'
import { getDatabase, saveDatabase } from '../database'

export function registerPresetsIPC(): void {
  const db = () => getDatabase()

  ipcMain.handle('presets:getAll', async () => {
    const r = db().exec(`SELECT * FROM presets ORDER BY updated_at DESC`)
    return { presets: (r[0]?.values ?? []).map((p: any) => ({
      id: p[0], name: p[1], data: JSON.parse(p[2]), created_at: p[3], updated_at: p[4]
    }))}
  })

  ipcMain.handle('presets:save', async (_e, data: any) => {
    const id = data.id || `preset_${Date.now()}`
    db().run(`INSERT OR REPLACE INTO presets (id, name, data, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))`,
      [id, data.name, JSON.stringify(data.data)])
    saveDatabase()
    return { ok: true, id }
  })

  ipcMain.handle('presets:delete', async (_e, id: string) => {
    db().run(`DELETE FROM presets WHERE id = ?`, [id])
    saveDatabase()
    return { ok: true }
  })

  ipcMain.handle('presets:export', async (_e, id: string) => {
    const r = db().exec(`SELECT * FROM presets WHERE id = ?`, [id])
    if (!r[0]?.values?.length) return { error: 'not found' }
    const p = r[0].values[0]
    return { id: p[0], name: p[1], data: JSON.parse(p[2] as string) }
  })

  ipcMain.handle('presets:import', async (_e, data: any) => {
    const id = `preset_${Date.now()}`
    db().run(`INSERT INTO presets (id, name, data) VALUES (?, ?, ?)`,
      [id, data.name, JSON.stringify(data.data)])
    saveDatabase()
    return { ok: true, id }
  })
}
