// 魔导书 Grimoire v7 — AI IPC 处理器
import { ipcMain, BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import { decryptKey } from './providers.ipc'
import { createClient, vision, generateImage, fetchModels } from '../ai/client'
import { OpenAICompatibleRuntime } from '../ai/runtime/openai-compatible.runtime'
import { registerBuiltInAgentRuntimes } from '../ai/runtime/registry'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { registerManagedImage } from '../services/image-asset.service'
import { createImageDerivatives, createMediaRelation, ensureMediaAsset, saveImageGenerationMetadata } from '../services/media.service'

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
    id: string; name: string; access_mode: string; protocol: 'chat_completions' | 'responses';
    base_url: string; api_key: string; default_model: string; test_model: string;
    context_size: number | null; models: string[]; is_active: boolean;
    config_toml: string; auth_json: string;
  }
  return provider
}

export function registerAIIPC(): void {
  registerBuiltInAgentRuntimes()
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

    const runtime = new OpenAICompatibleRuntime({ baseUrl: provider.base_url, apiKey: provider.api_key, protocol: provider.protocol === 'responses' ? 'responses' : 'chat_completions' })
    const session = runtime.createSession(args.model, args.messages as Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string | unknown[] }>)
    let seq = 0
    let fullText = ''

    try {
      for await (const event of runtime.send({ sessionId: session.id, model: args.model, messages: session.messages })) {
        if (event.type === 'text-delta') fullText += event.text
        if (event.type !== 'text-delta') continue
        if (!win.isDestroyed()) {
          win.webContents.send('ai:chunk', { seq: seq++, text: event.text, done: false })
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
      const result = await vision(client, args.model, args.imageBase64, args.prompt, provider.protocol === 'responses' ? 'responses' : 'chat_completions')
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
    negative?: string
  }) => {
    const provider = getProvider(args.providerId)
    if (!provider) return { error: '供应商不存在' }
    try {
      const client = createClient(provider)
      const url = await generateImage(client, args.model, args.prompt)
      let media: { id: number; mediaId?: string } | null = null
      if (url && /^https?:\/\//i.test(url)) {
        const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'grimoire-api-image-'))
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
          if (response.ok) {
            const buffer = Buffer.from(await response.arrayBuffer())
            const tempPath = path.join(tempRoot, 'generated-image')
            await fs.promises.writeFile(tempPath, buffer)
            const registered = await registerManagedImage(tempPath, 'AI-' + args.model + '-' + Date.now() + '.png')
            const asset = ensureMediaAsset(registered.id, 'generated-api', registered.original_name)
            void createImageDerivatives(registered.id)
            saveImageGenerationMetadata({ media_asset_id: asset.id, prompt: args.prompt, negative_prompt: args.negative || '', provider: provider.name, model: args.model, checkpoint: '', loras: [], seed: null, sampler: '', scheduler: '', steps: null, cfg: null, width: null, height: null, raw: { url } })
            media = { id: registered.id, mediaId: asset.id }
          }
        } finally { await fs.promises.rm(tempRoot, { recursive: true, force: true }) }
      }
      return { success: true, url, media }
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
