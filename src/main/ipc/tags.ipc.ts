// 魔导书 Grimoire v7 — 标签 IPC 处理器
import { ipcMain, app } from "electron"
import { getDatabase, saveDatabase } from "../database"
import { IPC_CHANNELS } from "../../shared/types"
import path from "path"
import fs from "fs"

function genId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function registerTagsIPC(): void {
  // 获取全部标签树
  ipcMain.handle(IPC_CHANNELS.TAGS_GET_ALL, async () => {
    const db = getDatabase()
    const cats = db.exec("SELECT * FROM categories ORDER BY sort_order")
    const subs = db.exec("SELECT * FROM subcategories ORDER BY sort_order")
    const tags = db.exec("SELECT * FROM tags ORDER BY sort_order")
    return {
      categories: cats[0]?.values?.map((r: any) => ({ id: r[0], en: r[1], zh: r[2], sort_order: r[3], created_at: r[4] })) || [],
      subcategories: subs[0]?.values?.map((r: any) => ({ id: r[0], category_id: r[1], en: r[2], zh: r[3], sort_order: r[4], created_at: r[5] })) || [],
      tags: tags[0]?.values?.map((r: any) => ({ id: r[0], subcategory_id: r[1], en: r[2], zh: r[3], sort_order: r[4], source: r[5], created_at: r[6] })) || [],
    }
  })

  // 标签 CRUD
  ipcMain.handle(IPC_CHANNELS.TAGS_CREATE, async (_e, data: { subcategory_id: string; en: string; zh: string }) => {
    const db = getDatabase()
    const id = genId("t_")
    db.run("INSERT INTO tags (id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM tags WHERE subcategory_id=?),'custom')",
      [id, data.subcategory_id, data.en, data.zh, data.subcategory_id])
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
    const { importDefaultTags } = require("../database")
    await importDefaultTags(jsonData)
    return true
  })

  // === 大类 CRUD ===
  ipcMain.handle(IPC_CHANNELS.CATEGORY_CREATE, async (_e, data: { zh: string }) => {
    const db = getDatabase()
    const id = genId("cat_")
    const zh = data.zh.trim()
    if (!zh) throw new Error("大类名称不能为空")
    const r = db.exec("SELECT COALESCE(MAX(sort_order),0)+1 as s FROM categories")
    const so = (r[0]?.values?.[0]?.[0] as number) || 1
    db.run("INSERT INTO categories (id,en,zh,sort_order) VALUES (?,?,?,?)", [id, zh, zh, so])
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
    const subs = db.exec("SELECT id FROM subcategories WHERE category_id=?", [id])
    for (const row of subs[0]?.values || []) {
      db.run("DELETE FROM tags WHERE subcategory_id=?", [row[0]])
    }
    db.run("DELETE FROM subcategories WHERE category_id=?", [id])
    db.run("DELETE FROM categories WHERE id=?", [id])
    saveDatabase()
    return true
  })

  // === 子类 CRUD ===
  ipcMain.handle(IPC_CHANNELS.SUBCATEGORY_CREATE, async (_e, data: { category_id: string; zh: string }) => {
    const db = getDatabase()
    const id = genId("sub_")
    const zh = data.zh.trim()
    if (!zh) throw new Error("子类名称不能为空")
    const r = db.exec("SELECT COALESCE(MAX(sort_order),0)+1 as s FROM subcategories WHERE category_id=?", [data.category_id])
    const so = (r[0]?.values?.[0]?.[0] as number) || 1
    db.run("INSERT INTO subcategories (id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?)", [id, data.category_id, zh, zh, so])
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

  // === 重置标签库 ===
  ipcMain.handle("tags:reset", async () => {
    const db = getDatabase()
    // Clear all tag data
    db.run("DELETE FROM tags")
    db.run("DELETE FROM subcategories")
    db.run("DELETE FROM categories")

    // Try multiple paths for tags.json
    const candidates = [
      path.join(app.getAppPath(), "data", "tags.json"),
      path.join(process.resourcesPath || "", "data", "tags.json"),
      path.join(__dirname, "..", "..", "data", "tags.json"), // dev: dist/main/main → ../../data/tags.json
      path.join(__dirname, "..", "..", "..", "data", "tags.json"), // alt dev path
    ]

    let loaded = false
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          const data = fs.readFileSync(p, "utf-8")
          // Validate JSON
          JSON.parse(data)
          const { importDefaultTags } = require("../database")
          await importDefaultTags(data)
          loaded = true
          break
        }
      } catch (e) {
        console.error("tags:reset - failed at", p, e)
      }
    }

    if (!loaded) {
      // Last resort: try relative from current working directory
      const cwdPath = path.join(process.cwd(), "data", "tags.json")
      if (fs.existsSync(cwdPath)) {
        const { importDefaultTags } = require("../database")
        await importDefaultTags(fs.readFileSync(cwdPath, "utf-8"))
        loaded = true
      }
    }

    if (!loaded) {
      throw new Error("找不到 data/tags.json，请确认文件存在")
    }
    saveDatabase()
    return true
  })
}
