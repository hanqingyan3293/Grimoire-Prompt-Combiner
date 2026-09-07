// 魔导书 Grimoire v7 — 设置 IPC 处理器
import { BrowserWindow, ipcMain, safeStorage } from "electron"
import { getDatabase, saveDatabase } from "../database"
import { IPC_CHANNELS } from "../../shared/types"
import { configureComfyUI } from "../services/comfy-client"
import { requireHttpUrl } from "../services/input-validation"

export function registerSettingsIPC(): void {
  // Default settings
  const defaults: Record<string, string> = {
    api_endpoint: "https://api.openai.com/v1",
    api_model: "gpt-4o",
    theme: "neon",
    appearance_mode: "system",
    language: "zh",
    custom_accent: "#a855f7",
    ui_scale: "14",
    ui_density: "normal",
    max_undo_steps: "50",
    random_min: "3",
    random_max: "16",
    comfyui_base_url: "http://127.0.0.1:8188",
    wd14_model_directory: "",
    wd14_python_path: "",
  }

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, async () => {
    const db = getDatabase()
    const result = db.exec("SELECT key, value FROM settings")
    const settings = { ...defaults }
    
    for (const row of result[0]?.values || []) {
      const key = row[0] as string
      const value = row[1] as string
      if (key !== "api_key") settings[key] = value
    }
    try { configureComfyUI(requireHttpUrl(settings.comfyui_base_url, 'ComfyUI 地址')) } catch { configureComfyUI(defaults.comfyui_base_url) }
    
    return settings
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (_event, key: string, value: string) => {
    if (key === 'comfyui_base_url') value = requireHttpUrl(value, 'ComfyUI 地址')
    const db = getDatabase()
    let storedValue = value
    
    if (key === "api_key" && value && safeStorage.isEncryptionAvailable()) {
      storedValue = safeStorage.encryptString(value).toString("base64")
    }
    
    db.run(
      "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=?",
      [key, storedValue, storedValue]
    )
    if (key === 'comfyui_base_url') configureComfyUI(value)
    saveDatabase()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("data:refresh")
    }
    return true
  })
}
