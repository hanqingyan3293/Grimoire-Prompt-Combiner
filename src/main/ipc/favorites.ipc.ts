// 魔导书 Grimoire v7 — 收藏 IPC
import { ipcMain } from "electron"
import { getDatabase, saveDatabase } from "../database"
import { IPC_CHANNELS } from "../../shared/types"

export function registerFavoritesIPC(): void {
  // === 标签收藏 ===
  ipcMain.handle(IPC_CHANNELS.FAV_TAG_LIST, async () => {
    const db = getDatabase()
    const r = db.exec(`
      SELECT f.id as fid, t.id, t.en, t.zh, t.subcategory_id, t.source,
             s.zh as sub_zh, c.zh as cat_zh
      FROM favorites f
      JOIN tags t ON f.tag_id = t.id
      LEFT JOIN subcategories s ON t.subcategory_id = s.id
      LEFT JOIN categories c ON s.category_id = c.id
      ORDER BY f.created_at DESC
    `)
    return r[0]?.values?.map((row: any) => ({
      fav_id: row[0],
      id: row[1], en: row[2], zh: row[3],
      subcategory_id: row[4], source: row[5],
      sub_zh: row[6], cat_zh: row[7],
    })) || []
  })

  ipcMain.handle(IPC_CHANNELS.FAV_TAG_ADD, async (_e, tagId: string) => {
    const db = getDatabase()
    try {
      db.run("INSERT OR IGNORE INTO favorites (tag_id) VALUES (?)", [tagId])
      saveDatabase()
      return true
    } catch { return false }
  })

  ipcMain.handle(IPC_CHANNELS.FAV_TAG_REMOVE, async (_e, tagId: string) => {
    const db = getDatabase()
    db.run("DELETE FROM favorites WHERE tag_id=?", [tagId])
    saveDatabase()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.FAV_TAG_CHECK, async (_e, tagId: string) => {
    const db = getDatabase()
    const r = db.exec("SELECT COUNT(*) as c FROM favorites WHERE tag_id=?", [tagId])
    return ((r[0]?.values?.[0]?.[0] as number) || 0) > 0
  })

  // === 子类收藏 ===
  ipcMain.handle(IPC_CHANNELS.FAV_SUB_LIST, async () => {
    const db = getDatabase()
    const r = db.exec(`
      SELECT sf.id as fid, s.id, s.zh, s.category_id, c.zh as cat_zh,
             (SELECT COUNT(*) FROM tags WHERE subcategory_id=s.id) as tag_count
      FROM sub_favorites sf
      JOIN subcategories s ON sf.subcategory_id = s.id
      LEFT JOIN categories c ON s.category_id = c.id
      ORDER BY sf.created_at DESC
    `)
    return r[0]?.values?.map((row: any) => ({
      fav_id: row[0],
      id: row[1], zh: row[2],
      category_id: row[3], cat_zh: row[4],
      tag_count: row[5],
    })) || []
  })

  ipcMain.handle(IPC_CHANNELS.FAV_SUB_ADD, async (_e, subId: string) => {
    const db = getDatabase()
    try {
      db.run("INSERT OR IGNORE INTO sub_favorites (subcategory_id) VALUES (?)", [subId])
      saveDatabase()
      return true
    } catch { return false }
  })

  ipcMain.handle(IPC_CHANNELS.FAV_SUB_REMOVE, async (_e, subId: string) => {
    const db = getDatabase()
    db.run("DELETE FROM sub_favorites WHERE subcategory_id=?", [subId])
    saveDatabase()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.FAV_SUB_CHECK, async (_e, subId: string) => {
    const db = getDatabase()
    const r = db.exec("SELECT COUNT(*) as c FROM sub_favorites WHERE subcategory_id=?", [subId])
    return ((r[0]?.values?.[0]?.[0] as number) || 0) > 0
  })
}