
// 魔导书 Grimoire v7 — Provider IPC 处理器
import { ipcMain, safeStorage } from "electron"
import { getDatabase, saveDatabase } from "../database"
import { IPC_CHANNELS, Provider } from "../../shared/types"

function encryptKey(key: string): string {
  if (!key || !safeStorage.isEncryptionAvailable()) return key
  return safeStorage.encryptString(key).toString("base64")
}

function decryptKey(encrypted: string): string {
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return encrypted
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"))
  } catch { return encrypted }
}

function rowToProvider(r: any[]): Provider {
  return {
    id: r[0], name: r[1], access_mode: r[2] as "login"|"api",
    protocol: r[3] as "chat_completions"|"responses",
    base_url: r[4], api_key: decryptKey(r[5] || ""),
    default_model: r[6], test_model: r[7],
    context_size: r[8] ? Number(r[8]) : null,
    models: JSON.parse(r[9] || "[]"),
    is_active: r[10] === 1,
    config_toml: r[11] || "", auth_json: r[12] || "",
    created_at: r[13], updated_at: r[14],
  }
}

export async function getActiveProvider(): Promise<Provider | null> {
  const db = getDatabase()
  const result = db.exec("SELECT * FROM providers WHERE is_active=1 LIMIT 1")
  if (!result[0]?.values?.length) {
    // fallback to first provider
    const fallback = db.exec("SELECT * FROM providers LIMIT 1")
    if (fallback[0]?.values?.length) return rowToProvider(fallback[0].values[0])
    return null
  }
  return rowToProvider(result[0].values[0])
}

export function registerProvidersIPC(): void {
  // 列表
  ipcMain.handle(IPC_CHANNELS.PROVIDERS_LIST, async () => {
    const db = getDatabase()
    const result = db.exec("SELECT * FROM providers ORDER BY created_at DESC")
    return (result[0]?.values || []).map(rowToProvider)
  })

  // 保存（新建/更新）
  ipcMain.handle(IPC_CHANNELS.PROVIDERS_SAVE, async (_e, data: Partial<Provider> & { id?: string }) => {
    const db = getDatabase()
    const id = data.id || ("pvd_" + crypto.randomUUID().slice(0, 8))
    const existing = db.exec("SELECT id FROM providers WHERE id=?", [id])
    
    if (existing[0]?.values?.length) {
      // 更新
      db.run(
        `UPDATE providers SET name=?,access_mode=?,protocol=?,base_url=?,api_key=?,default_model=?,test_model=?,context_size=?,models=?,config_toml=?,auth_json=?,updated_at=datetime('now','localtime') WHERE id=?`,
        [data.name||"", data.access_mode||"api", data.protocol||"chat_completions", data.base_url||"", encryptKey(data.api_key||""), data.default_model||"", data.test_model||"", data.context_size||null, JSON.stringify(data.models||[]), data.config_toml||"", data.auth_json||"", id]
      )
    } else {
      // 新建
      db.run(
        `INSERT INTO providers (id,name,access_mode,protocol,base_url,api_key,default_model,test_model,context_size,models,config_toml,auth_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, data.name||"", data.access_mode||"api", data.protocol||"chat_completions", data.base_url||"", encryptKey(data.api_key||""), data.default_model||"", data.test_model||"", data.context_size||null, JSON.stringify(data.models||[]), data.config_toml||"", data.auth_json||""]
      )
    }
    saveDatabase()
    return { id }
  })

  // 删除
  ipcMain.handle(IPC_CHANNELS.PROVIDERS_DELETE, async (_e, id: string) => {
    const db = getDatabase()
    db.run("DELETE FROM providers WHERE id=?", [id])
    saveDatabase()
    return true
  })

  // 设置活跃
  ipcMain.handle(IPC_CHANNELS.PROVIDERS_SET_ACTIVE, async (_e, id: string) => {
    const db = getDatabase()
    db.run("UPDATE providers SET is_active=0")
    db.run("UPDATE providers SET is_active=1 WHERE id=?", [id])
    saveDatabase()
    return true
  })

  // 从上游获取模型列表
  ipcMain.handle(IPC_CHANNELS.PROVIDERS_FETCH_MODELS, async (_e, baseUrl: string, apiKey: string) => {
    try {
      const url = baseUrl.replace(/\/+$/, "") + "/models"
      const res = await fetch(url, {
        headers: { "Authorization": `Bearer ${apiKey}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const models: { id: string }[] = json.data || []
      return { success: true, models: models.map(m => m.id) }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // 测试连接
  ipcMain.handle(IPC_CHANNELS.PROVIDERS_TEST, async (_e, baseUrl: string, apiKey: string, model: string) => {
    try {
      const url = baseUrl.replace(/\/+$/, "") + "/chat/completions"
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || "gpt-4o-mini",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        }),
      })
      if (res.ok || res.status === 400) return { success: true, message: "连接成功" }
      if (res.status === 401) return { success: false, error: "API Key 无效" }
      return { success: false, error: `状态码 ${res.status}` }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
