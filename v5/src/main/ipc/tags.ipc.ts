// ============================================================
// 閺嶅洨顒?IPC 婢跺嫮鎮婇崳?// ============================================================

import { ipcMain } from 'electron'
import { getDatabase, saveDatabase } from '../database'

export function registerTagsIPC(): void {
  const db = () => getDatabase()

  ipcMain.handle('tags:getAll', async () => {
    try {
      const categories = db().exec(`
        SELECT * FROM categories ORDER BY sort_order, name
      `)
      const subcategories = db().exec(`
        SELECT * FROM subcategories ORDER BY sort_order, name
      `)
      const tags = db().exec(`
        SELECT * FROM tags ORDER BY sort_order, en
      `)
      const favorites = db().exec(`SELECT tag_id FROM favorites`)

      const favSet = new Set(
        (favorites[0]?.values ?? []).map((r: any) => r[0] as string)
      )

      const cats = (categories[0]?.values ?? []).map((c: any) => ({
        id: c[0], name: c[1], sort_order: c[2], created_at: c[3],
        subcategories: [] as any[]
      }))

      const subs = (subcategories[0]?.values ?? []).map((s: any) => ({
        id: s[0], category_id: s[1], name: s[2], sort_order: s[3], created_at: s[4],
        tags: [] as any[]
      }))

      const tagList = tags[0]?.values ?? []

      for (const sub of subs) {
        sub.tags = tagList
          .filter((t: any) => t[1] === sub.id)
          .map((t: any) => ({
            id: t[0], subcategory_id: t[1], en: t[2], zh: t[3],
            sort_order: t[4], source: t[5], created_at: t[6],
            is_favorite: favSet.has(t[0])
          }))
      }

      for (const cat of cats) {
        cat.subcategories = subs.filter((s: any) => s.category_id === cat.id)
      }

      return { categories: cats }
    } catch (e: any) {
      console.error('[tags:getAll]', e)
      return { categories: [], error: e.message }
    }
  })

  ipcMain.handle('tags:search', async (_e, query: string) => {
    try {
      const q = `%${query}%`
      const result = db().exec(`
        SELECT t.*, s.name as subcategory_name, c.name as category_name
        FROM tags t
        JOIN subcategories s ON t.subcategory_id = s.id
        JOIN categories c ON s.category_id = c.id
        WHERE t.en LIKE ? COLLATE NOCASE OR t.zh LIKE ? COLLATE NOCASE
        ORDER BY c.sort_order, s.sort_order, t.sort_order
        LIMIT 100
      `, [q, q])
      const fav = db().exec(`SELECT tag_id FROM favorites`)
      const favSet = new Set((fav[0]?.values ?? []).map((r: any) => r[0]))

      const results = (result[0]?.values ?? []).map((r: any) => ({
        id: r[0], subcategory_id: r[1], en: r[2], zh: r[3],
        sort_order: r[4], source: r[5], created_at: r[6],
        subcategory: r[7], category: r[8],
        is_favorite: favSet.has(r[0])
      }))
      return { results }
    } catch (e: any) {
      return { results: [], error: e.message }
    }
  })

  // Add/Edit/Delete tags
  ipcMain.handle('tags:add', async (_e, data: { category: string; subcategory: string; en: string; zh: string }) => {
    try {
      // Find or create category
      let catResult = db().exec(`SELECT id FROM categories WHERE name = ?`, [data.category])
      let catId: string
      if (!catResult[0]?.values?.length) {
        catId = `cat_${Date.now()}`
        db().run(`INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)`,
          [catId, data.category, 999])
      } else {
        catId = catResult[0].values[0][0] as string
      }

      // Find or create subcategory
      let subResult = db().exec(`SELECT id FROM subcategories WHERE category_id = ? AND name = ?`,
        [catId, data.subcategory])
      let subId: string
      if (!subResult[0]?.values?.length) {
        subId = `sub_${Date.now()}`
        db().run(`INSERT INTO subcategories (id, category_id, name, sort_order) VALUES (?, ?, ?, ?)`,
          [subId, catId, data.subcategory, 999])
      } else {
        subId = subResult[0].values[0][0] as string
      }

      // Add tag
      const tagId = `tag_${Date.now()}`
      db().run(`INSERT INTO tags (id, subcategory_id, en, zh, source) VALUES (?, ?, ?, ?, 'custom')`,
        [tagId, subId, data.en, data.zh])
      saveDatabase()
      return { ok: true, id: tagId }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('tags:edit', async (_e, data: { tagId: string; en: string; zh: string }) => {
    try {
      db().run(`UPDATE tags SET en = ?, zh = ? WHERE id = ?`, [data.en, data.zh, data.tagId])
      saveDatabase()
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('tags:delete', async (_e, tagId: string) => {
    try {
      db().run(`DELETE FROM tags WHERE id = ?`, [tagId])
      saveDatabase()
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // Favorites
  ipcMain.handle('tags:addFavorite', async (_e, tagId: string) => {
    try {
      db().run(`INSERT OR IGNORE INTO favorites (tag_id) VALUES (?)`, [tagId])
      saveDatabase()
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('tags:removeFavorite', async (_e, tagId: string) => {
    try {
      db().run(`DELETE FROM favorites WHERE tag_id = ?`, [tagId])
      saveDatabase()
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('tags:getFavorites', async () => {
    try {
      const result = db().exec(`
        SELECT t.*, s.name as sub, c.name as cat
        FROM favorites f
        JOIN tags t ON f.tag_id = t.id
        JOIN subcategories s ON t.subcategory_id = s.id
        JOIN categories c ON s.category_id = c.id
        ORDER BY c.sort_order, s.sort_order, t.sort_order
      `)
      return {
        favorites: (result[0]?.values ?? []).map((r: any) => ({
          id: r[0], en: r[3], zh: r[4], subcategory: r[8], category: r[9]
        }))
      }
    } catch (e: any) {
      return { favorites: [], error: e.message }
    }
  })

  // Usage tracking
  ipcMain.handle('tags:addUsage', async (_e, tagId: string) => {
    try {
      db().run(`
        INSERT INTO tag_usage (tag_id, count, last_used)
        VALUES (?, 1, datetime('now','localtime'))
        ON CONFLICT(tag_id) DO UPDATE SET
          count = count + 1,
          last_used = datetime('now','localtime')
      `, [tagId])
      saveDatabase()
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('tags:getFrequent', async (_e, limit: number = 20) => {
    try {
      const result = db().exec(`
        SELECT t.*, u.count
        FROM tag_usage u
        JOIN tags t ON u.tag_id = t.id
        ORDER BY u.count DESC, u.last_used DESC
        LIMIT ?
      `, [limit])
      return {
        frequent: (result[0]?.values ?? []).map((r: any) => ({
          id: r[0], en: r[3], zh: r[4], count: r[8]
        }))
      }
    } catch (e: any) {
      return { frequent: [], error: e.message }
    }
  })


  // Category/Subcategory CRUD
  ipcMain.handle('tags:addCategory', async (_e, name: string) => {
    const id = 'cat_' + Date.now()
    db().run('INSERT INTO categories (id, name, sort_order) VALUES (?, ?, 999)', [id, name])
    saveDatabase()
    return { ok: true, id }
  })

  ipcMain.handle('tags:deleteCategory', async (_e, catId: string) => {
    db().run('DELETE FROM tags WHERE subcategory_id IN (SELECT id FROM subcategories WHERE category_id = ?)', [catId])
    db().run('DELETE FROM subcategories WHERE category_id = ?', [catId])
    db().run('DELETE FROM categories WHERE id = ?', [catId])
    saveDatabase()
    return { ok: true }
  })

  ipcMain.handle('tags:addSubcategory', async (_e, catId: string, name: string) => {
    const id = 'sub_' + Date.now()
    db().run('INSERT INTO subcategories (id, category_id, name, sort_order) VALUES (?, ?, ?, 999)', [id, catId, name])
    saveDatabase()
    return { ok: true, id }
  })

  ipcMain.handle('tags:deleteSubcategory', async (_e, subId: string) => {
    db().run('DELETE FROM tags WHERE subcategory_id = ?', [subId])
    db().run('DELETE FROM subcategories WHERE id = ?', [subId])
    saveDatabase()
    return { ok: true }
  })
}