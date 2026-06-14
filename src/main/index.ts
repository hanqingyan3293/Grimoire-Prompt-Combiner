// 魔导书 Grimoire v7 — Electron 主进程入口
import { app, BrowserWindow, ipcMain, Menu, dialog, shell } from "electron"
import path from "path"
import fs from "fs"
import { initDatabase, closeDatabase, getDatabase, importDefaultTags, saveDatabase, exportDatabase, importDatabase } from "./database"
import { registerTagsIPC } from "./ipc/tags.ipc"
import { registerPresetsIPC } from "./ipc/presets.ipc"
import { registerHistoryIPC } from "./ipc/history.ipc"
import { registerSettingsIPC } from "./ipc/settings.ipc"
import { registerImagesIPC } from "./ipc/images.ipc"
import { registerFavoritesIPC } from "./ipc/favorites.ipc"
import { registerProvidersIPC, getActiveProvider } from "./ipc/providers.ipc"
import { chatStream, analyzeImage, saveChatMessage, getChatHistory } from "./services/ai.service"
import { logError, getErrorLogs } from "./services/logger.service"
import { IPC_CHANNELS } from "../shared/types"

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1024, minHeight: 700,
    title: "魔导书 Grimoire",
    icon: path.join(__dirname, "../../../resources/icons/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"))
  }

  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        { label: "导出数据库", click: async () => {
            const r = await dialog.showSaveDialog({ filters: [{ name: "数据库", extensions: ["db"] }], defaultPath: "grimoire-backup.db" })
            if (!r.canceled && r.filePath) exportDatabase(r.filePath)
        }},
        { label: "导入数据库", click: async () => {
            const r = await dialog.showOpenDialog({ filters: [{ name: "数据库", extensions: ["db"] }] })
            if (!r.canceled && r.filePaths.length) { await importDatabase(r.filePaths[0]); mainWindow?.webContents.send("db:reloaded") }
        }},
        { type: "separator" },
        { label: "退出", role: "quit" },
      ],
    },
    { label: "视图", submenu: [
        { label: "开发者工具", role: "toggleDevTools" },
        { label: "重新加载", role: "reload" },
    ]},
    { label: "帮助", submenu: [
        { label: "GitHub", click: () => shell.openExternal("https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner") },
    ]},
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))
  mainWindow.on("closed", () => { mainWindow = null })
}

function registerAllIPC(): void {
  // tags.ipc.ts already registers all tag + category + subcategory handlers
  registerTagsIPC()
  registerPresetsIPC()
  registerHistoryIPC()
  registerSettingsIPC()
  registerImagesIPC()
  registerFavoritesIPC()
  registerProvidersIPC()

  ipcMain.handle(IPC_CHANNELS.AI_CHAT, async (_event, messages, modelOverride?: string) => {
    return new Promise(async (resolve) => {
      const provider = await getActiveProvider()
      if (!provider) { resolve({ success: false, error: "请先在设置中配置供应商" }); return }
      let fullText = ""
      chatStream(messages as any, { api_key: provider.api_key, api_endpoint: provider.base_url, api_model: modelOverride || provider.default_model },
        (chunk) => { mainWindow?.webContents.send("ai:chunk", chunk) },
        (text) => {
          fullText = text
          if (messages.length > 0) {
            const lastMsg = messages[messages.length - 1]
            const content = typeof lastMsg.content === "string" ? lastMsg.content : "[image]"
            saveChatMessage("user", content, "")
          }
          saveChatMessage("assistant", fullText, "")
          resolve({ success: true, text: fullText })
        },
        (error) => { resolve({ success: false, error }) }
      )
    })
  })

  ipcMain.handle(IPC_CHANNELS.AI_VISION, async (_event, imageBase64: string, customPrompt?: string) => {
    try {
      const provider = await getActiveProvider()
      if (!provider) return { success: false, error: "请先在设置中配置供应商" }
      const prompt = customPrompt || "请分析这张图片，列出适合作为 Stable Diffusion / NovelAI 提示词 (prompt tags) 的关键词标签。请用逗号分隔的英文标签列表格式输出。"
      const result = await analyzeImage(imageBase64, prompt, provider)
      return { success: true, text: result }
    } catch (err) { return { success: false, error: err instanceof Error ? err.message : "未知错误" } }
  })

  ipcMain.handle(IPC_CHANNELS.AI_CHAT_HISTORY, async () => getChatHistory(100))
  ipcMain.handle(IPC_CHANNELS.ERROR_GET_ALL, async () => getErrorLogs(50))
  ipcMain.handle(IPC_CHANNELS.ERROR_LOG, async (_event, message: string, stack: string, context: string) => { logError(message, stack, context) })

  ipcMain.handle(IPC_CHANNELS.DB_EXPORT, async () => {
    const r = await dialog.showSaveDialog({ filters: [{ name: "数据库", extensions: ["db"] }], defaultPath: "grimoire-backup.db" })
    if (!r.canceled && r.filePath) { exportDatabase(r.filePath); return true }
    return false
  })
  ipcMain.handle(IPC_CHANNELS.DB_IMPORT, async () => {
    const r = await dialog.showOpenDialog({ filters: [{ name: "数据库", extensions: ["db"] }] })
    if (!r.canceled && r.filePaths.length) { await importDatabase(r.filePaths[0]); mainWindow?.webContents.send("db:reloaded"); return true }
    return false
  })
}

async function initDefaultTags(): Promise<void> {
  const db = getDatabase()
  const count = db.exec("SELECT COUNT(*) as c FROM tags")
  const tagCount = count[0]?.values?.[0]?.[0] as number || 0
  if (tagCount === 0) {
    const devPath = path.join(__dirname, "../../../data/tags.json")
    const prodPath = path.join(process.resourcesPath || "", "data/tags.json")
    let tagsPath = devPath
    if (!fs.existsSync(tagsPath)) tagsPath = prodPath
    if (fs.existsSync(tagsPath)) {
      await importDefaultTags(fs.readFileSync(tagsPath, "utf-8"))
    }
  }
}

process.on("uncaughtException", (err) => { logError("未捕获异常: " + err.message, err.stack || ""); console.error(err) })
process.on("unhandledRejection", (reason) => { logError("未处理的 Promise: " + String(reason), reason instanceof Error ? reason.stack : "") })

app.whenReady().then(async () => {
  try {
    await initDatabase()
    registerAllIPC()
    await initDefaultTags()
    createWindow()
  } catch (err) { console.error("启动失败:", err); dialog.showErrorBox("启动失败", err instanceof Error ? err.message : "未知错误") }
})

app.on("window-all-closed", () => { closeDatabase(); app.quit() })
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
