// 魔导书 Grimoire v7 — 对话/消息 IPC
import { ipcMain, BrowserWindow } from 'electron'
import { getDatabase, saveDatabase } from '../database'
import crypto from 'crypto'

function broadcastRefresh() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('data:refresh')
    }
  }
}

const genId = () => crypto.randomUUID()

export function registerChatIPC(): void {
  // ========== 分组 ==========
  ipcMain.handle('chat:listGroups', async () => {
    const db = getDatabase()
    const r = db.exec('SELECT * FROM chat_groups ORDER BY sort_order')
    return (r[0]?.values || []).map(row => ({
      id: row[0], name: row[1], sort_order: row[2], created_at: row[3],
    }))
  })

  ipcMain.handle('chat:createGroup', async (_e, name: string) => {
    const db = getDatabase()
    const id = genId()
    db.run('INSERT INTO chat_groups (id, name) VALUES (?,?)', [id, name])
    saveDatabase()
    broadcastRefresh()
    return { id, name }
  })

  ipcMain.handle('chat:deleteGroup', async (_e, id: string) => {
    const db = getDatabase()
    db.run('DELETE FROM chat_groups WHERE id=? AND id!=?', [id, 'default'])
    saveDatabase()
    broadcastRefresh()
    return true
  })

  ipcMain.handle('chat:renameGroup', async (_e, id: string, name: string) => {
    const db = getDatabase()
    db.run('UPDATE chat_groups SET name=? WHERE id=?', [name, id])
    saveDatabase()
    broadcastRefresh()
    return true
  })

  // ========== 对话 ==========
  ipcMain.handle('chat:listConversations', async () => {
    const db = getDatabase()
    const r = db.exec('SELECT * FROM conversations ORDER BY updated_at DESC')
    return (r[0]?.values || []).map(row => ({
      id: row[0], group_id: row[1], provider_id: row[2], title: row[3],
      model: row[4], system_prompt: row[5], pinned: row[6],
      created_at: row[7], updated_at: row[8],
    }))
  })

  ipcMain.handle('chat:createConversation', async (_e, data: {
    provider_id: string; model: string; title?: string; group_id?: string
  }) => {
    const db = getDatabase()
    const id = genId()
    db.run(
      'INSERT INTO conversations (id, group_id, provider_id, title, model) VALUES (?,?,?,?,?)',
      [id, data.group_id || '', data.provider_id, data.title || '新对话', data.model]
    )
    saveDatabase()
    broadcastRefresh()
    return { id, title: data.title || '新对话' }
  })

  ipcMain.handle('chat:deleteConversation', async (_e, id: string) => {
    const db = getDatabase()
    db.run('DELETE FROM chat_messages WHERE conv_id=?', [id])
    db.run('DELETE FROM conversations WHERE id=?', [id])
    saveDatabase()
    broadcastRefresh()
    return true
  })

  ipcMain.handle('chat:updateConversation', async (_e, id: string, data: {
    title?: string; group_id?: string; system_prompt?: string; model?: string; provider_id?: string
  }) => {
    const db = getDatabase()
    const sets: string[] = []
    const vals: any[] = []
    if (data.title !== undefined) { sets.push('title=?'); vals.push(data.title) }
    if (data.group_id !== undefined) { sets.push('group_id=?'); vals.push(data.group_id) }
    if (data.system_prompt !== undefined) { sets.push('system_prompt=?'); vals.push(data.system_prompt) }
    if (data.model !== undefined) { sets.push('model=?'); vals.push(data.model) }
    if (data.provider_id !== undefined) { sets.push('provider_id=?'); vals.push(data.provider_id) }
    if (sets.length > 0) {
      sets.push("updated_at=datetime('now','localtime')")
      vals.push(id)
      db.run(`UPDATE conversations SET ${sets.join(',')} WHERE id=?`, vals)
      saveDatabase()
    }
    return true
  })

  ipcMain.handle('chat:moveConversation', async (_e, convId: string, groupId: string) => {
    const db = getDatabase()
    db.run("UPDATE conversations SET group_id=?, updated_at=datetime('now','localtime') WHERE id=?", [groupId, convId])
    saveDatabase()
    broadcastRefresh()
    return true
  })

  // ========== 消息 ==========
  ipcMain.handle('chat:getMessages', async (_e, convId: string) => {
    const db = getDatabase()
    const r = db.exec('SELECT * FROM chat_messages WHERE conv_id=? ORDER BY created_at ASC', [convId])
    return (r[0]?.values || []).map(row => ({
      id: row[0], conv_id: row[1], role: row[2], content: row[3],
      model: row[4], token_count: row[5], created_at: row[6],
    }))
  })

  ipcMain.handle('chat:saveMessage', async (_e, msg: {
    id?: string; conv_id: string; role: string; content: string; model?: string; token_count?: number
  }) => {
    const db = getDatabase()
    const id = msg.id || genId()
    const existing = db.exec('SELECT 1 FROM chat_messages WHERE id=?', [id])
    if (existing[0]?.values?.length) {
      db.run('UPDATE chat_messages SET content=?, token_count=? WHERE id=?',
        [msg.content, msg.token_count || 0, id])
    } else {
      db.run('INSERT INTO chat_messages (id, conv_id, role, content, model, token_count) VALUES (?,?,?,?,?,?)',
        [id, msg.conv_id, msg.role, msg.content, msg.model || '', msg.token_count || 0])
    }
    db.run("UPDATE conversations SET updated_at=datetime('now','localtime') WHERE id=?", [msg.conv_id])
    saveDatabase()
    broadcastRefresh()
    return { id }
  })

  ipcMain.handle('chat:deleteMessage', async (_e, id: string) => {
    const db = getDatabase()
    db.run('DELETE FROM chat_messages WHERE id=?', [id])
    saveDatabase()
    broadcastRefresh()
    return true
  })

  ipcMain.handle('chat:clearMessages', async (_e, convId: string) => {
    const db = getDatabase()
    db.run('DELETE FROM chat_messages WHERE conv_id=?', [convId])
    saveDatabase()
    broadcastRefresh()
    return true
  })
}