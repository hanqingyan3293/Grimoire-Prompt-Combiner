// 魔导书 Grimoire v7 — AI IPC 处理器
import { ipcMain, BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import { decryptKey } from './providers.ipc'
import { createClient, chatStream, vision, generateImage, fetchModels } from '../ai/client'

// 从 DB 读取完整 Provider 配置（含解密后的 API Key）
function getProvider(providerId: string) {
  const db = getDatabase()
  const r = db.exec('SELECT * FROM providers WHERE id=?', [providerId])
  if (!r[0]?.values?.[0]) return null
  const row = r[0].values[0]
  const provider = {
    id: row[0] as string,
    name: row[1] as string,
    access_mode: row[2] as string,
    protocol: row[3] as string,
    base_url: (row[4] as string) || '',
    api_key: decryptKey((row[5] as string) || ''),
    default_model: row[6] as string,
    test_model: row[7] as string,
    context_size: row[8] ? Number(row[8]) : null,
    models: JSON.parse(((row[9] as string) || '[]')),
    is_active: row[10] === 1,
    config_toml: (row[11] as string) || '',
    auth_json: (row[12] as string) || '',
  } as {
    id: string; name: string; access_mode: string; protocol: string;
    base_url: string; api_key: string; default_model: string; test_model: string;
    context_size: number | null; models: string[]; is_active: boolean;
    config_toml: string; auth_json: string;
  }
  return provider
}

export function registerAIIPC(): void {
  // ========== 流式聊天 ==========
  ipcMain.handle('ai:sendMessage', async (event, args: {
    providerId: string
    model: string
    messages: Array<{ role: string; content: string | any[] }>
  }) => {
    const provider = getProvider(args.providerId)
    if (!provider) return { error: '供应商不存在' }

    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return { error: '窗口已关闭' }

    const client = createClient(provider)
    let seq = 0
    let fullText = ''

    try {
      for await (const chunk of chatStream(client, args.model, args.messages)) {
        fullText += chunk
        if (!win.isDestroyed()) {
          win.webContents.send('ai:chunk', { seq: seq++, text: chunk, done: false })
        }
      }
      if (!win.isDestroyed()) {
        win.webContents.send('ai:chunk', { seq, text: '', done: true, fullText })
      }
      return { success: true, text: fullText }
    } catch (e: any) {
      const errMsg = e?.message || String(e)
      console.error('ai:sendMessage error:', errMsg)
      if (!win.isDestroyed()) {
        win.webContents.send('ai:chunk', { seq, text: '', done: true, error: errMsg })
      }
      return { error: errMsg }
    }
  })

  // ========== 识图 ==========
  ipcMain.handle('ai:vision', async (_e, args: {
    providerId: string
    model: string
    imageBase64: string
    prompt?: string
  }) => {
    const provider = getProvider(args.providerId)
    if (!provider) return { error: '供应商不存在' }
    try {
      const client = createClient(provider)
      const result = await vision(client, args.model, args.imageBase64, args.prompt)
      return { success: true, text: result }
    } catch (e: any) {
      console.error('ai:vision error:', e)
      return { error: e?.message || String(e) }
    }
  })

  // ========== 生图 ==========
  ipcMain.handle('ai:generateImage', async (_e, args: {
    providerId: string
    model: string
    prompt: string
  }) => {
    const provider = getProvider(args.providerId)
    if (!provider) return { error: '供应商不存在' }
    try {
      const client = createClient(provider)
      const url = await generateImage(client, args.model, args.prompt)
      return { success: true, url }
    } catch (e: any) {
      console.error('ai:generateImage error:', e)
      return { error: e?.message || String(e) }
    }
  })

  // ========== 获取模型列表 ==========
  ipcMain.handle('ai:fetchModels', async (_e, args: {
    baseUrl: string
    apiKey: string
  }) => {
    try {
      const client = createClient({ base_url: args.baseUrl, api_key: args.apiKey })
      const models = await fetchModels(client)
      return { success: true, models }
    } catch (e: any) {
      console.error('ai:fetchModels error:', e)
      return { error: e?.message || String(e) }
    }
  })
}