// 魔导书 Grimoire v7 — 标签组 IPC
import { ipcMain } from "electron"
import { getDatabase, saveDatabase } from "../database"
import { IPC_CHANNELS } from "../../shared/types"
import crypto from "crypto"
import { copyTagGroupData, importTagGroupData } from "../services/tag-group-copy"

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
    // 如果指定了复制源，复制标签数据（含 metadata/别名/关系）
    if (copyFromGroupId) {
      copyTagGroupData(db, copyFromGroupId, id)
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
    copyTagGroupData(db, id, newId)
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
    const metadata = db.exec("SELECT m.tag_id, m.namespace, m.normalized_key, m.description, m.color, m.is_active, m.source FROM tag_metadata m JOIN tags t ON t.id=m.tag_id WHERE t.group_id=?", [id])
    const aliases = db.exec("SELECT a.tag_id, a.alias, a.normalized_alias, a.language, a.source, a.is_builtin FROM tag_aliases a JOIN tags t ON t.id=a.tag_id WHERE t.group_id=?", [id])
    const relations = db.exec("SELECT r.source_tag_id, r.target_tag_id, r.relation_type, r.confidence, r.source, r.enabled FROM tag_relations r JOIN tags ts ON ts.id=r.source_tag_id WHERE ts.group_id=?", [id])
    return {
      group: group[0]?.values?.[0] ? { id: group[0].values[0][0], name: group[0].values[0][1] } : null,
      categories: (cats[0]?.values || []).map(r => ({ id: r[0], en: r[1], zh: r[2], sort_order: r[3] })),
      subcategories: (subs[0]?.values || []).map(r => ({ id: r[0], category_id: r[1], en: r[2], zh: r[3], sort_order: r[4] })),
      tags: (tags[0]?.values || []).map(r => ({ id: r[0], subcategory_id: r[1], en: r[2], zh: r[3], sort_order: r[4], source: r[5] })),
      metadata: (metadata[0]?.values || []).map(r => ({ tag_id: r[0], namespace: r[1], normalized_key: r[2], description: r[3], color: r[4], is_active: r[5], source: r[6] })),
      aliases: (aliases[0]?.values || []).map(r => ({ tag_id: r[0], alias: r[1], normalized_alias: r[2], language: r[3], source: r[4], is_builtin: r[5] })),
      relations: (relations[0]?.values || []).map(r => ({ source_tag_id: r[0], target_tag_id: r[1], relation_type: r[2], confidence: r[3], source: r[4], enabled: r[5] })),
    }
  })

  // 导入组（完整JSON，含 metadata/别名/关系；旧格式缺少这些数组时按空处理）
  ipcMain.handle(IPC_CHANNELS.TAG_GROUPS_IMPORT, async (_e, data: any, groupName: string) => {
    const db = getDatabase()
    const id = "grp_" + crypto.randomUUID().slice(0, 8)
    db.run("INSERT INTO tag_groups (id, name) VALUES (?,?)", [id, groupName])
    importTagGroupData(db, data, id)
    saveDatabase()
    return { id }
  })
}
