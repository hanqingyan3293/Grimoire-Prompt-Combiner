import { ipcMain } from 'electron'
import { getDatabase, saveDatabase } from '../database'
import { parseImageMetadata } from '../services/image-parser.service'

export function registerImagesIPC(): void {
  const db = () => getDatabase()

  ipcMain.handle('images:parse', async (_e, filePath: string) => {
    try {
      const metadata = await parseImageMetadata(filePath)
      db().run(`INSERT INTO image_refs (file_path, metadata) VALUES (?, ?)`,
        [filePath, JSON.stringify(metadata)])
      saveDatabase()
      return { ok: true, metadata }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('images:getRefs', async () => {
    const r = db().exec(`SELECT * FROM image_refs ORDER BY created_at DESC LIMIT 50`)
    return { refs: (r[0]?.values ?? []).map((ref: any) => ({
      id: ref[0], file_path: ref[1], metadata: ref[2] ? JSON.parse(ref[2] as string) : null, created_at: ref[3]
    }))}
  })

  ipcMain.handle('images:deleteRef', async (_e, id: number) => {
    db().run(`DELETE FROM image_refs WHERE id = ?`, [id])
    saveDatabase()
    return { ok: true }
  })
}
