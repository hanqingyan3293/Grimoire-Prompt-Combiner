// 魔导书 Grimoire v7 — 设置 IPC 处理器
import { ipcMain, safeStorage } from "electron"
import { getDatabase, saveDatabase } from "../database"
import { IPC_CHANNELS } from "../../shared/types"

export function registerSettingsIPC(): void {
  // Default settings
  const defaults: Record<string, string> = {
    api_key: "",
    api_endpoint: "https://api.openai.com/v1",
    api_model: "gpt-4o",
    theme: "neon",
    language: "zh",
    custom_accent: "#a855f7",
    ui_scale: "medium",
    max_undo_steps: "50",
    random_min: "3",
    random_max: "16",
  }

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, async () => {
    const db = getDatabase()
    const result = db.exec("SELECT key, value FROM settings")
    const settings = { ...defaults }
    
    for (const row of result[0]?.values || []) {
      const key = row[0] as string
      let value = row[1] as string
      
      if (key === "api_key" && value) {
        try {
          if (safeStorage.isEncryptionAvailable()) {
            value = safeStorage.decryptString(Buffer.from(value, "base64"))
          }
        } catch { /* old data, keep raw */ }
      }
      
      settings[key] = value
    }
    
    return settings
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (_event, key: string, value: string) => {
    const db = getDatabase()
    let storedValue = value
    
    if (key === "api_key" && value && safeStorage.isEncryptionAvailable()) {
      storedValue = safeStorage.encryptString(value).toString("base64")
    }
    
    db.run(
      "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=?",
      [key, storedValue, storedValue]
    )
    saveDatabase()
    return true
  })
}
