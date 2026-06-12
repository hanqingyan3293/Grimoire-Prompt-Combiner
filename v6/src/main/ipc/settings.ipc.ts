import { ipcMain } from 'electron'
import { getDatabase, saveDatabase } from '../database'

export function registerSettingsIPC(): void {
  const db = () => getDatabase()

  ipcMain.handle('settings:get', async (_e, key: string) => {
    const r = db().exec(`SELECT value FROM settings WHERE key = ?`, [key])
    return r[0]?.values?.[0]?.[0] ?? null
  })

  ipcMain.handle('settings:set', async (_e, key: string, value: string) => {
    db().run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value])
    saveDatabase()
    return { ok: true }
  })

  ipcMain.handle('settings:getAll', async () => {
    const r = db().exec(`SELECT key, value FROM settings`)
    const obj: Record<string, string> = {}
    for (const row of r[0]?.values ?? []) {
      obj[row[0] as string] = row[1] as string
    }
    return obj
  })
}
