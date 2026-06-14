// 魔导书 Grimoire v7 — 标签组 IPC
import { ipcMain } from "electron"
import { getDatabase, saveDatabase } from "../database"
import { IPC_CHANNELS } from "../../shared/types"
import crypto from "crypto"

export function getActiveGroupId(): string {
  const db = getDatabase()
  const r = db.exec("SELECT id FROM tag_groups WHERE is_active=1 LIMIT 1")
  return (r[0]?.values?.[0]?.[0] as string) || "default"
}

export function registerTagGroupsIPC(): void {
  // 列表
  ipcMain.handle(IPC_CHANNELS.TAG_GROUPS_LIST, async () => {
    const db = getDatabase()
    const r = db.exec("SELECT * FROM tag_groups ORDER BY created_at ASC")
    return (r[0]?.values || []).map(row => ({
      id: row[0], name: row[1], is_active: row[2] === 1, created_at: row[3]
    }))
  })

  // 创建
  ipcMain.handle(IPC_CHANNELS.TAG_GROUPS_CREATE, async (_e, name: string, copyFromGroupId?: string) => {
    const db = getDatabase()
    const id = "grp_" + crypto.randomUUID().slice(0, 8)
    db.run("INSERT INTO tag_groups (id, name) VALUES (?,?)", [id, name])
    // 如果指定了复制源，复制标签数据
    if (copyFromGroupId) {
      const cats = db.exec("SELECT * FROM categories WHERE group_id=?", [copyFromGroupId])
      const subs = db.exec("SELECT * FROM subcategories WHERE group_id=?", [copyFromGroupId])
      const tags = db.exec("SELECT * FROM tags WHERE group_id=?", [copyFromGroupId])
      for (const c of cats[0]?.values || []) db.run("INSERT INTO categories (id,group_id,en,zh,sort_order) VALUES (?,?,?,?,?)", [c[0], id, c[2], c[3], c[4]])
      for (const s of subs[0]?.values || []) db.run("INSERT INTO subcategories (id,group_id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?,?)", [s[0], id, s[2], s[3], s[4], s[5]])
      for (const t of tags[0]?.values || []) db.run("INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)", [t[0], id, t[2], t[3], t[4], t[5], t[6]])
    }
    saveDatabase()
    return { id }
  })

  // 删除
  ipcMain.handle(IPC_CHANNELS.TAG_GROUPS_DELETE, async (_e, id: string) => {
    const db = getDatabase()
    db.run("DELETE FROM tags WHERE group_id=?", [id])
    db.run("DELETE FROM subcategories WHERE group_id=?", [id])
    db.run("DELETE FROM categories WHERE group_id=?", [id])
    db.run("DELETE FROM tag_groups WHERE id=?", [id])
    saveDatabase()
    return true
  })

  // 重命名
  ipcMain.handle(IPC_CHANNELS.TAG_GROUPS_RENAME, async (_e, id: string, name: string) => {
    const db = getDatabase()
    db.run("UPDATE tag_groups SET name=? WHERE id=?", [name, id])
    saveDatabase()
    return true
  })

  // 复制
  ipcMain.handle(IPC_CHANNELS.TAG_GROUPS_COPY, async (_e, id: string, newName: string) => {
    const db = getDatabase()
    const newId = "grp_" + crypto.randomUUID().slice(0, 8)
    db.run("INSERT INTO tag_groups (id, name) VALUES (?,?)", [newId, newName])
    const cats = db.exec("SELECT * FROM categories WHERE group_id=?", [id])
    const subs = db.exec("SELECT * FROM subcategories WHERE group_id=?", [id])
    const tags = db.exec("SELECT * FROM tags WHERE group_id=?", [id])
    for (const c of cats[0]?.values || []) db.run("INSERT INTO categories (id,group_id,en,zh,sort_order) VALUES (?,?,?,?,?)", [c[0], newId, c[2], c[3], c[4]])
    for (const s of subs[0]?.values || []) db.run("INSERT INTO subcategories (id,group_id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?,?)", [s[0], newId, s[2], s[3], s[4], s[5]])
    for (const t of tags[0]?.values || []) db.run("INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)", [t[0], newId, t[2], t[3], t[4], t[5], t[6]])
    saveDatabase()
    return { id: newId }
  })

  // 设置活跃
  ipcMain.handle(IPC_CHANNELS.TAG_GROUPS_SET_ACTIVE, async (_e, id: string) => {
    const db = getDatabase()
    db.run("UPDATE tag_groups SET is_active=0")
    db.run("UPDATE tag_groups SET is_active=1 WHERE id=?", [id])
    saveDatabase()
    return true
  })

  // 导出组（完整JSON）
  ipcMain.handle(IPC_CHANNELS.TAG_GROUPS_EXPORT, async (_e, id: string) => {
    const db = getDatabase()
    const group = db.exec("SELECT * FROM tag_groups WHERE id=?", [id])
    const cats = db.exec("SELECT id, en, zh, sort_order FROM categories WHERE group_id=? ORDER BY sort_order", [id])
    const subs = db.exec("SELECT id, category_id, en, zh, sort_order FROM subcategories WHERE group_id=? ORDER BY sort_order", [id])
    const tags = db.exec("SELECT id, subcategory_id, en, zh, sort_order, source FROM tags WHERE group_id=? ORDER BY sort_order", [id])
    return {
      group: group[0]?.values?.[0] ? { id: group[0].values[0][0], name: group[0].values[0][1] } : null,
      categories: (cats[0]?.values || []).map(r => ({ id: r[0], en: r[1], zh: r[2], sort_order: r[3] })),
      subcategories: (subs[0]?.values || []).map(r => ({ id: r[0], category_id: r[1], en: r[2], zh: r[3], sort_order: r[4] })),
      tags: (tags[0]?.values || []).map(r => ({ id: r[0], subcategory_id: r[1], en: r[2], zh: r[3], sort_order: r[4], source: r[5] })),
    }
  })

  // 导入组（完整JSON）
  ipcMain.handle(IPC_CHANNELS.TAG_GROUPS_IMPORT, async (_e, data: any, groupName: string) => {
    const db = getDatabase()
    const id = "grp_" + crypto.randomUUID().slice(0, 8)
    db.run("INSERT INTO tag_groups (id, name) VALUES (?,?)", [id, groupName])
    for (const c of data.categories || []) db.run("INSERT OR REPLACE INTO categories (id,group_id,en,zh,sort_order) VALUES (?,?,?,?,?)", [c.id, id, c.en, c.zh, c.sort_order||0])
    for (const s of data.subcategories || []) db.run("INSERT OR REPLACE INTO subcategories (id,group_id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?,?)", [s.id, id, s.category_id, s.en, s.zh, s.sort_order||0])
    for (const t of data.tags || []) db.run("INSERT OR REPLACE INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)", [t.id, id, t.subcategory_id, t.en, t.zh, t.sort_order||0, t.source||'custom'])
    saveDatabase()
    return { id }
  })
}
