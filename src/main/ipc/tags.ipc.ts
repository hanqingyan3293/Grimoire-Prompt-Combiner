// 魔导书 Grimoire v7 — 标签 IPC
import { ipcMain } from "electron"
import { getDatabase, saveDatabase } from "../database"
import { getActiveGroupId } from "./tagGroups.ipc"
import { IPC_CHANNELS } from "../../shared/types"
import crypto from "crypto"

const genId = (prefix: string) => prefix + crypto.randomUUID().slice(0, 8)

export function registerTagsIPC(): void {
  // 获取全部标签
  ipcMain.handle(IPC_CHANNELS.TAGS_GET_ALL, async () => {
    const db = getDatabase()
    const gid = getActiveGroupId()
    const cats = db.exec("SELECT * FROM categories WHERE group_id='" + gid + "' ORDER BY sort_order")
    const subs = db.exec("SELECT * FROM subcategories WHERE group_id='" + gid + "' ORDER BY sort_order")
    const tags = db.exec("SELECT * FROM tags WHERE group_id='" + gid + "' ORDER BY sort_order")
    return {
      categories: cats[0]?.values?.map((r: any) => ({ id: r[0], en: r[2], zh: r[3], sort_order: r[4], created_at: r[5] })) || [],
      subcategories: subs[0]?.values?.map((r: any) => ({ id: r[0], category_id: r[2], en: r[3], zh: r[4], sort_order: r[5], created_at: r[6] })) || [],
      tags: tags[0]?.values?.map((r: any) => ({ id: r[0], subcategory_id: r[2], en: r[3], zh: r[4], sort_order: r[5], source: r[6], created_at: r[7] })) || [],
    }
  })

  // 标签 CRUD
  ipcMain.handle(IPC_CHANNELS.TAGS_CREATE, async (_e, data: { subcategory_id: string; en: string; zh: string }) => {
    const db = getDatabase()
    const gid = getActiveGroupId()
    const id = genId("t_")
    db.run("INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM tags WHERE subcategory_id=?),'custom')",
      [id, gid, data.subcategory_id, data.en, data.zh, data.subcategory_id])
    saveDatabase()
    return { id, ...data, source: "custom" }
  })

  ipcMain.handle(IPC_CHANNELS.TAGS_UPDATE, async (_e, data: { id: string; en: string; zh: string }) => {
    getDatabase().run("UPDATE tags SET en=?, zh=? WHERE id=?", [data.en, data.zh, data.id])
    saveDatabase()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.TAGS_DELETE, async (_e, id: string) => {
    getDatabase().run("DELETE FROM tags WHERE id=?", [id])
    saveDatabase()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.TAGS_IMPORT, async (_e, jsonData: string) => {
    const db = getDatabase()
    const gid = getActiveGroupId()
    const data = JSON.parse(jsonData)
    const tags: Array<{ id: string; subcategory_id: string; en: string; zh: string }> = data.tags || []
    for (const t of tags) {
      const exists = db.exec("SELECT 1 FROM tags WHERE id=?", [t.id])
      if (exists[0]?.values?.length) {
        db.run("UPDATE tags SET en=?, zh=?, group_id=? WHERE id=?", [t.en, t.zh, gid, t.id])
      } else {
        db.run("INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,1,'imported')",
          [t.id, gid, t.subcategory_id, t.en, t.zh])
      }
    }
    saveDatabase()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.TAGS_RESET, async () => {
    const db = getDatabase()
    const gid = getActiveGroupId()
    db.run("DELETE FROM tags WHERE group_id=?", [gid])
    db.run("DELETE FROM subcategories WHERE group_id=?", [gid])
    db.run("DELETE FROM categories WHERE group_id=?", [gid])
    saveDatabase()
    return true
  })

  // === 大类 CRUD ===
  ipcMain.handle(IPC_CHANNELS.CATEGORY_CREATE, async (_e, data: { zh: string }) => {
    const db = getDatabase()
    const gid = getActiveGroupId()
    const id = genId("cat_")
    const zh = data.zh.trim()
    if (!zh) throw new Error("大类名称不能为空")
    const r = db.exec("SELECT COALESCE(MAX(sort_order),0)+1 as s FROM categories WHERE group_id=?", [gid])
    const so = (r[0]?.values?.[0]?.[0] as number) || 1
    db.run("INSERT INTO categories (id,group_id,en,zh,sort_order) VALUES (?,?,?,?,?)", [id, gid, zh, zh, so])
    saveDatabase()
    return { id, zh, sort_order: so }
  })

  ipcMain.handle(IPC_CHANNELS.CATEGORY_UPDATE, async (_e, data: { id: string; zh: string }) => {
    const zh = data.zh.trim()
    if (!zh) throw new Error("大类名称不能为空")
    getDatabase().run("UPDATE categories SET zh=?, en=? WHERE id=?", [zh, zh, data.id])
    saveDatabase()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.CATEGORY_DELETE, async (_e, id: string) => {
    const db = getDatabase()
    db.run("DELETE FROM tags WHERE subcategory_id IN (SELECT id FROM subcategories WHERE category_id=?)", [id])
    db.run("DELETE FROM subcategories WHERE category_id=?", [id])
    db.run("DELETE FROM categories WHERE id=?", [id])
    saveDatabase()
    return true
  })

  // === 子类 CRUD ===
  ipcMain.handle(IPC_CHANNELS.SUBCATEGORY_CREATE, async (_e, data: { category_id: string; zh: string }) => {
    const db = getDatabase()
    const gid = getActiveGroupId()
    const id = genId("sub_")
    const zh = data.zh.trim()
    if (!zh) throw new Error("子类名称不能为空")
    const r = db.exec("SELECT COALESCE(MAX(sort_order),0)+1 as s FROM subcategories WHERE category_id=?", [data.category_id])
    const so = (r[0]?.values?.[0]?.[0] as number) || 1
    db.run("INSERT INTO subcategories (id,group_id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?,?)", [id, gid, data.category_id, zh, zh, so])
    saveDatabase()
    return { id, zh, sort_order: so, category_id: data.category_id }
  })

  ipcMain.handle(IPC_CHANNELS.SUBCATEGORY_UPDATE, async (_e, data: { id: string; zh: string }) => {
    const zh = data.zh.trim()
    if (!zh) throw new Error("子类名称不能为空")
    getDatabase().run("UPDATE subcategories SET zh=?, en=? WHERE id=?", [zh, zh, data.id])
    saveDatabase()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.SUBCATEGORY_DELETE, async (_e, id: string) => {
    const db = getDatabase()
    db.run("DELETE FROM tags WHERE subcategory_id=?", [id])
    db.run("DELETE FROM subcategories WHERE id=?", [id])
    saveDatabase()
    return true
  })
}