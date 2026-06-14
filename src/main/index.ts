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
import { registerProvidersIPC } from "./ipc/providers.ipc"
import { registerTagGroupsIPC } from "./ipc/tagGroups.ipc"
import { registerAIIPC } from "./ipc/ai.ipc"
import { registerChatIPC } from "./ipc/chat.ipc"
import { logError, getErrorLogs } from "./services/logger.service"
import { IPC_CHANNELS } from "../shared/types"

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let aiWindow: BrowserWindow | null = null


function getPreloadPath(): string {
  return path.join(__dirname, "../preload/index.js")
}

function getRendererURL(hash: string): string {
  if (process.env.VITE_DEV_SERVER_URL) {
    return process.env.VITE_DEV_SERVER_URL + "/#" + hash
  }
  return "file://" + path.join(__dirname, "../../renderer/index.html") + "#" + hash
}

function createSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return
  }
  settingsWindow = new BrowserWindow({
    width: 900, height: 680, minWidth: 680, minHeight: 520,
    title: "设置 - 魔导书",
    parent: mainWindow || undefined,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  settingsWindow.loadURL(getRendererURL("settings"))
  settingsWindow.on("closed", () => { settingsWindow = null })
  settingsWindow.on('focus', () => {
    settingsWindow?.webContents.send('window:focused')
  })
}

function createAIWindow(): void {
  if (aiWindow && !aiWindow.isDestroyed()) {
    aiWindow.focus()
    return
  }
  aiWindow = new BrowserWindow({
    width: 1000, height: 700, minWidth: 700, minHeight: 500,
    title: "AI 助手 - 魔导书",
    parent: mainWindow || undefined,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  aiWindow.loadURL(getRendererURL("ai"))
  aiWindow.on("closed", () => { aiWindow = null })
  aiWindow.on('focus', () => {
    aiWindow?.webContents.send('window:focused')
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    show: false,
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

  // Focus-based cross-window sync
  mainWindow.on('focus', () => {
    mainWindow?.webContents.send('window:focused')
  })
  mainWindow.show()

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
  // 捕获渲染进程控制台
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    const logPath = path.join(app.getPath('userData'), 'renderer.log')
    fs.appendFileSync(logPath, '[L' + level + '] ' + message + '\n', 'utf-8')
  })
  // 捕获渲染进程崩溃
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    const logPath = path.join(app.getPath('userData'), 'renderer.log')
    fs.appendFileSync(logPath, 'RENDERER_CRASH: reason=' + details.reason + ' exitCode=' + details.exitCode + '\n', 'utf-8')
  })
  // 捕获页面加载失败
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
    const logPath = path.join(app.getPath('userData'), 'renderer.log')
    fs.appendFileSync(logPath, 'LOAD_FAIL: ' + errorCode + ' ' + errorDescription + '\n', 'utf-8')
  })
  mainWindow.on("closed", () => { mainWindow = null })
}


/** 将旧的 settings 表 api_key/api_endpoint/api_model 迁移为默认供应商 */
async function migrateOldSettings(): Promise<void> {
  const db = getDatabase()
  // 检查 providers 是否已有数据
  const hasProviders = db.exec("SELECT COUNT(*) as c FROM providers")
  if ((hasProviders[0]?.values?.[0]?.[0] as number) > 0) return

  // 读取旧 settings
  const old = db.exec("SELECT key, value FROM settings WHERE key IN ('api_key','api_endpoint','api_model')")
  const oldSettings: Record<string, string> = {}
  for (const row of old[0]?.values || []) {
    oldSettings[row[0] as string] = (row[1] as string) || ''
  }

  const apiKey = oldSettings.api_key || ''
  const apiEndpoint = oldSettings.api_endpoint || 'https://api.openai.com/v1'
  const apiModel = oldSettings.api_model || 'gpt-4o'

  // 只有有 key 或 endpoint 被修改过才迁移
  if (!apiKey && apiEndpoint === 'https://api.openai.com/v1') return

  const { safeStorage } = await import('electron')
  let encryptedKey = apiKey
  if (apiKey && safeStorage.isEncryptionAvailable()) {
    try {
      encryptedKey = safeStorage.encryptString(apiKey).toString('base64')
    } catch { /* keep raw */ }
  }

  const id = 'pvd_migrated'
  const name = '默认供应商'
  db.run(
    `INSERT INTO providers (id,name,access_mode,protocol,base_url,api_key,default_model,test_model,models,is_active,config_toml,auth_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, name, 'api', 'chat_completions', apiEndpoint, encryptedKey, apiModel, apiModel, JSON.stringify([apiModel]), 1, '', '']
  )
  getDatabase()
}

async function registerAllIPC(): Promise<void> {
  // tags.ipc.ts already registers all tag + category + subcategory handlers
  registerTagsIPC()
  registerPresetsIPC()
  registerHistoryIPC()
  registerSettingsIPC()
  registerImagesIPC()
  registerFavoritesIPC()
  registerProvidersIPC()
  registerTagGroupsIPC()
  registerAIIPC()
  registerChatIPC()
  // 迁移旧 settings 到 providers 表
  await migrateOldSettings()
  // 确保默认标签组存在
  const db2 = getDatabase(); const hasGrp = db2.exec('SELECT COUNT(*) as c FROM tag_groups'); if ((hasGrp[0]?.values?.[0]?.[0] as number)===0) { db2.run('INSERT INTO tag_groups (id,name,is_active) VALUES (?,?,?)',['default','默认标签库',1]); saveDatabase() }

  // 窗口管理
  ipcMain.handle("window:openSettings", async () => { createSettingsWindow() })
  ipcMain.handle("window:openAI", async () => { createAIWindow() })


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
  const count = db.exec("SELECT COUNT(*) as c FROM tags WHERE group_id='default'")
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
    await registerAllIPC()
    await initDefaultTags()
    createWindow()
  } catch (err) { console.error("启动失败:", err); dialog.showErrorBox("启动失败", err instanceof Error ? err.message : "未知错误") }
})

app.on("window-all-closed", () => { if (BrowserWindow.getAllWindows().length === 0) { closeDatabase(); app.quit() } })
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
