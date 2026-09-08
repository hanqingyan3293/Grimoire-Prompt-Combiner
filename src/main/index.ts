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
import { registerMigrationIPC } from "./ipc/migration.ipc"
import { registerTasksIPC } from "./ipc/tasks.ipc"
import { registerWD14IPC } from "./ipc/wd14.ipc"
import { registerComfyIPC } from "./ipc/comfy.ipc"
import { registerCanvasIPC } from "./ipc/canvas.ipc"
import { registerPromptAssetsIPC } from "./ipc/prompt-assets.ipc"
import { configureComfyUI } from './services/comfy-client'
import { requireHttpUrl } from './services/input-validation'
import { taskRunner } from "./services/task-runner"
import { clearWD14ModelDirectory, clearWD14PythonPath, configureWD14ModelDirectory, configureWD14PythonPath, wd14Worker } from "./services/wd14-worker"
import { markInterruptedTasks } from "./services/task-repository"
import { logError, logEvent, getErrorLogs } from "./services/logger.service"
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

function configureWindowSecurity(window: BrowserWindow): void {
  const developmentOrigin = process.env.VITE_DEV_SERVER_URL
    ? new URL(process.env.VITE_DEV_SERVER_URL).origin
    : null
  const isAllowedRendererUrl = (url: string): boolean => {
    if (url.startsWith('file://')) return true
    return developmentOrigin !== null && url.startsWith(developmentOrigin + '/')
  }

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererUrl(url)) {
      event.preventDefault()
      void shell.openExternal(url).catch(() => {})
    }
  })
}

function registerSystemIPC(): void {
  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, async (_event, url: unknown) => {
    if (typeof url !== 'string') throw new Error('外部地址无效')
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅允许打开 HTTP 或 HTTPS 地址')
    await shell.openExternal(parsed.toString())
    return true
  })
}

function broadcastDatabaseReload(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('db:reloaded')
      window.webContents.send('data:refresh')
    }
  }
}

function applyPersistedIntegrationSettings(): void {
  const database = getDatabase()
  configureComfyUI('http://127.0.0.1:8188')
  clearWD14ModelDirectory()
  clearWD14PythonPath()
  const comfySetting = database.exec("SELECT value FROM settings WHERE key='comfyui_base_url'")
  const savedComfyUrl = comfySetting[0]?.values?.[0]?.[0]
  if (typeof savedComfyUrl === 'string') {
    try { configureComfyUI(requireHttpUrl(savedComfyUrl, 'ComfyUI 地址')) } catch (error) { logEvent('warn', 'comfyui', 'Saved ComfyUI address ignored', { context: error instanceof Error ? error.message : String(error), errorCode: 'COMFY_CONFIG_INVALID', retryable: false }) }
  }
  const wd14Setting = database.exec("SELECT value FROM settings WHERE key='wd14_model_directory'")
  const savedWD14Directory = wd14Setting[0]?.values?.[0]?.[0]
  if (typeof savedWD14Directory === 'string' && savedWD14Directory.trim()) {
    try { configureWD14ModelDirectory(savedWD14Directory) } catch (error) { logEvent('warn', 'wd14', 'Saved WD14 model directory ignored', { context: error instanceof Error ? error.message : String(error), errorCode: 'WD14_CONFIG_INVALID', retryable: false }) }
  }
  const wd14PythonSetting = database.exec("SELECT value FROM settings WHERE key='wd14_python_path'")
  const savedWD14PythonPath = wd14PythonSetting[0]?.values?.[0]?.[0]
  if (typeof savedWD14PythonPath === 'string' && savedWD14PythonPath.trim()) {
    try { configureWD14PythonPath(savedWD14PythonPath) } catch (error) { logEvent('warn', 'wd14', 'Saved WD14 Python path ignored', { context: error instanceof Error ? error.message : String(error), errorCode: 'WD14_PYTHON_CONFIG_INVALID', retryable: false }) }
  }
}

async function replaceDatabase(importPath: string): Promise<void> {
  await taskRunner.stopAndWait()
  try {
    await wd14Worker.stop()
    importDatabase(importPath)
    applyPersistedIntegrationSettings()
    markInterruptedTasks()
    broadcastDatabaseReload()
  } finally {
    taskRunner.start()
  }
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
    autoHideMenuBar: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  configureWindowSecurity(settingsWindow)
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
    autoHideMenuBar: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  configureWindowSecurity(aiWindow)
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
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  configureWindowSecurity(mainWindow)

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
            if (!r.canceled && r.filePath) {
              try { exportDatabase(r.filePath) }
              catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                logEvent('error', 'database', 'Database export failed', { context: message, errorCode: 'DB_EXPORT_FAILED', retryable: true })
                dialog.showErrorBox('数据库导出失败', message)
              }
            }
        }},
        { label: "导入数据库", click: async () => {
            const r = await dialog.showOpenDialog({ filters: [{ name: "数据库", extensions: ["db"] }] })
            if (!r.canceled && r.filePaths.length) {
              try { await replaceDatabase(r.filePaths[0]) }
              catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                logEvent('error', 'database', 'Database import failed', { context: message, errorCode: 'DB_IMPORT_FAILED', retryable: true })
                dialog.showErrorBox('数据库导入失败', message)
              }
            }
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
  mainWindow.setMenuBarVisibility(false)
  // 捕获渲染进程控制台
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    logEvent('debug', 'renderer', message, { context: 'console-level=' + level })
  })
  // 捕获渲染进程崩溃
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logEvent('error', 'renderer', 'Renderer process exited', { context: 'reason=' + details.reason, errorCode: String(details.exitCode) })
  })
  // 捕获页面加载失败
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
    logEvent('error', 'renderer', 'Renderer page failed to load', { errorCode: String(errorCode), context: errorDescription })
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
  registerMigrationIPC()
  registerTasksIPC()
  registerWD14IPC()
  registerComfyIPC()
  registerCanvasIPC()
  registerPromptAssetsIPC()
  registerSystemIPC()
  applyPersistedIntegrationSettings()
  markInterruptedTasks()
  taskRunner.start()
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
    if (!r.canceled && r.filePaths.length) { await replaceDatabase(r.filePaths[0]); return true }
    return false
  })

  ipcMain.handle(IPC_CHANNELS.DIALOG_SAVE_TEXT, async (_event, content: string, defaultName: string) => {
    const r = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [
        { name: "JSON 文件", extensions: ["json"] },
        { name: "文本文件", extensions: ["txt"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    })
    if (r.canceled || !r.filePath) return false
    fs.writeFileSync(r.filePath, content, "utf-8")
    return true
  })

  ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_TEXT, async () => {
    const r = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "JSON / 文本文件", extensions: ["json", "txt"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    })
    if (r.canceled || r.filePaths.length === 0) return null
    return fs.readFileSync(r.filePaths[0], "utf-8")
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
    logEvent('info', 'application', 'Application startup')
    await initDatabase()
    await registerAllIPC()
    await initDefaultTags()
    createWindow()
    logEvent('info', 'application', 'Application ready')
  } catch (err) {
    logError("启动失败: " + (err instanceof Error ? err.message : "未知错误"), err instanceof Error ? err.stack || "" : "")
    console.error("启动失败:", err)
    dialog.showErrorBox("启动失败", err instanceof Error ? err.message : "未知错误")
  }
})

app.on("window-all-closed", () => { if (BrowserWindow.getAllWindows().length === 0) { taskRunner.stop(); void wd14Worker.stop(); closeDatabase(); app.quit() } })
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
