// 魔导书 Grimoire v7 — 标签组 IPC
import { ipcMain } from "electron"
import { getDatabase, saveDatabase } from "../database"
import { IPC_CHANNELS } from "../../shared/types"
import crypto from "crypto"

const genScopedId = (prefix: string) => prefix + crypto.randomUUID().slice(0, 8)

function copyTagData(db: ReturnType<typeof getDatabase>, fromGroupId: string, toGroupId: string): void {
  const cats = db.exec("SELECT * FROM categories WHERE group_id=?", [fromGroupId])
  const subs = db.exec("SELECT * FROM subcategories WHERE group_id=?", [fromGroupId])
  const tags = db.exec("SELECT * FROM tags WHERE group_id=?", [fromGroupId])
  const catIdMap = new Map<string, string>()
  const subIdMap = new Map<string, string>()

  for (const c of cats[0]?.values || []) {
    const oldId = c[0] as string
    const newId = genScopedId("cat_")
    catIdMap.set(oldId, newId)
    db.run("INSERT INTO categories (id,group_id,en,zh,sort_order) VALUES (?,?,?,?,?)", [newId, toGroupId, c[2], c[3], c[4]])
  }
  for (const s of subs[0]?.values || []) {
    const oldId = s[0] as string
    const newId = genScopedId("sub_")
    const newCatId = catIdMap.get(s[2] as string)
    if (!newCatId) continue
    subIdMap.set(oldId, newId)
    db.run("INSERT INTO subcategories (id,group_id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?,?)", [newId, toGroupId, newCatId, s[3], s[4], s[5]])
  }
  for (const t of tags[0]?.values || []) {
    const newSubId = subIdMap.get(t[2] as string)
    if (!newSubId) continue
    db.run("INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)", [genScopedId("t_"), toGroupId, newSubId, t[3], t[4], t[5], t[6]])
  }
}

function importTagData(db: ReturnType<typeof getDatabase>, data: any, toGroupId: string): void {
  const catIdMap = new Map<string, string>()
  const subIdMap = new Map<string, string>()

  for (const c of data.categories || []) {
    const newId = genScopedId("cat_")
    catIdMap.set(c.id, newId)
    db.run("INSERT INTO categories (id,group_id,en,zh,sort_order) VALUES (?,?,?,?,?)", [newId, toGroupId, c.en || c.zh, c.zh || c.en, c.sort_order || 0])
  }
  for (const s of data.subcategories || []) {
    const newCatId = catIdMap.get(s.category_id)
    if (!newCatId) continue
    const newId = genScopedId("sub_")
    subIdMap.set(s.id, newId)
    db.run("INSERT INTO subcategories (id,group_id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?,?)", [newId, toGroupId, newCatId, s.en || s.zh, s.zh || s.en, s.sort_order || 0])
  }
  for (const t of data.tags || []) {
    const newSubId = subIdMap.get(t.subcategory_id)
    if (!newSubId) continue
    db.run("INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)", [genScopedId("t_"), toGroupId, newSubId, t.en || t.zh, t.zh || t.en, t.sort_order || 0, t.source || "custom"])
  }
}

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
      copyTagData(db, copyFromGroupId, id)
    }
    saveDatabase()
    return { id }
  })

  // 删除
  ipcMain.handle(IPC_CHANNELS.TAG_GROUPS_DELETE, async (_e, id: string) => {
    const db = getDatabase()
    const groups = db.exec("SELECT id,is_active FROM tag_groups ORDER BY created_at ASC")
    const rows = groups[0]?.values || []
    if (id === "default") throw new Error("默认标签组不能删除")
    if (rows.length <= 1) throw new Error("至少需要保留一个标签组")
    const deleting = rows.find(r => r[0] === id)
    const fallback = rows.find(r => r[0] !== id)
    if (deleting?.[1] === 1 && fallback) {
      db.run("UPDATE tag_groups SET is_active=0")
      db.run("UPDATE tag_groups SET is_active=1 WHERE id=?", [fallback[0]])
    }
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
    copyTagData(db, id, newId)
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
    importTagData(db, data, id)
    saveDatabase()
    return { id }
  })
}
